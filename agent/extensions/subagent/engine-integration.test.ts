/**
 * Integration tests for the subagent execution engine.
 *
 * Uses a fake SpawnFn that emits pre-determined JSON events instead of
 * spawning real pi processes. Validates the full pipeline from
 * runSubagent() → SpawnFn → SubagentResult without process overhead.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { AgentConfig } from "./agent-config.ts";
import {
	COMPLETION_INSTRUCTION,
	type EngineConfig,
	type EventState,
	initialEventState,
	processEvent,
	runSubagent,
	type SpawnFn,
	type SubagentResult,
} from "./engine.ts";

// ── Fake spawner factory ──────────────────────────────────────

/**
 * Creates a fake SpawnFn that simulates a subagent process by processing
 * the given JSON event lines through the pure event pipeline.
 *
 * Mirrors the result-construction logic from pi-process.ts so the full
 * runSubagent → result path is exercised without spawning a process.
 */
function fakeSpawnFn(eventLines: string[]): SpawnFn {
	return async (config: EngineConfig): Promise<SubagentResult> => {
		let state = initialEventState();

		for (const line of eventLines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line);
				state = processEvent(state, event);
				config.onEvent?.(state);
			} catch {}
		}

		const result: SubagentResult = {
			agent: config.agent.name,
			agentSource: config.agent.source,
			task: config.task,
			exitCode: 0,
			messages: state.messages,
			stderr: "",
			usage: state.usage,
			model: state.model || config.agent.model,
			completed: state.completed,
			reportDoneStatus: state.reportDoneStatus,
			reportDoneSummary: state.reportDoneSummary,
			reportDoneFindings: state.reportDoneFindings,
		};

		if (!state.completed) {
			result.stopReason = "incomplete";
			result.errorMessage = "Subagent exited without calling report_done";
		} else {
			result.stopReason = state.stopReason || "completed";
		}

		return result;
	};
}

/**
 * Creates a fake SpawnFn that also tracks invocation for assertion.
 */
function trackingFakeSpawnFn(eventLines: string[]): {
	spawnFn: SpawnFn;
	invocations: EngineConfig[];
} {
	const invocations: EngineConfig[] = [];
	const base = fakeSpawnFn(eventLines);
	const spawnFn: SpawnFn = async (config) => {
		invocations.push(config);
		return base(config);
	};
	return { spawnFn, invocations };
}

// ── Helpers (mirror engine.test.ts patterns) ──────────────────

function assistantMsg(opts: {
	text?: string;
	toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
	usage?: Record<string, unknown>;
	model?: string;
	stopReason?: string;
}): Record<string, unknown> {
	const content: Record<string, unknown>[] = [];
	if (opts.text) content.push({ type: "text", text: opts.text });
	if (opts.toolCalls) {
		for (const tc of opts.toolCalls) {
			content.push({ type: "toolCall", name: tc.name, arguments: tc.args });
		}
	}
	return {
		role: "assistant",
		content,
		...(opts.usage ? { usage: opts.usage } : {}),
		...(opts.model ? { model: opts.model } : {}),
		...(opts.stopReason ? { stopReason: opts.stopReason } : {}),
	};
}

function toolResultMsg(
	toolCallId: string,
	output: string,
): Record<string, unknown> {
	return {
		role: "tool",
		content: [{ type: "toolResult", toolCallId, output }],
	};
}

function messageEnd(msg: Record<string, unknown>): Record<string, unknown> {
	return { type: "message_end", message: msg };
}

function toolResultEnd(msg: Record<string, unknown>): Record<string, unknown> {
	return { type: "tool_result_end", message: msg };
}

function jsonLine(obj: Record<string, unknown>): string {
	return JSON.stringify(obj);
}

// ── Minimal agent config for tests ────────────────────────────

function testAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "A test agent",
		systemPrompt: "You are a test agent.",
		source: "user",
		filePath: "/agents/test-agent.md",
		...overrides,
	};
}

function testConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
	return {
		agent: testAgent(),
		task: "Run some tests",
		cwd: "/tmp/test",
		caps: {
			toolTimeout: 120_000,
			globalTimeout: 300_000,
			maxTurns: 20,
		},
		...overrides,
	};
}

// ── Integration tests ─────────────────────────────────────────

describe("runSubagent integration (fake SpawnFn)", () => {
	it("completes successfully when report_done is emitted", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "I've completed the task.",
						toolCalls: [
							{
								name: "report_done",
								args: {
									status: "success",
									summary: "Task accomplished",
									findings: ["file1.ts changed", "file2.ts added"],
								},
							},
						],
						usage: { input: 100, output: 50, cost: { total: 0.01 } },
					}),
				),
			),
		];

		const { spawnFn, invocations } = trackingFakeSpawnFn(events);
		const config = testConfig();
		const result = await runSubagent(config, spawnFn);

		assert.strictEqual(result.completed, true);
		assert.strictEqual(result.reportDoneStatus, "success");
		assert.strictEqual(result.reportDoneSummary, "Task accomplished");
		assert.deepStrictEqual(result.reportDoneFindings, [
			"file1.ts changed",
			"file2.ts added",
		]);
		assert.strictEqual(result.agent, "test-agent");
		assert.strictEqual(result.agentSource, "user");
		assert.strictEqual(result.stopReason, "completed");
		assert.strictEqual(result.exitCode, 0);
		assert.strictEqual(result.errorMessage, undefined);
		assert.strictEqual(invocations.length, 1);
	});

	it("marks incomplete when no report_done is emitted", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Here is the answer: 42",
						usage: { input: 50, output: 20, cost: { total: 0.005 } },
					}),
				),
			),
		];

		const result = await runSubagent(testConfig(), fakeSpawnFn(events));

		assert.strictEqual(result.completed, false);
		assert.strictEqual(result.stopReason, "incomplete");
		assert.strictEqual(
			result.errorMessage,
			"Subagent exited without calling report_done",
		);
		assert.strictEqual(result.reportDoneStatus, undefined);
	});

	it("marks incomplete when only tool calls without report_done", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Let me read the file.",
						toolCalls: [{ name: "read", args: { file_path: "/tmp/test.txt" } }],
						usage: { input: 40, output: 15, cost: { total: 0.003 } },
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc1", "file contents"))),
			// Subagent exits without calling report_done
		];

		const result = await runSubagent(testConfig(), fakeSpawnFn(events));

		assert.strictEqual(result.completed, false);
		assert.strictEqual(result.stopReason, "incomplete");
		assert.strictEqual(result.messages.length, 2); // assistant + tool result
		assert.strictEqual(result.usage.turns, 1);
	});

	it("aggregates usage across multiple turns", async () => {
		const events = [
			// Turn 1: read file
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [{ name: "read", args: { file_path: "/a" } }],
						usage: {
							input: 30,
							output: 10,
							cacheRead: 5,
							cacheWrite: 2,
							cost: { total: 0.001 },
						},
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc1", "content a"))),
			// Turn 2: run bash
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [{ name: "bash", args: { command: "ls" } }],
						usage: {
							input: 25,
							output: 8,
							cacheRead: 0,
							cacheWrite: 0,
							cost: { total: 0.0008 },
						},
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc2", "file list"))),
			// Turn 3: report_done
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "All done.",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "Done" },
							},
						],
						usage: { input: 20, output: 5, cost: { total: 0.0005 } },
					}),
				),
			),
		];

		const result = await runSubagent(testConfig(), fakeSpawnFn(events));

		assert.strictEqual(result.completed, true);
		assert.strictEqual(result.usage.turns, 3);
		assert.strictEqual(result.usage.input, 75);
		assert.strictEqual(result.usage.output, 23);
		assert.strictEqual(result.usage.cacheRead, 5);
		assert.strictEqual(result.usage.cacheWrite, 2);
		assert.strictEqual(result.messages.length, 5); // 3 assistant + 2 tool results
	});

	it("fires onEvent callback with updated state", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Working...",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "OK" },
							},
						],
						usage: { input: 10, output: 5, cost: { total: 0.001 } },
					}),
				),
			),
		];

		const capturedStates: EventState[] = [];
		const config = testConfig({
			onEvent: (state) => {
				capturedStates.push({ ...state, messages: [...state.messages] });
			},
		});

		await runSubagent(config, fakeSpawnFn(events));

		assert.strictEqual(capturedStates.length, 1);
		assert.strictEqual(capturedStates[0].completed, true);
		assert.strictEqual(capturedStates[0].reportDoneStatus, "success");
		assert.strictEqual(capturedStates[0].usage.turns, 1);
	});

	it("preserves report_done with partial status", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [
							{
								name: "report_done",
								args: { status: "partial", summary: "Some parts done" },
							},
						],
					}),
				),
			),
		];

		const result = await runSubagent(testConfig(), fakeSpawnFn(events));

		assert.strictEqual(result.completed, true);
		assert.strictEqual(result.reportDoneStatus, "partial");
		assert.strictEqual(result.reportDoneSummary, "Some parts done");
	});

	it("preserves report_done with failed status", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [
							{
								name: "report_done",
								args: { status: "failed", summary: "Could not complete" },
							},
						],
					}),
				),
			),
		];

		const result = await runSubagent(testConfig(), fakeSpawnFn(events));

		assert.strictEqual(result.completed, true);
		assert.strictEqual(result.reportDoneStatus, "failed");
		assert.strictEqual(result.reportDoneSummary, "Could not complete");
	});

	it("passes agent identity through to result", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Done.",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "OK" },
							},
						],
					}),
				),
			),
		];

		const agent = testAgent({
			name: "custom-agent",
			source: "project",
			model: "claude-1",
		});
		const config = testConfig({ agent, task: "Custom task" });

		const result = await runSubagent(config, fakeSpawnFn(events));

		assert.strictEqual(result.agent, "custom-agent");
		assert.strictEqual(result.agentSource, "project");
		assert.strictEqual(result.task, "Custom task");
	});

	it("captures model from first assistant message", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Hello",
						model: "claude-sonnet-4-20250514",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "Done" },
							},
						],
					}),
				),
			),
		];

		const result = await runSubagent(
			testConfig({ agent: testAgent({ model: undefined }) }),
			fakeSpawnFn(events),
		);

		assert.strictEqual(result.model, "claude-sonnet-4-20250514");
	});

	it("falls back to agent model when event has no model", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Done",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "OK" },
							},
						],
					}),
				),
			),
		];

		const result = await runSubagent(
			testConfig({ agent: testAgent({ model: "fallback-model" }) }),
			fakeSpawnFn(events),
		);

		assert.strictEqual(result.model, "fallback-model");
	});

	it("handles empty event stream (subagent exits immediately)", async () => {
		const result = await runSubagent(testConfig(), fakeSpawnFn([]));

		assert.strictEqual(result.completed, false);
		assert.strictEqual(result.stopReason, "incomplete");
		assert.strictEqual(result.messages.length, 0);
		assert.strictEqual(result.usage.turns, 0);
		assert.strictEqual(result.usage.input, 0);
	});

	it("task includes COMPLETION_INSTRUCTION when passed to spawner", async () => {
		// We verify that the engine config carries COMPLETION_INSTRUCTION
		// in its contract — the actual appending is done by spawnSubprocess
		// in pi-process.ts. Here we confirm the task field flows through.
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "OK" },
							},
						],
					}),
				),
			),
		];

		const { spawnFn, invocations } = trackingFakeSpawnFn(events);
		const config = testConfig({ task: "Original task" });
		await runSubagent(config, spawnFn);

		assert.strictEqual(invocations.length, 1);
		// The engine receives the task as-is; COMPLETION_INSTRUCTION is
		// appended by the real spawner (spawnSubprocess) before spawning.
		// Here we verify the task is preserved through the seam.
		assert.strictEqual(invocations[0].task, "Original task");
	});

	it("COMPLETION_INSTRUCTION references report_done tool", () => {
		// Sanity: verify the constant that the real spawner appends.
		assert.ok(COMPLETION_INSTRUCTION.includes("report_done"));
		assert.ok(COMPLETION_INSTRUCTION.includes("Completion contract"));
	});
});

// ── Fake spawner itself ───────────────────────────────────────

describe("fakeSpawnFn", () => {
	it("returns a properly shaped SubagentResult", async () => {
		const events = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Task complete",
						toolCalls: [
							{
								name: "report_done",
								args: {
									status: "success",
									summary: "All done",
									findings: ["f1", "f2"],
								},
							},
						],
						usage: { input: 100, output: 50, cost: { total: 0.01 } },
						stopReason: "end_turn",
					}),
				),
			),
		];

		const result = await runSubagent(
			testConfig({ agent: testAgent({ model: "gpt-5" }) }),
			fakeSpawnFn(events),
		);

		// Verify complete shape
		assert.strictEqual(typeof result.agent, "string");
		assert.strictEqual(typeof result.agentSource, "string");
		assert.strictEqual(typeof result.task, "string");
		assert.strictEqual(typeof result.exitCode, "number");
		assert.ok(Array.isArray(result.messages));
		assert.strictEqual(typeof result.stderr, "string");
		assert.strictEqual(typeof result.usage, "object");
		assert.strictEqual(typeof result.usage.input, "number");
		assert.strictEqual(typeof result.usage.output, "number");
		assert.strictEqual(typeof result.usage.cacheRead, "number");
		assert.strictEqual(typeof result.usage.cacheWrite, "number");
		assert.strictEqual(typeof result.usage.cost, "number");
		assert.strictEqual(typeof result.usage.contextTokens, "number");
		assert.strictEqual(typeof result.usage.turns, "number");
		assert.strictEqual(result.model, "gpt-5");
		assert.strictEqual(result.stopReason, "end_turn");
		assert.strictEqual(result.completed, true);
		assert.strictEqual(result.reportDoneStatus, "success");
		assert.strictEqual(result.reportDoneSummary, "All done");
		assert.deepStrictEqual(result.reportDoneFindings, ["f1", "f2"]);
		assert.strictEqual(result.errorMessage, undefined);
	});
});
