/**
 * Core execution engine — event parsing, completion detection, and the
 * SpawnFn seam where callers inject a process adapter.
 *
 * Pure event processing (processEvent, processEventLines, hasReportDone)
 * is tested independently of process spawning. The SpawnFn interface lets
 * tests inject a fake process spawner for integration testing.
 */

import type { AgentConfig } from "./agent-config.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";

// ── Types ─────────────────────────────────────────────────────

// Re-export for backward compatibility and convenience.
export type { SubagentResult, SubagentUsage };

// ── Process spawner seam ──────────────────────────────────────

/**
 * Function type for spawning a subagent process.
 *
 * Accepts the full engine config and returns a SubagentResult.
 * The real adapter (pi-process.ts) spawns a child process, streams
 * JSON events, and enforces safety caps. Tests inject a fake that
 * returns pre-determined events.
 */
export type SpawnFn = (config: EngineConfig) => Promise<SubagentResult>;

export interface CapsConfig {
	toolTimeout: number;
	globalTimeout: number;
	maxTurns: number;
}

export const DEFAULT_CAPS: CapsConfig = {
	toolTimeout: 120_000, // 120s
	globalTimeout: 300_000, // 5 min
	maxTurns: 20,
};

/**
 * Instructions injected into every subprocess task.
 * The subagent MUST call the report_done tool as its final action.
 */
export const COMPLETION_INSTRUCTION = [
	"",
	"---",
	"## Completion contract",
	"",
	"When you have finished the task above, you MUST call the `report_done` tool as your final action.",
	"Do not end with a plain text message — your result will be treated as incomplete.",
	"",
	"The `report_done` tool accepts:",
	'- status: "success" (task completed fully), "partial" (some parts done), or "failed" (could not complete)',
	"- summary: a concise description of what was accomplished",
	"- findings (optional): list of specific findings, files changed, or discoveries",
].join("\n");

export interface EngineConfig {
	agent: AgentConfig;
	task: string;
	cwd: string;
	caps: CapsConfig;
	signal?: AbortSignal;
	/** Called after each event is processed, with current state. */
	onEvent?: (state: EventState) => void;
}

// ── Event types (subset of pi JSON events we care about) ─────

export interface PiEvent {
	type: string;
	message?: Record<string, unknown> & {
		role?: string;
		content?: Array<Record<string, unknown>>;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			cost?: { total?: number };
			totalTokens?: number;
		};
		model?: string;
		stopReason?: string;
		errorMessage?: string;
	};
}

// ── Event processing (pure, testable) ─────────────────────────

export interface EventState {
	messages: Record<string, unknown>[];
	usage: SubagentUsage;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	completed: boolean;
	reportDoneStatus?: string;
	reportDoneSummary?: string;
	reportDoneFindings?: string[];
}

export function initialEventState(): EventState {
	return {
		messages: [],
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		completed: false,
	};
}

/**
 * Returns true if the message contains a report_done tool call.
 */
export function hasReportDone(msg: Record<string, unknown>): boolean {
	if (msg.role !== "assistant") return false;
	const content = msg.content as Array<Record<string, unknown>> | undefined;
	if (!content) return false;
	for (const part of content) {
		if (part.type === "toolCall" && part.name === "report_done") {
			return true;
		}
	}
	return false;
}

/**
 * Pure function: processes a single JSON event, returns updated state.
 * Does not mutate the input state.
 */
export function processEvent(state: EventState, event: PiEvent): EventState {
	const next: EventState = {
		...state,
		messages: [...state.messages],
		usage: { ...state.usage },
	};

	if (
		(event.type === "message_end" || event.type === "tool_result_end") &&
		event.message
	) {
		const msg = event.message;
		next.messages = [...next.messages, msg];

		if (msg.role === "assistant") {
			next.usage = { ...next.usage, turns: next.usage.turns + 1 };

			const usage = msg.usage;
			if (usage) {
				next.usage = {
					...next.usage,
					input: next.usage.input + (usage.input || 0),
					output: next.usage.output + (usage.output || 0),
					cacheRead: next.usage.cacheRead + (usage.cacheRead || 0),
					cacheWrite: next.usage.cacheWrite + (usage.cacheWrite || 0),
					cost: next.usage.cost + (usage.cost?.total || 0),
					contextTokens: usage.totalTokens || 0,
				};
			}
			if (!next.model && msg.model) next.model = msg.model;
			if (msg.stopReason) next.stopReason = msg.stopReason;
			if (msg.errorMessage) next.errorMessage = msg.errorMessage;

			// Check for report_done
			if (hasReportDone(msg)) {
				next.completed = true;
				const content = msg.content as Array<Record<string, unknown>>;
				if (content) {
					for (const part of content) {
						if (part.type === "toolCall" && part.name === "report_done") {
							const args = part.arguments as
								| Record<string, unknown>
								| undefined;
							next.reportDoneStatus = args?.status as string | undefined;
							next.reportDoneSummary = args?.summary as string | undefined;
							next.reportDoneFindings = args?.findings as string[] | undefined;
						}
					}
				}
			}
		}
	}

	return next;
}

/**
 * Processes a batch of JSON event lines. Returns final state + whether
 * completion was detected. Useful for testing without stream machinery.
 */
export function processEventLines(lines: string[]): EventState {
	let state = initialEventState();
	for (const line of lines) {
		if (!line.trim()) continue;
		let event: PiEvent;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		state = processEvent(state, event);
	}
	return state;
}

// ── Spawn seam ───────────────────────────────────────────────

/**
 * Runs a subagent by delegating to the provided SpawnFn.
 *
 * This is the injection point — callers pass the real process spawner
 * (from pi-process.ts) in production, or a fake spawner in tests.
 */
export async function runSubagent(
	config: EngineConfig,
	spawnFn: SpawnFn,
): Promise<SubagentResult> {
	return spawnFn(config);
}
