/**
 * Canonical subagent result types.
 *
 * Defined once, imported by engine, index, and formatter modules
 * so the result shape lives in a single place and cannot drift.
 */

/**
 * Aggregated usage statistics for a subagent invocation.
 * All fields are required — zero values indicate the stat was not tracked.
 */
export interface SubagentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

/**
 * Result of a single subagent invocation, regardless of mode
 * (single / parallel / chain).
 */
export interface SubagentResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	/** JSON-parsed messages from the subagent process. */
	messages: Record<string, unknown>[];
	stderr: string;
	usage: SubagentUsage;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	/** 1-indexed position in a chain (undefined for single/parallel). */
	step?: number;
	/** True when report_done tool call was detected. */
	completed: boolean;
	reportDoneStatus?: string;
	reportDoneSummary?: string;
	reportDoneFindings?: string[];
}
