/**
 * TOON result formatter — pure functions for formatting subagent results
 * as TOON (v4.1) key-value and tabular output for the main agent.
 *
 * Extracted from index.ts so formatting can be tested independently.
 */

import * as os from "node:os";
import type { AgentConfig } from "./agent-config.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";

// ── Types ─────────────────────────────────────────────────────

export type { SubagentResult, SubagentUsage };

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

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

// ── Status helpers ────────────────────────────────────────────

/**
 * Maps report_done status to a display string.
 * Falls back to stopReason or exitCode analysis.
 */
export function displayStatus(result: SubagentResult): string {
	if (result.reportDoneStatus) return result.reportDoneStatus;
	if (result.stopReason === "timeout") return "timeout";
	if (result.stopReason === "tool_timeout") return "tool_timeout";
	if (result.stopReason === "turn_limit") return "turn_limit";
	if (result.stopReason === "aborted") return "aborted";
	if (result.stopReason === "incomplete") return "incomplete";
	if (result.exitCode === 0 && result.completed) return "success";
	if (result.exitCode !== 0) return "failed";
	return "incomplete";
}

export function isFailedResult(result: SubagentResult): boolean {
	return (
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted" ||
		result.stopReason === "timeout" ||
		result.stopReason === "tool_timeout" ||
		result.stopReason === "turn_limit" ||
		result.stopReason === "incomplete" ||
		!result.completed
	);
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

// ── Usage aggregation ─────────────────────────────────────────

export interface UsageAggregate {
	input: number;
	output: number;
	tokens: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

/**
 * Aggregates usage stats across multiple results.
 */
export function formatUsageAggregate(
	results: SubagentResult[],
): UsageAggregate {
	const total: UsageAggregate = {
		input: 0,
		output: 0,
		tokens: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		turns: 0,
	};
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.tokens += r.usage.input + r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

// ── Display helpers (moved from index.ts) ─────────────────────

/** Formats a comma-separated list of available agents for error messages. */
export function formatAvailableAgents(agents: AgentConfig[]): string {
	if (agents.length === 0) return "none";
	return agents.map((a) => `${a.name} (${a.source})`).join(", ");
}

/**
 * Formats aggregate usage stats into a compact single-line summary.
 * Includes turns, tokens in/out, cache r/w, cost, context tokens, and model.
 */
export function formatUsageStats(
	usage: SubagentUsage,
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns)
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

/**
 * Formats a single tool call for display in subagent output.
 * Each tool gets a custom short representation.
 */
export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: string, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return (
				themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
			);
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

/** Returns the final text output from the last assistant message. */
export function getFinalOutput(messages: Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const content = msg.content as Array<Record<string, unknown>>;
			if (!content) continue;
			for (const part of content) {
				if (part.type === "text") return part.text as string;
			}
		}
	}
	return "";
}

/** Extracts display items (text blocks and tool calls) from messages. */
export function getDisplayItems(
	messages: Record<string, unknown>[],
): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			const content = msg.content as Array<Record<string, unknown>>;
			if (!content) continue;
			for (const part of content) {
				if (part.type === "text")
					items.push({ type: "text", text: part.text as string });
				else if (part.type === "toolCall")
					items.push({
						type: "toolCall",
						name: part.name as string,
						args: part.arguments as Record<string, unknown>,
					});
			}
		}
	}
	return items;
}
