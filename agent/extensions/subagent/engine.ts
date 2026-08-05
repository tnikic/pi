/**
 * Core execution engine — spawn, stream, detect completion, enforce caps.
 *
 * Extracted from index.ts so event parsing and completion detection
 * can be tested independently of process spawning.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfig } from "./agent-config.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";

// ── Types ─────────────────────────────────────────────────────

// Re-export for backward compatibility and convenience.
export type { SubagentResult, SubagentUsage };

export interface CapsConfig {
	toolTimeout: number;
	globalTimeout: number;
	maxTurns: number;
}

export const DEFAULT_CAPS: CapsConfig = {
	toolTimeout: 60_000, // 60s
	globalTimeout: 300_000, // 5 min
	maxTurns: 20,
};

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

interface PiEvent {
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

// ── Process management ────────────────────────────────────────

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

async function writePromptToTempFile(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "pi-subagent-"),
	);
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await fs.promises.writeFile(filePath, prompt, {
		encoding: "utf-8",
		mode: 0o600,
	});
	return { dir: tmpDir, filePath };
}

/**
 * Kills a process with SIGTERM, then SIGKILL after a grace period.
 */
function killWithGrace(proc: ChildProcess, graceMs = 5000): void {
	if (proc.killed || proc.exitCode !== null) return;
	proc.kill("SIGTERM");
	const killTimer = setTimeout(() => {
		if (!proc.killed && proc.exitCode === null) {
			proc.kill("SIGKILL");
		}
	}, graceMs);
	// Clean up timer if process exits
	proc.once("close", () => clearTimeout(killTimer));
}

/**
 * Spawns the subagent pi process, streams JSON events, enforces caps,
 * and returns a SingleResult.
 */
export async function runSubagent(config: EngineConfig): Promise<SubagentResult> {
	const { agent, task, cwd, caps, signal } = config;

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0)
		args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	let state = initialEventState();
	let stderr = "";

	const result: SubagentResult = {
		agent: agent.name,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		model: agent.model,
		completed: false,
	};

	try {
		// Write system prompt to temp file
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);

		let wasAborted = false;
		let timedOut = false;
		let toolTimedOut = false;
		let turnLimited = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

			// ── Caps enforcement ──────────────────────────

			let globalTimer: NodeJS.Timeout | undefined;
			let toolTimer: NodeJS.Timeout | undefined;

			const cleanupTimers = () => {
				if (globalTimer) clearTimeout(globalTimer);
				if (toolTimer) clearTimeout(toolTimer);
			};

			const forceKill = (
				reason: "global_timeout" | "tool_timeout" | "turn_limit",
			) => {
				if (proc.killed || proc.exitCode !== null) return;
				if (reason === "tool_timeout") toolTimedOut = true;
				if (reason === "global_timeout") timedOut = true;
				if (reason === "turn_limit") turnLimited = true;
				killWithGrace(proc);
			};

			// Global process timeout
			if (caps.globalTimeout > 0) {
				globalTimer = setTimeout(
					() => forceKill("global_timeout"),
					caps.globalTimeout,
				);
				globalTimer.unref?.();
			}

			const clearToolTimer = () => {
				if (toolTimer) {
					clearTimeout(toolTimer);
					toolTimer = undefined;
				}
			};

			const startToolTimer = () => {
				clearToolTimer();
				if (caps.toolTimeout > 0) {
					toolTimer = setTimeout(
						() => forceKill("tool_timeout"),
						caps.toolTimeout,
					);
					toolTimer.unref?.();
				}
			};

			// ── Event processing ──────────────────────────

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: PiEvent;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				// Track tool calls for tool-level timeout
				if (
					event.type === "message_end" &&
					event.message?.role === "assistant"
				) {
					const msg = event.message;
					// Check if the assistant started a new tool call
					let hasPendingToolCall = false;
					const content = msg.content as
						| Array<Record<string, unknown>>
						| undefined;
					if (content) {
						for (const part of content) {
							if (part.type === "toolCall") {
								hasPendingToolCall = true;
								break;
							}
						}
					}
					if (hasPendingToolCall) {
						startToolTimer();
					}
				}

				if (event.type === "tool_result_end") {
					clearToolTimer();
				}

				state = processEvent(state, event);

				// Notify listener
				config.onEvent?.(state);

				// Check turn limit
				if (caps.maxTurns > 0 && state.usage.turns > caps.maxTurns) {
					forceKill("turn_limit");
				}
			};

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				cleanupTimers();
				clearToolTimer();
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				cleanupTimers();
				clearToolTimer();
				resolve(1);
			});

			// External abort signal
			if (signal) {
				const onAbort = () => {
					wasAborted = true;
					killWithGrace(proc);
				};
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
				}
			}
		});

		// Build result
		result.exitCode = exitCode;
		result.messages = state.messages;
		result.stderr = stderr;
		result.usage = state.usage;
		result.model = state.model || agent.model;
		result.completed = state.completed;
		result.reportDoneStatus = state.reportDoneStatus;
		result.reportDoneSummary = state.reportDoneSummary;
		result.reportDoneFindings = state.reportDoneFindings;

		if (wasAborted) {
			result.stopReason = "aborted";
			result.errorMessage = "Subagent was aborted";
		} else if (toolTimedOut) {
			result.stopReason = "tool_timeout";
			result.errorMessage = `Tool call exceeded ${caps.toolTimeout / 1000}s timeout`;
		} else if (timedOut) {
			result.stopReason = "timeout";
			result.errorMessage = `Subagent timed out after ${caps.globalTimeout / 1000}s`;
		} else if (turnLimited) {
			result.stopReason = "turn_limit";
			result.errorMessage = `Subagent exceeded turn limit of ${caps.maxTurns} turns`;
		} else if (!state.completed) {
			result.stopReason = "incomplete";
			result.errorMessage = "Subagent exited without calling report_done";
		} else {
			result.stopReason = state.stopReason || "completed";
		}

		return result;
	} finally {
		// Clean up temp files
		if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		}
		if (tmpPromptDir) {
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
		}
	}
}
