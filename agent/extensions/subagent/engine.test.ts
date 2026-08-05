/**
 * Unit tests for the subagent execution engine.
 *
 * Tests event parsing, completion detection, and usage aggregation
 * with mocked JSON event streams. Process spawning is not tested here.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
	hasReportDone,
	initialEventState,
	processEvent,
	processEventLines,
} from "./engine.ts";

// ── Helpers ───────────────────────────────────────────────────

/** Build a minimal assistant message with text. */
function assistantMsg(opts: {
	text?: string;
	toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
	usage?: Record<string, unknown>;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
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
		...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
	};
}

/** Build a tool result message. */
function toolResultMsg(
	toolCallId: string,
	output: string,
): Record<string, unknown> {
	return {
		role: "tool",
		content: [{ type: "toolResult", toolCallId, output }],
	};
}

/** Make a message_end event. */
function messageEnd(msg: Record<string, unknown>): Record<string, unknown> {
	return { type: "message_end", message: msg };
}

/** Make a tool_result_end event. */
function toolResultEnd(msg: Record<string, unknown>): Record<string, unknown> {
	return { type: "tool_result_end", message: msg };
}

function jsonLine(obj: Record<string, unknown>): string {
	return JSON.stringify(obj);
}

// ── hasReportDone ─────────────────────────────────────────────

describe("hasReportDone", () => {
	it("returns false for non-assistant messages", () => {
		const msg = { role: "user", content: [{ type: "text", text: "hi" }] };
		assert.strictEqual(hasReportDone(msg as any), false);
	});

	it("returns false when no tool calls present", () => {
		const msg = assistantMsg({ text: "I'm done!" });
		assert.strictEqual(hasReportDone(msg as any), false);
	});

	it("returns false when tool call is not report_done", () => {
		const msg = assistantMsg({
			text: "Let me read that file",
			toolCalls: [{ name: "read", args: { path: "/x" } }],
		});
		assert.strictEqual(hasReportDone(msg as any), false);
	});

	it("returns true when report_done is present", () => {
		const msg = assistantMsg({
			text: "Task complete",
			toolCalls: [
				{ name: "report_done", args: { status: "success", summary: "Done" } },
			],
		});
		assert.strictEqual(hasReportDone(msg as any), true);
	});

	it("returns true when report_done is among multiple tool calls", () => {
		const msg = assistantMsg({
			toolCalls: [
				{ name: "read", args: { path: "/x" } },
				{ name: "report_done", args: { status: "success", summary: "Done" } },
			],
		});
		assert.strictEqual(hasReportDone(msg as any), true);
	});
});

// ── processEvent ──────────────────────────────────────────────

describe("processEvent", () => {
	it("accumulates assistant messages", () => {
		const state = initialEventState();
		const msg = assistantMsg({ text: "Hello" });
		const next = processEvent(state, {
			type: "message_end",
			message: msg as any,
		});
		assert.strictEqual(next.messages.length, 1);
		assert.strictEqual(next.messages[0].role, "assistant");
	});

	it("accumulates tool result messages", () => {
		const state = initialEventState();
		const msg = toolResultMsg("tc1", "file contents");
		const next = processEvent(state, {
			type: "tool_result_end",
			message: msg as any,
		});
		assert.strictEqual(next.messages.length, 1);
		assert.strictEqual(next.messages[0].role, "tool");
	});

	it("counts turns from assistant messages", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({ text: "Turn 1" }) as any,
		});
		assert.strictEqual(state.usage.turns, 1);

		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({ text: "Turn 2" }) as any,
		});
		assert.strictEqual(state.usage.turns, 2);

		// Tool results don't increment turns
		state = processEvent(state, {
			type: "tool_result_end",
			message: toolResultMsg("tc1", "out") as any,
		});
		assert.strictEqual(state.usage.turns, 2);
	});

	it("aggregates usage stats across turns", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Turn 1",
				usage: {
					input: 100,
					output: 50,
					cacheRead: 10,
					cacheWrite: 5,
					cost: { total: 0.01 },
				},
			}) as any,
		});
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Turn 2",
				usage: {
					input: 200,
					output: 75,
					cacheRead: 0,
					cacheWrite: 0,
					cost: { total: 0.02 },
				},
			}) as any,
		});

		assert.strictEqual(state.usage.input, 300);
		assert.strictEqual(state.usage.output, 125);
		assert.strictEqual(state.usage.cacheRead, 10);
		assert.strictEqual(state.usage.cacheWrite, 5);
		assert.strictEqual(state.usage.cost, 0.03);
		assert.strictEqual(state.usage.turns, 2);
	});

	it("tracks contextTokens from the last message", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Turn 1",
				usage: { totalTokens: 5000 },
			}) as any,
		});
		assert.strictEqual(state.usage.contextTokens, 5000);

		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Turn 2",
				usage: { totalTokens: 8000 },
			}) as any,
		});
		assert.strictEqual(state.usage.contextTokens, 8000);
	});

	it("sets model from first assistant message", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({ text: "Hi", model: "claude-1" }) as any,
		});
		assert.strictEqual(state.model, "claude-1");

		// Second message doesn't overwrite
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({ text: "Bye", model: "claude-2" }) as any,
		});
		assert.strictEqual(state.model, "claude-1");
	});

	it("captures stopReason and errorMessage", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Oops",
				stopReason: "max_tokens",
				errorMessage: "Token limit reached",
			}) as any,
		});
		assert.strictEqual(state.stopReason, "max_tokens");
		assert.strictEqual(state.errorMessage, "Token limit reached");
	});

	it("detects report_done and marks completed", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Task complete",
				toolCalls: [
					{
						name: "report_done",
						args: { status: "success", summary: "All done" },
					},
				],
			}) as any,
		});
		assert.strictEqual(state.completed, true);
		assert.strictEqual(state.reportDoneStatus, "success");
		assert.strictEqual(state.reportDoneSummary, "All done");
	});

	it("report_done with partial status", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				toolCalls: [
					{
						name: "report_done",
						args: { status: "partial", summary: "Partially done" },
					},
				],
			}) as any,
		});
		assert.strictEqual(state.completed, true);
		assert.strictEqual(state.reportDoneStatus, "partial");
	});

	it("report_done with failed status", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				toolCalls: [
					{
						name: "report_done",
						args: { status: "failed", summary: "Could not complete" },
					},
				],
			}) as any,
		});
		assert.strictEqual(state.completed, true);
		assert.strictEqual(state.reportDoneStatus, "failed");
	});

	it("does not mark completed for regular tool calls", () => {
		let state = initialEventState();
		state = processEvent(state, {
			type: "message_end",
			message: assistantMsg({
				text: "Let me check",
				toolCalls: [{ name: "read", args: { path: "/x" } }],
			}) as any,
		});
		assert.strictEqual(state.completed, false);
	});

	it("does not mutate input state", () => {
		const state = initialEventState();
		const msg = assistantMsg({ text: "Hello" });
		const next = processEvent(state, {
			type: "message_end",
			message: msg as any,
		});
		assert.strictEqual(state.messages.length, 0);
		assert.strictEqual(next.messages.length, 1);
		assert.notStrictEqual(state.messages, next.messages);
		assert.notStrictEqual(state.usage, next.usage);
	});

	it("ignores unknown event types", () => {
		const state = initialEventState();
		const next = processEvent(state, {
			type: "unknown",
			message: assistantMsg({ text: "Hi" }) as any,
		});
		assert.strictEqual(next.messages.length, 0);
		assert.strictEqual(next.usage.turns, 0);
	});

	it("ignores events without a message", () => {
		const state = initialEventState();
		const next = processEvent(state, { type: "message_end" });
		assert.strictEqual(next.messages.length, 0);
	});
});

// ── processEventLines ─────────────────────────────────────────

describe("processEventLines", () => {
	it("processes a full subagent stream end-to-end", () => {
		const lines = [
			// Turn 1: read a file
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Let me read the file.",
						toolCalls: [{ name: "read", args: { file_path: "/tmp/test.txt" } }],
						usage: { input: 50, output: 20, cost: { total: 0.001 } },
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc1", "file contents here"))),
			// Turn 2: report_done
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "I've read the file. Task complete.",
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "Read the file" },
							},
						],
						usage: { input: 80, output: 30, cost: { total: 0.002 } },
					}),
				),
			),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.messages.length, 3);
		assert.strictEqual(state.usage.turns, 2);
		assert.strictEqual(state.usage.input, 130);
		assert.strictEqual(state.usage.output, 50);
		assert.strictEqual(state.usage.cost, 0.003);
		assert.strictEqual(state.completed, true);
		assert.strictEqual(state.reportDoneStatus, "success");
	});

	it("handles process exit without report_done", () => {
		const lines = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "I'm working on it.",
						toolCalls: [{ name: "read", args: { file_path: "/x" } }],
						usage: { input: 50, output: 20, cost: { total: 0.001 } },
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc1", "content"))),
			// Process exits - no report_done
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.messages.length, 2);
		assert.strictEqual(state.usage.turns, 1);
		assert.strictEqual(state.completed, false);
	});

	it("handles empty input", () => {
		const state = processEventLines([]);
		assert.strictEqual(state.messages.length, 0);
		assert.strictEqual(state.completed, false);
	});

	it("skips blank lines", () => {
		const lines = [
			"",
			"  ",
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Hi",
						usage: { input: 10, output: 5, cost: { total: 0 } },
					}),
				),
			),
			"",
		];
		const state = processEventLines(lines);
		assert.strictEqual(state.messages.length, 1);
	});

	it("skips malformed JSON lines", () => {
		const lines = [
			"not json",
			jsonLine(messageEnd(assistantMsg({ text: "Valid" }))),
			"{broken",
		];
		const state = processEventLines(lines);
		assert.strictEqual(state.messages.length, 1);
	});

	it("tracks multiple tool calls before report_done", () => {
		const lines = [
			// Turn 1
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [{ name: "read", args: { file_path: "/a" } }],
						usage: { input: 20, output: 10, cost: { total: 0.001 } },
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc1", "a content"))),
			// Turn 2
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [{ name: "bash", args: { command: "ls" } }],
						usage: { input: 30, output: 15, cost: { total: 0.001 } },
					}),
				),
			),
			jsonLine(toolResultEnd(toolResultMsg("tc2", "file list"))),
			// Turn 3
			jsonLine(
				messageEnd(
					assistantMsg({
						toolCalls: [
							{
								name: "report_done",
								args: { status: "success", summary: "All done" },
							},
						],
						usage: { input: 40, output: 20, cost: { total: 0.001 } },
					}),
				),
			),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.usage.turns, 3);
		assert.strictEqual(state.messages.length, 5); // 3 assistant + 2 tool results
		assert.strictEqual(state.completed, true);
	});

	it("handles usage without cost field", () => {
		const lines = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Done",
						usage: { input: 100, output: 50 },
					}),
				),
			),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.usage.input, 100);
		assert.strictEqual(state.usage.output, 50);
		assert.strictEqual(state.usage.cost, 0);
	});

	it("handles usage without cache fields", () => {
		const lines = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Done",
						usage: { input: 100, output: 50, cost: { total: 0.01 } },
					}),
				),
			),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.usage.cacheRead, 0);
		assert.strictEqual(state.usage.cacheWrite, 0);
	});

	it("stays incomplete when only tool calls without report_done", () => {
		const lines = [
			jsonLine(
				messageEnd(
					assistantMsg({
						text: "Working...",
						toolCalls: [
							{ name: "read", args: { file_path: "/x" } },
							{ name: "bash", args: { command: "test" } },
						],
					}),
				),
			),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.completed, false);
	});

	it("handles assistant messages with text only (no tool calls, no report_done)", () => {
		const lines = [
			jsonLine(messageEnd(assistantMsg({ text: "Here is the answer: 42" }))),
		];

		const state = processEventLines(lines);
		assert.strictEqual(state.messages.length, 1);
		assert.strictEqual(state.completed, false);
		assert.strictEqual(state.usage.turns, 1);
	});
});

// ── initialEventState ─────────────────────────────────────────

describe("initialEventState", () => {
	it("returns a clean zeroed state", () => {
		const state = initialEventState();
		assert.deepStrictEqual(state.messages, []);
		assert.strictEqual(state.completed, false);
		assert.strictEqual(state.usage.turns, 0);
		assert.strictEqual(state.usage.input, 0);
		assert.strictEqual(state.usage.output, 0);
		assert.strictEqual(state.usage.cacheRead, 0);
		assert.strictEqual(state.usage.cacheWrite, 0);
		assert.strictEqual(state.usage.cost, 0);
		assert.strictEqual(state.usage.contextTokens, 0);
		assert.strictEqual(state.model, undefined);
		assert.strictEqual(state.stopReason, undefined);
		assert.strictEqual(state.errorMessage, undefined);
		assert.strictEqual(state.reportDoneStatus, undefined);
		assert.strictEqual(state.reportDoneSummary, undefined);
	});
});
