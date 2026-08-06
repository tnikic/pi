/**
 * Unit tests for the TOON result formatter.
 *
 * Tests all formatting functions with controlled result objects.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";
import {
	displayStatus,
	formatUsageAggregate,
	isFailedResult,
} from "./status.ts";
import {
	formatChainToon,
	formatErrorToon,
	formatParallelToon,
	formatSingleToon,
	formatTokens,
	toonQuote,
} from "./toon-serialize.ts";

// ── Helpers ───────────────────────────────────────────────────

function makeResult(
	overrides: Partial<SubagentResult> & { usage?: Partial<SubagentUsage> } = {},
): SubagentResult {
	const { usage: usageOverride, ...rest } = overrides;
	return {
		agent: "scout",
		agentSource: "user",
		task: "Find auth-related files",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {
			input: 1000,
			output: 500,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 7,
			...usageOverride,
		},
		completed: true,
		reportDoneStatus: "success",
		reportDoneSummary: "Found auth-related files",
		reportDoneFindings: ["login.ts", "auth.ts", "session.ts"],
		...rest,
	};
}

// ── formatTokens ──────────────────────────────────────────────

describe("formatTokens", () => {
	it("returns raw number for values under 1000", () => {
		assert.strictEqual(formatTokens(0), "0");
		assert.strictEqual(formatTokens(1), "1");
		assert.strictEqual(formatTokens(500), "500");
		assert.strictEqual(formatTokens(999), "999");
	});

	it("returns 1 decimal with k for values 1000-9999", () => {
		assert.strictEqual(formatTokens(1000), "1.0k");
		assert.strictEqual(formatTokens(1500), "1.5k");
		assert.strictEqual(formatTokens(9999), "10.0k");
	});

	it("returns rounded k for values 10000-999999", () => {
		assert.strictEqual(formatTokens(10000), "10k");
		assert.strictEqual(formatTokens(12345), "12k");
		assert.strictEqual(formatTokens(999999), "1000k");
	});

	it("returns 1 decimal with M for values >= 1M", () => {
		assert.strictEqual(formatTokens(1000000), "1.0M");
		assert.strictEqual(formatTokens(1500000), "1.5M");
	});
});

// ── displayStatus ─────────────────────────────────────────────

describe("displayStatus", () => {
	it("returns report_done status when present", () => {
		const r = makeResult({ reportDoneStatus: "partial" });
		assert.strictEqual(displayStatus(r), "partial");
	});

	it('returns "success" for completed exit 0 without explicit status', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			completed: true,
			exitCode: 0,
		});
		assert.strictEqual(displayStatus(r), "success");
	});

	it('returns "timeout" for timeout stop reason', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			stopReason: "timeout",
			completed: false,
		});
		assert.strictEqual(displayStatus(r), "timeout");
	});

	it('returns "tool_timeout" for tool_timeout stop reason', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			stopReason: "tool_timeout",
			completed: false,
		});
		assert.strictEqual(displayStatus(r), "tool_timeout");
	});

	it('returns "turn_limit" for turn_limit stop reason', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			stopReason: "turn_limit",
			completed: false,
		});
		assert.strictEqual(displayStatus(r), "turn_limit");
	});

	it('returns "aborted" for aborted stop reason', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			stopReason: "aborted",
			completed: false,
		});
		assert.strictEqual(displayStatus(r), "aborted");
	});

	it('returns "incomplete" when no report_done and not completed', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			completed: false,
			exitCode: 0,
			stopReason: undefined,
		});
		assert.strictEqual(displayStatus(r), "incomplete");
	});

	it('returns "failed" for non-zero exit code', () => {
		const r = makeResult({
			reportDoneStatus: undefined,
			completed: false,
			exitCode: 1,
		});
		assert.strictEqual(displayStatus(r), "failed");
	});
});

// ── isFailedResult ────────────────────────────────────────────

describe("isFailedResult", () => {
	it("returns false for successful completed result", () => {
		assert.strictEqual(isFailedResult(makeResult()), false);
	});

	it("returns true when exitCode is non-zero", () => {
		assert.strictEqual(isFailedResult(makeResult({ exitCode: 1 })), true);
	});

	it("returns true for timeout", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: "timeout",
				}),
			),
			true,
		);
	});

	it("returns true for tool_timeout", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: "tool_timeout",
				}),
			),
			true,
		);
	});

	it("returns true for turn_limit", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: "turn_limit",
				}),
			),
			true,
		);
	});

	it("returns true for aborted", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: "aborted",
				}),
			),
			true,
		);
	});

	it("returns true for incomplete (not completed)", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: undefined,
				}),
			),
			true,
		);
	});

	it("returns true for error stop reason", () => {
		assert.strictEqual(
			isFailedResult(
				makeResult({
					exitCode: 0,
					completed: false,
					stopReason: "error",
				}),
			),
			true,
		);
	});
});

// ── toonQuote ─────────────────────────────────────────────────

describe("toonQuote", () => {
	it("returns simple values as-is", () => {
		assert.strictEqual(toonQuote("scout"), "scout");
		assert.strictEqual(toonQuote("success"), "success");
		assert.strictEqual(toonQuote("login.ts"), "login.ts");
	});

	it("quotes values with spaces", () => {
		assert.strictEqual(toonQuote("hello world"), '"hello world"');
	});

	it("quotes values with commas", () => {
		assert.strictEqual(toonQuote("a,b"), '"a,b"');
	});

	it("quotes empty string", () => {
		assert.strictEqual(toonQuote(""), '""');
	});

	it("escapes double quotes inside value", () => {
		assert.strictEqual(toonQuote('say "hello"'), '"say \\"hello\\""');
	});

	it("quotes values with colons", () => {
		assert.strictEqual(toonQuote("a:b"), '"a:b"');
	});

	it("quotes values with brackets", () => {
		assert.strictEqual(toonQuote("[1]"), '"[1]"');
		assert.strictEqual(toonQuote("{col}"), '"{col}"');
	});
});

// ── formatSingleToon ──────────────────────────────────────────

describe("formatSingleToon", () => {
	it("formats a successful result with all fields", () => {
		const result = makeResult();
		const output = formatSingleToon(result);
		assert.match(output, /^agent: scout$/m);
		assert.match(output, /^status: success$/m);
		assert.match(output, /^turns: 7$/m);
		assert.match(output, /^tokens:/m);
		assert.match(output, /^summary: "Found auth-related files"$/m);
		assert.match(output, /^findings\[3\]: login\.ts,auth\.ts,session\.ts$/m);
	});

	it("formats a result without findings", () => {
		const result = makeResult({ reportDoneFindings: undefined });
		const output = formatSingleToon(result);
		assert.match(output, /^agent: scout$/m);
		assert.match(output, /^status: success$/m);
		assert.strictEqual(output.includes("findings"), false);
	});

	it("formats a result with empty findings array", () => {
		const result = makeResult({ reportDoneFindings: [] });
		const output = formatSingleToon(result);
		assert.strictEqual(output.includes("findings"), false);
	});

	it("formats a result with partial status", () => {
		const result = makeResult({
			reportDoneStatus: "partial",
			reportDoneFindings: undefined,
		});
		const output = formatSingleToon(result);
		assert.match(output, /^status: partial$/m);
	});

	it("formats a result without summary", () => {
		const result = makeResult({
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatSingleToon(result);
		assert.strictEqual(output.includes("summary:"), false);
	});

	it("quotes agent name with spaces", () => {
		const result = makeResult({
			agent: "code reviewer",
			reportDoneFindings: undefined,
		});
		const output = formatSingleToon(result);
		assert.match(output, /^agent: "code reviewer"$/m);
	});

	it("falls back to error format for failed results", () => {
		const result = makeResult({
			exitCode: 0,
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatSingleToon(result);
		assert.match(output, /^error:/m);
		assert.match(output, /^help:/m);
	});

	it("includes tokens as sum of input and output", () => {
		const result = makeResult({
			usage: { input: 8000, output: 2000, turns: 5 },
			reportDoneFindings: undefined,
		});
		const output = formatSingleToon(result);
		assert.match(output, /^tokens: 10k$/m);
	});
});

// ── formatErrorToon ───────────────────────────────────────────

describe("formatErrorToon", () => {
	it("formats timeout error with distinct message", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /^error: subagent "scout" timed out after 5 minutes/m);
		assert.match(output, /^help: retry with a longer global timeout/m);
	});

	it("formats tool_timeout error with distinct message", () => {
		const result = makeResult({
			completed: false,
			stopReason: "tool_timeout",
			errorMessage: "Tool call exceeded 60s timeout",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /tool call exceeded 60s timeout/);
		assert.match(output, /help: increase toolTimeout/);
	});

	it("formats turn_limit error with distinct message", () => {
		const result = makeResult({
			completed: false,
			stopReason: "turn_limit",
			errorMessage: "Subagent exceeded turn limit of 20 turns",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /exceeded turn limit of 20 turns/);
		assert.match(output, /help: increase maxTurns/);
	});

	it("formats aborted error with distinct message", () => {
		const result = makeResult({
			completed: false,
			stopReason: "aborted",
			errorMessage: "Subagent was aborted",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /was aborted/);
		assert.match(output, /help: the operation was canceled/);
	});

	it("formats incomplete (no report_done) error", () => {
		const result = makeResult({
			completed: false,
			stopReason: "incomplete",
			errorMessage: "Subagent exited without calling report_done",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /exited without calling report_done/);
		assert.match(output, /help: the subagent may not have understood/);
	});

	it("handles unknown stop reason as incomplete", () => {
		const result = makeResult({
			completed: false,
			stopReason: undefined,
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /exited without calling report_done/);
	});

	it("includes partial output from report_done summary", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneSummary: "Partially found some files",
			reportDoneFindings: undefined,
		});
		const output = formatErrorToon(result);
		assert.match(output, /^partial: "Partially found some files"$/m);
	});

	it("includes partial output from messages when no summary", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "I found login.ts" }],
				},
			],
		});
		const output = formatErrorToon(result);
		assert.match(output, /^partial:/m);
		assert.match(output, /"I found login\.ts"/);
	});

	it("includes partial output from stderr as fallback", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
			messages: [],
			stderr: "Some error output",
		});
		const output = formatErrorToon(result);
		assert.match(output, /^partial: "Some error output"$/m);
	});

	it("truncates long partial output", () => {
		const longText = `word ${"x".repeat(300)}`;
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
			messages: [
				{ role: "assistant", content: [{ type: "text", text: longText }] },
			],
		});
		const output = formatErrorToon(result);
		const partialLine = output
			.split("\n")
			.find((l) => l.startsWith("partial:"));
		assert.ok(partialLine);
		assert.ok(partialLine.length <= 220); // 200 chars + quotes + "partial: " prefix
		assert.match(partialLine, /\.\.\."$/);
	});

	it("does not include partial line when no output available", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneSummary: undefined,
			reportDoneFindings: undefined,
			messages: [],
			stderr: "",
		});
		const output = formatErrorToon(result);
		assert.strictEqual(output.includes("partial:"), false);
	});
});

// ── formatParallelToon ────────────────────────────────────────

describe("formatParallelToon", () => {
	it("formats parallel results as keyed tabular", () => {
		const results = [
			makeResult({
				agent: "scout",
				usage: { input: 7000, output: 2400, turns: 7 },
			}),
			makeResult({
				agent: "worker",
				usage: { input: 3000, output: 2000, turns: 3 },
				reportDoneFindings: undefined,
			}),
			makeResult({
				agent: "reviewer",
				usage: { input: 5000, output: 3000, turns: 5 },
				reportDoneFindings: undefined,
			}),
		];
		const output = formatParallelToon(results);

		// Header
		assert.match(output, /^subagents\[3\]\{agent,status,turns,tokens\}:$/m);

		// Rows
		assert.match(output, /^ {2}scout,success,7,9.4k$/m);
		assert.match(output, /^ {2}worker,success,3,5.0k$/m);
		assert.match(output, /^ {2}reviewer,success,5,8.0k$/m);

		// Aggregate
		assert.match(output, /^total: 3 agents, 15 turns, 22k tokens$/m);
	});

	it("shows failed agents in total line", () => {
		const results = [
			makeResult({ agent: "scout" }),
			makeResult({
				agent: "worker",
				completed: false,
				stopReason: "timeout",
				reportDoneStatus: undefined,
				reportDoneSummary: undefined,
				reportDoneFindings: undefined,
			}),
		];
		const output = formatParallelToon(results);
		assert.match(output, / {2}worker,timeout,7,1.5k$/m);
		assert.match(output, /total: 2 agents \(1 ok, 1 failed\)/);
	});

	it("handles single result", () => {
		const results = [makeResult()];
		const output = formatParallelToon(results);
		assert.match(output, /^subagents\[1\]/m);
		assert.match(output, /^total: 1 agents, 7 turns/m);
	});
});

// ── formatChainToon ───────────────────────────────────────────

describe("formatChainToon", () => {
	it("formats chain results as keyed tabular", () => {
		const results = [
			makeResult({
				agent: "scout",
				step: 1,
				usage: { input: 7000, output: 2400, turns: 7 },
			}),
			makeResult({
				agent: "worker",
				step: 2,
				usage: { input: 3000, output: 2000, turns: 3 },
				reportDoneFindings: undefined,
			}),
			makeResult({
				agent: "reviewer",
				step: 3,
				usage: { input: 5000, output: 3000, turns: 5 },
				reportDoneFindings: undefined,
			}),
		];
		const output = formatChainToon(results);

		// Header
		assert.match(output, /^chain\[3\]\{step,agent,status,turns,tokens\}:$/m);

		// Rows
		assert.match(output, /^ {2}1,scout,success,7,9.4k$/m);
		assert.match(output, /^ {2}2,worker,success,3,5.0k$/m);
		assert.match(output, /^ {2}3,reviewer,success,5,8.0k$/m);

		// Aggregate
		assert.match(output, /^total: 3 steps, 15 turns, 22k tokens$/m);
	});

	it("shows skipped steps (exitCode -1, no stopReason)", () => {
		const results = [
			makeResult({ agent: "scout", step: 1 }),
			makeResult({
				agent: "worker",
				step: 2,
				completed: false,
				exitCode: -1,
				stopReason: undefined,
				reportDoneStatus: undefined,
				reportDoneSummary: undefined,
				reportDoneFindings: undefined,
				usage: { input: 0, output: 0, turns: 0 },
			}),
			makeResult({
				agent: "reviewer",
				step: 3,
				completed: false,
				exitCode: -1,
				stopReason: undefined,
				reportDoneStatus: undefined,
				reportDoneSummary: undefined,
				reportDoneFindings: undefined,
				usage: { input: 0, output: 0, turns: 0 },
			}),
		];
		const output = formatChainToon(results);
		assert.match(output, /^ {2}2,worker,-,-,-$/m);
		assert.match(output, /^ {2}3,reviewer,-,-,-$/m);
		assert.match(output, /2 skipped/);
	});

	it("shows failed step with error status", () => {
		const results = [
			makeResult({ agent: "scout", step: 1 }),
			makeResult({
				agent: "worker",
				step: 2,
				completed: false,
				stopReason: "turn_limit",
				reportDoneStatus: undefined,
				reportDoneSummary: undefined,
				reportDoneFindings: undefined,
			}),
		];
		const output = formatChainToon(results);
		assert.match(output, / {2}2,worker,turn_limit/);
		assert.match(output, /1 failed/);
	});
});

// ── formatUsageAggregate ──────────────────────────────────────

describe("formatUsageAggregate", () => {
	it("sums usage across all results", () => {
		const results = [
			makeResult({
				usage: {
					input: 1000,
					output: 500,
					turns: 3,
					cacheRead: 10,
					cacheWrite: 5,
					cost: 0.01,
				},
			}),
			makeResult({
				agent: "worker",
				usage: {
					input: 2000,
					output: 1000,
					turns: 5,
					cacheRead: 20,
					cacheWrite: 10,
					cost: 0.02,
				},
				reportDoneFindings: undefined,
			}),
		];
		const agg = formatUsageAggregate(results);
		assert.strictEqual(agg.input, 3000);
		assert.strictEqual(agg.output, 1500);
		assert.strictEqual(agg.tokens, 4500);
		assert.strictEqual(agg.turns, 8);
		assert.strictEqual(agg.cacheRead, 30);
		assert.strictEqual(agg.cacheWrite, 15);
		assert.strictEqual(agg.cost, 0.03);
	});

	it("handles empty results", () => {
		const agg = formatUsageAggregate([]);
		assert.strictEqual(agg.input, 0);
		assert.strictEqual(agg.output, 0);
		assert.strictEqual(agg.turns, 0);
	});
});

// ── Integration: end-to-end format scenarios ──────────────────

describe("integration scenarios", () => {
	it("full success: single agent with findings", () => {
		const result = makeResult();
		const output = formatSingleToon(result);
		const expected = [
			"agent: scout",
			"status: success",
			"turns: 7",
			"tokens: 1.5k",
			'summary: "Found auth-related files"',
			"findings[3]: login.ts,auth.ts,session.ts",
		].join("\n");
		assert.strictEqual(output, expected);
	});

	it("timeout with partial summary", () => {
		const result = makeResult({
			completed: false,
			stopReason: "timeout",
			errorMessage: "Subagent timed out after 300s",
			reportDoneStatus: undefined,
			reportDoneFindings: undefined,
			reportDoneSummary: "Found login.ts before timeout",
		});
		const output = formatSingleToon(result);
		assert.match(output, /^error: subagent "scout" timed out after 5 minutes/m);
		assert.match(output, /^help: retry with a longer global timeout/m);
		assert.match(output, /^partial: "Found login\.ts before timeout"$/m);
	});

	it("parallel with mix of success and failure", () => {
		const results = [
			makeResult({
				agent: "alpha",
				usage: { input: 5000, output: 2000, turns: 4 },
			}),
			makeResult({
				agent: "beta",
				completed: false,
				stopReason: "turn_limit",
				errorMessage: "Subagent exceeded turn limit of 20 turns",
				reportDoneStatus: undefined,
				reportDoneSummary: undefined,
				reportDoneFindings: undefined,
				usage: { input: 3000, output: 1000, turns: 20 },
			}),
			makeResult({
				agent: "gamma",
				usage: { input: 2000, output: 500, turns: 2 },
				reportDoneFindings: undefined,
			}),
		];
		const output = formatParallelToon(results);
		const lines = output.split("\n");
		assert.strictEqual(lines[0], "subagents[3]{agent,status,turns,tokens}:");
		assert.strictEqual(lines[1], "  alpha,success,4,7.0k");
		assert.strictEqual(lines[2], "  beta,turn_limit,20,4.0k");
		assert.strictEqual(lines[3], "  gamma,success,2,2.5k");
		assert.match(lines[4], /total: 3 agents \(2 ok, 1 failed\)/);
	});

	it("chain all success", () => {
		const results = [
			makeResult({
				agent: "step1",
				step: 1,
				usage: { input: 2000, output: 500, turns: 3 },
				reportDoneFindings: undefined,
			}),
			makeResult({
				agent: "step2",
				step: 2,
				usage: { input: 3000, output: 1000, turns: 5 },
				reportDoneFindings: undefined,
			}),
		];
		const output = formatChainToon(results);
		const lines = output.split("\n");
		assert.strictEqual(lines[0], "chain[2]{step,agent,status,turns,tokens}:");
		assert.strictEqual(lines[1], "  1,step1,success,3,2.5k");
		assert.strictEqual(lines[2], "  2,step2,success,5,4.0k");
		assert.match(lines[3], /total: 2 steps, 8 turns, 6\.5k tokens/);
	});
});
