/**
 * TOON serialization — format subagent results as TOON (v4.1)
 * key-value and tabular output for the main agent.
 *
 * Extracted from toon-formatter.ts (Candidate 3).
 * Depends on status.ts for displayStatus, isFailedResult, and
 * formatUsageAggregate.
 */

import type { AgentConfig } from "./agent-config.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";
import {
	displayStatus,
	formatUsageAggregate,
	isFailedResult,
} from "./status.ts";

// Re-export for backward compatibility.
export type { SubagentResult, SubagentUsage };

// ── Token formatting ──────────────────────────────────────────

/**
 * Formats a token count for display.
 * - < 1000: raw number ("500")
 * - < 10000: to 1 decimal with k ("5.2k")
 * - >= 10000: rounded to k ("12k")
 * - >= 1M: to 1 decimal with M ("1.5M")
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

// ── TOON quoting ──────────────────────────────────────────────

/**
 * Quotes a value for TOON output if it contains spaces, commas,
 * or special characters. Otherwise returns as-is.
 */
export function toonQuote(value: string): string {
	if (/[\s,"[\]{}:]/.test(value) || value.length === 0) {
		return `"${value.replace(/"/g, '\\"')}"`;
	}
	return value;
}

// ── Single result formatting ──────────────────────────────────

/**
 * Formats a single subagent result as a TOON object.
 * Success path produces key-value pairs; error path uses error:/help: lines.
 */
export function formatSingleToon(result: SubagentResult): string {
	if (isFailedResult(result)) {
		return formatErrorToon(result);
	}

	const lines: string[] = [];
	lines.push(`agent: ${toonQuote(result.agent)}`);
	lines.push(`status: ${result.reportDoneStatus || "success"}`);
	lines.push(`turns: ${result.usage.turns}`);

	const tokens = result.usage.input + result.usage.output;
	lines.push(`tokens: ${formatTokens(tokens)}`);

	if (result.reportDoneSummary) {
		lines.push(`summary: ${toonQuote(result.reportDoneSummary)}`);
	}

	if (result.reportDoneFindings && result.reportDoneFindings.length > 0) {
		lines.push(
			`findings[${result.reportDoneFindings.length}]: ${result.reportDoneFindings.join(",")}`,
		);
	}

	return lines.join("\n");
}

// ── Error formatting ──────────────────────────────────────────

/**
 * Formats a failed subagent result as TOON error:/help: lines.
 * Each error type has a distinct message and actionable help.
 */
export function formatErrorToon(result: SubagentResult): string {
	const tokens = result.usage.input + result.usage.output;
	const tokenStr = formatTokens(tokens);
	const lines: string[] = [];

	switch (result.stopReason) {
		case "timeout": {
			const timeoutSec = result.errorMessage?.match(/(\d+)s/)?.[1] || "?";
			const minutes = Math.floor(Number(timeoutSec) / 60);
			const duration =
				minutes > 0
					? `${minutes} minute${minutes > 1 ? "s" : ""}`
					: `${timeoutSec}s`;
			lines.push(
				`error: subagent "${result.agent}" timed out after ${duration} (${result.usage.turns} turns, ${tokenStr} tokens)`,
			);
			lines.push(
				"help: retry with a longer global timeout or narrow the task scope",
			);
			break;
		}
		case "tool_timeout": {
			const timeoutSec = result.errorMessage?.match(/(\d+)s/)?.[1] || "?";
			lines.push(
				`error: subagent "${result.agent}" tool call exceeded ${timeoutSec}s timeout (${result.usage.turns} turns, ${tokenStr} tokens)`,
			);
			lines.push(
				"help: increase toolTimeout in the agent's frontmatter or simplify the tool call",
			);
			break;
		}
		case "turn_limit": {
			const maxTurns = result.errorMessage?.match(/(\d+)/)?.[1] || "?";
			lines.push(
				`error: subagent "${result.agent}" exceeded turn limit of ${maxTurns} turns (${tokenStr} tokens)`,
			);
			lines.push(
				"help: increase maxTurns in the agent's frontmatter or narrow the task scope",
			);
			break;
		}
		case "aborted": {
			lines.push(
				`error: subagent "${result.agent}" was aborted (${result.usage.turns} turns, ${tokenStr} tokens)`,
			);
			lines.push("help: the operation was canceled by the user");
			break;
		}
		default: {
			lines.push(
				`error: subagent "${result.agent}" exited without calling report_done (${result.usage.turns} turns, ${tokenStr} tokens)`,
			);
			lines.push(
				"help: the subagent may not have understood the task or the report_done contract — check the task description",
			);
			break;
		}
	}

	// Include partial output if available
	const partial = getPartialOutput(result);
	if (partial) {
		lines.push(`partial: ${toonQuote(partial)}`);
	}

	return lines.join("\n");
}

/**
 * Extracts partial output from a failed result for inclusion in error output.
 */
function getPartialOutput(result: SubagentResult): string | null {
	if (result.reportDoneSummary) return result.reportDoneSummary;

	// Try to get the last text from messages
	if (result.messages.length > 0) {
		const lastMsg = result.messages[result.messages.length - 1] as Record<
			string,
			unknown
		>;
		const content = lastMsg?.content as
			| Array<Record<string, unknown>>
			| undefined;
		if (content) {
			for (let i = content.length - 1; i >= 0; i--) {
				if (content[i].type === "text" && content[i].text) {
					const text = String(content[i].text);
					const maxLen = 200;
					return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
				}
			}
		}
	}

	if (result.stderr) {
		const maxLen = 200;
		return result.stderr.length > maxLen
			? `${result.stderr.slice(0, maxLen)}...`
			: result.stderr;
	}

	return null;
}

// ── Aggregate formatting ──────────────────────────────────────

/**
 * Formats parallel execution results as TOON keyed tabular.
 */
export function formatParallelToon(results: SubagentResult[]): string {
	const header = `subagents[${results.length}]{agent,status,turns,tokens}:`;
	const rows = results.map((r) => {
		const tokens = r.usage.input + r.usage.output;
		const status = displayStatus(r);
		return `  ${r.agent},${status},${r.usage.turns},${formatTokens(tokens)}`;
	});

	const aggregate = formatUsageAggregate(results);
	const successCount = results.filter((r) => !isFailedResult(r)).length;
	const failCount = results.length - successCount;

	let totalLine: string;
	if (failCount === 0) {
		totalLine = `total: ${results.length} agents, ${aggregate.turns} turns, ${formatTokens(aggregate.tokens)} tokens`;
	} else {
		totalLine = `total: ${results.length} agents (${successCount} ok, ${failCount} failed), ${aggregate.turns} turns, ${formatTokens(aggregate.tokens)} tokens`;
	}

	return [header, ...rows, totalLine].join("\n");
}

/**
 * Formats chain execution results as TOON keyed tabular.
 */
export function formatChainToon(results: SubagentResult[]): string {
	const header = `chain[${results.length}]{step,agent,status,turns,tokens}:`;
	const rows = results.map((r) => {
		const stepLabel = r.step ?? results.indexOf(r) + 1;
		if (r.exitCode === -1 && !r.stopReason) {
			// Step was never executed (chain stopped before it)
			return `  ${stepLabel},${r.agent},-,-,-`;
		}
		const tokens = r.usage.input + r.usage.output;
		const status = displayStatus(r);
		return `  ${stepLabel},${r.agent},${status},${r.usage.turns},${formatTokens(tokens)}`;
	});

	const aggregate = formatUsageAggregate(results);
	const failCount = results.filter(
		(r) => r.exitCode !== -1 && isFailedResult(r),
	).length;
	const skippedCount = results.filter(
		(r) => r.exitCode === -1 && !r.stopReason,
	).length;

	let totalLine: string;
	if (failCount === 0 && skippedCount === 0) {
		totalLine = `total: ${results.length} steps, ${aggregate.turns} turns, ${formatTokens(aggregate.tokens)} tokens`;
	} else {
		const parts: string[] = [];
		parts.push(`${results.length} steps`);
		if (failCount > 0) parts.push(`${failCount} failed`);
		if (skippedCount > 0) parts.push(`${skippedCount} skipped`);
		parts.push(`${aggregate.turns} turns`);
		parts.push(`${formatTokens(aggregate.tokens)} tokens`);
		totalLine = `total: ${parts.join(", ")}`;
	}

	return [header, ...rows, totalLine].join("\n");
}

// ── Agent list formatting ─────────────────────────────────────

/** Formats a comma-separated list of available agents for error messages. */
export function formatAvailableAgents(agents: AgentConfig[]): string {
	if (agents.length === 0) return "none";
	return agents.map((a) => `${a.name} (${a.source})`).join(", ");
}
