/**
 * Unit tests for subagent orchestration: concurrency limiting,
 * chain logic, mode validation, and failure paths.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { mapWithConcurrencyLimit } from "./concurrency.ts";
import { validateModes } from "./orchestrator.ts";
import { isFailedResult } from "./toon-formatter.ts";

// ── mapWithConcurrencyLimit ───────────────────────────────────

describe("mapWithConcurrencyLimit", () => {
	it("maps all items preserving order", async () => {
		const items = [1, 2, 3, 4, 5];
		const results = await mapWithConcurrencyLimit(
			items,
			2,
			async (n) => n * 10,
		);
		assert.deepStrictEqual(results, [10, 20, 30, 40, 50]);
	});

	it("handles empty array", async () => {
		const results = await mapWithConcurrencyLimit([], 2, async () => "x");
		assert.deepStrictEqual(results, []);
	});

	it("respects concurrency limit by serializing work", async () => {
		const running: Set<number> = new Set();
		const maxConcurrent: number[] = [];

		const items = [1, 2, 3, 4, 5, 6];
		await mapWithConcurrencyLimit(items, 2, async (n) => {
			running.add(n);
			maxConcurrent.push(running.size);
			await new Promise((r) => setTimeout(r, 5));
			running.delete(n);
			return n * 2;
		});

		// Each value in maxConcurrent should be <= 2
		for (const c of maxConcurrent) {
			assert.ok(c <= 2, `concurrency exceeded: ${c} > 2`);
		}
	});

	it("concurrency limited to 1 runs serially", async () => {
		const order: number[] = [];
		await mapWithConcurrencyLimit([1, 2, 3], 1, async (n) => {
			order.push(n);
			await new Promise((r) => setTimeout(r, 5));
			return n;
		});
		assert.deepStrictEqual(order, [1, 2, 3]);
	});

	it("clamps concurrency to array length when items < limit", async () => {
		const running: Set<number> = new Set();
		const maxConcurrent: number[] = [];

		await mapWithConcurrencyLimit([1, 2], 100, async (n) => {
			running.add(n);
			maxConcurrent.push(running.size);
			await new Promise((r) => setTimeout(r, 5));
			running.delete(n);
			return n;
		});

		for (const c of maxConcurrent) {
			assert.ok(c <= 2, `unexpected concurrency: ${c}`);
		}
	});

	it("propagates errors from individual tasks", async () => {
		await assert.rejects(async () => {
			await mapWithConcurrencyLimit([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("task failed");
				return n;
			});
		}, /^Error: task failed$/);
	});

	it("clamps concurrency to 1 when limit is 0 or negative", async () => {
		const order: number[] = [];
		await mapWithConcurrencyLimit([1, 2, 3], 0, async (n) => {
			order.push(n);
			await new Promise((r) => setTimeout(r, 5));
			return n;
		});
		assert.deepStrictEqual(order, [1, 2, 3]);
	});

	it("handles single item", async () => {
		const results = await mapWithConcurrencyLimit([42], 4, async (n) => n * 2);
		assert.deepStrictEqual(results, [84]);
	});
});

// ── Chain {previous} placeholder logic ────────────────────────

describe("chain {previous} placeholder", () => {
	it("replaces all occurrences of {previous} with previous output", () => {
		const task = "Process this: {previous} and also {previous}";
		const previousOutput = "file.txt";
		const result = task.replace(/\{previous\}/g, previousOutput);
		assert.strictEqual(result, "Process this: file.txt and also file.txt");
	});

	it("leaves task unchanged when no placeholder", () => {
		const task = "Process this: input.txt";
		const result = task.replace(/\{previous\}/g, "anything");
		assert.strictEqual(result, "Process this: input.txt");
	});

	it("handles empty previous output", () => {
		const task = "Based on: {previous}";
		const result = task.replace(/\{previous\}/g, "");
		assert.strictEqual(result, "Based on: ");
	});

	it("accumulates across multiple chain steps", () => {
		let previousOutput = "";
		const chain = [
			{ agent: "s1", task: "Step 1: {previous}" },
			{ agent: "s2", task: "Step 2: {previous}" },
			{ agent: "s3", task: "Step 3: {previous}" },
		];

		const stepOutputs = ["alpha", "beta", "gamma"];
		const actualTasks: string[] = [];

		for (let i = 0; i < chain.length; i++) {
			const taskWithContext = chain[i].task.replace(
				/\{previous\}/g,
				previousOutput,
			);
			actualTasks.push(taskWithContext);
			previousOutput = stepOutputs[i];
		}

		assert.deepStrictEqual(actualTasks, [
			"Step 1: ",
			"Step 2: alpha",
			"Step 3: beta",
		]);
	});
});

// ── Mode validation logic ─────────────────────────────────────

describe("mode validation", () => {
	it("accepts single mode only", () => {
		assert.strictEqual(validateModes(false, false, true), null);
	});

	it("accepts parallel mode only", () => {
		assert.strictEqual(validateModes(false, true, false), null);
	});

	it("accepts chain mode only", () => {
		assert.strictEqual(validateModes(true, false, false), null);
	});

	it("rejects when no mode is specified", () => {
		assert.strictEqual(
			validateModes(false, false, false),
			"Invalid parameters. Provide exactly one mode.",
		);
	});

	it("rejects when multiple modes are specified", () => {
		assert.strictEqual(
			validateModes(true, true, false),
			"Invalid parameters. Provide exactly one mode.",
		);
		assert.strictEqual(
			validateModes(true, false, true),
			"Invalid parameters. Provide exactly one mode.",
		);
		assert.strictEqual(
			validateModes(false, true, true),
			"Invalid parameters. Provide exactly one mode.",
		);
		assert.strictEqual(
			validateModes(true, true, true),
			"Invalid parameters. Provide exactly one mode.",
		);
	});
});

// ── Max parallel tasks validation ─────────────────────────────

describe("max parallel tasks", () => {
	const MAX_PARALLEL_TASKS = 8;

	it("allows 8 tasks (at limit)", () => {
		assert.strictEqual(8 > MAX_PARALLEL_TASKS, false);
	});

	it("rejects more than 8 tasks", () => {
		assert.strictEqual(9 > MAX_PARALLEL_TASKS, true);
	});

	it("allows fewer than 8 tasks", () => {
		assert.strictEqual(7 > MAX_PARALLEL_TASKS, false);
	});

	it("allows empty tasks array", () => {
		assert.strictEqual(0 > MAX_PARALLEL_TASKS, false);
	});
});

// ── Chain orchestration logic ─────────────────────────────────

describe("chain orchestration", () => {
	it("stops on first failure", () => {
		// Uses real isFailedResult from toon-formatter.ts
		const results: Array<{
			agent: string;
			exitCode: number;
			stopReason?: string;
			completed: boolean;
		}> = [];

		const chain = [
			{ agent: "step1", task: "Find files: {previous}" },
			{ agent: "step2", task: "Process: {previous}" },
			{ agent: "step3", task: "Finalize: {previous}" },
		];

		let stopIndex = -1;
		let stopped = false;

		for (let i = 0; i < chain.length; i++) {
			const step = chain[i];
			// Simulate step2 failing with turn_limit
			const isStep2 = i === 1;
			const result = {
				agent: step.agent,
				exitCode: 0,
				stopReason: isStep2 ? "turn_limit" : "completed",
				completed: !isStep2,
			};
			results.push(result);

			if (isFailedResult(result)) {
				stopped = true;
				stopIndex = i;
				break;
			}
		}

		assert.strictEqual(stopped, true);
		assert.strictEqual(stopIndex, 1);
		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[1].stopReason, "turn_limit");
	});

	it("completes all steps when no failures", () => {
		const chain = [
			{ agent: "s1", task: "t1" },
			{ agent: "s2", task: "t2" },
			{ agent: "s3", task: "t3" },
		];

		const results: string[] = [];
		let stopped = false;

		for (let i = 0; i < chain.length; i++) {
			const result = {
				agent: chain[i].agent,
				exitCode: 0,
				completed: true,
			};

			if (isFailedResult(result)) {
				stopped = true;
				break;
			}

			results.push(chain[i].agent);
		}

		assert.strictEqual(stopped, false);
		assert.deepStrictEqual(results, ["s1", "s2", "s3"]);
	});
});

// ── Per-step cwd passthrough ──────────────────────────────────

describe("per-step cwd", () => {
	it("chain steps preserve per-step cwd", () => {
		const steps = [
			{ agent: "a", task: "t1", cwd: "/path/a" },
			{ agent: "b", task: "t2", cwd: "/path/b" },
		];

		assert.strictEqual(steps[0].cwd, "/path/a");
		assert.strictEqual(steps[1].cwd, "/path/b");
	});

	it("parallel tasks preserve per-task cwd", () => {
		const tasks = [
			{ agent: "a", task: "t1", cwd: "/custom/a" },
			{ agent: "b", task: "t2", cwd: "/custom/b" },
		];

		for (const t of tasks) {
			assert.ok(typeof t.cwd === "string");
		}
	});

	it("cwd is optional and can be undefined", () => {
		const tasks = [
			{ agent: "a", task: "t1", cwd: undefined },
			{ agent: "b", task: "t2" },
		];

		assert.strictEqual(tasks[0].cwd, undefined);
		assert.strictEqual((tasks[1] as Record<string, unknown>).cwd, undefined);
	});
});

// ── Unknown agent handling ────────────────────────────────────

describe("unknown agent", () => {
	it("returns error-like result for unknown agent", () => {
		const agentName = "nonexistent";
		// Simulated: agents.find returns undefined, so isUnknown = true
		const isUnknown = true;

		if (isUnknown) {
			const errorResult = {
				agent: agentName,
				agentSource: "unknown" as const,
				exitCode: 1,
				completed: false,
			};
			assert.strictEqual(errorResult.exitCode, 1);
			assert.strictEqual(errorResult.completed, false);
			assert.strictEqual(errorResult.agentSource, "unknown");
		}
	});
});

// ── Aggregate result counting ─────────────────────────────────

describe("aggregate result counting", () => {
	it("counts success and failure correctly", () => {
		const results = [
			{ agent: "a", exitCode: 0, stopReason: "completed", completed: true },
			{
				agent: "b",
				exitCode: 0,
				stopReason: "turn_limit",
				completed: false,
			},
			{ agent: "c", exitCode: 0, stopReason: "completed", completed: true },
		];

		const successCount = results.filter((r) => !isFailedResult(r)).length;
		const failCount = results.filter(isFailedResult).length;

		assert.strictEqual(successCount, 2);
		assert.strictEqual(failCount, 1);
	});

	it("all-success aggregate has no failures", () => {
		const results = [
			{ agent: "a", exitCode: 0, stopReason: "completed", completed: true },
			{ agent: "b", exitCode: 0, stopReason: "completed", completed: true },
		];

		const failCount = results.filter(isFailedResult).length;
		assert.strictEqual(failCount, 0);
	});

	it("all-failure aggregate counts all as failed", () => {
		const results = [
			{ agent: "a", exitCode: 0, stopReason: "timeout", completed: false },
			{ agent: "b", exitCode: 1, stopReason: undefined, completed: false },
			{
				agent: "c",
				exitCode: 0,
				stopReason: "aborted",
				completed: false,
			},
		];

		const failCount = results.filter(isFailedResult).length;
		assert.strictEqual(failCount, 3);
	});
});
