/**
 * Status helpers — determine the outcome of a subagent result.
 *
 * Extracted from toon-formatter.ts (Candidate 3).
 * Pure functions with zero dependencies beyond result-types.
 */

import type { SubagentResult } from "./result-types.ts";

// ── Status detection ──────────────────────────────────────────

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
