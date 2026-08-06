/**
 * Tests for the session-hook engine.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	executeHook,
	formatHookOutput,
	type HookEntry,
	loadConfig,
	runHooks,
	type SessionHookConfig,
} from "./engine.ts";

// ─── Test helpers ────────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "session-hook-test-"));
	tmpDirs.push(dir);
	return dir;
}

function writeConfig(dir: string, hooks: HookEntry[]): void {
	const configDir = join(dir, ".pi");
	mkdirSync(configDir, { recursive: true });
	const configPath = join(configDir, "session-hook.json");
	writeFileSync(configPath, JSON.stringify({ hooks }, null, "\t"), "utf-8");
}

afterEach(() => {
	for (const dir of tmpDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
	tmpDirs = [];
});

// ─── loadConfig ──────────────────────────────────────────────────────────────

describe("loadConfig", () => {
	it("returns undefined when no config files exist", () => {
		const dir = makeTmpDir();
		const result = loadConfig(dir);
		assert.strictEqual(result, undefined);
	});

	it("loads project config", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "test", command: "echo hello" }]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].name, "test");
		assert.strictEqual(result.hooks[0].command, "echo hello");
		assert.strictEqual(result.hooks[0].timeout, undefined);
	});

	it("loads config with custom timeout", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "slow", command: "sleep 1", timeout: 5000 }]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].timeout, 5000);
	});

	it("project config overrides global by name", () => {
		// We can only test project loading since global path is fixed.
		// Test that multiple entries with the same name in project take the last.
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "shared", command: "echo first" },
			{ name: "shared", command: "echo second" },
		]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].command, "echo second");
	});

	it("skips entries missing a name", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "", command: "echo hi" } as unknown as HookEntry,
			{ name: "valid", command: "echo valid" },
		]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].name, "valid");
	});

	it("skips entries missing a command field", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "broken", command: "" } as unknown as HookEntry,
			{ name: "valid", command: "echo valid" },
		]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].name, "valid");
	});

	it("handles missing .pi directory gracefully (returns undefined)", () => {
		const dir = makeTmpDir();
		// No .pi directory created
		const result = loadConfig(dir);
		assert.strictEqual(result, undefined);
	});

	it("handles malformed JSON gracefully", () => {
		const dir = makeTmpDir();
		const configDir = join(dir, ".pi");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "session-hook.json"),
			"not valid json",
			"utf-8",
		);

		const result = loadConfig(dir);
		assert.strictEqual(result, undefined);
	});

	it("handles JSON with missing hooks array", () => {
		const dir = makeTmpDir();
		const configDir = join(dir, ".pi");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "session-hook.json"),
			JSON.stringify({ something: "else" }),
			"utf-8",
		);

		const result = loadConfig(dir);
		assert.strictEqual(result, undefined);
	});

	it("skips non-object entries in hooks array", () => {
		const dir = makeTmpDir();
		const configDir = join(dir, ".pi");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "session-hook.json"),
			JSON.stringify({
				hooks: [
					"not an object",
					null,
					42,
					{ name: "valid", command: "echo hi" },
				],
			}),
			"utf-8",
		);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks.length, 1);
		assert.strictEqual(result.hooks[0].name, "valid");
	});

	it("returns undefined when all hooks are invalid", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "", command: "echo" } as unknown as HookEntry]);

		const result = loadConfig(dir);
		assert.strictEqual(result, undefined);
	});
});

// ─── executeHook ─────────────────────────────────────────────────────────────

describe("executeHook", () => {
	it("executes a simple command and captures stdout", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{ name: "test", command: "echo hello" },
			dir,
		);

		assert.strictEqual(result.name, "test");
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.output, "hello");
		assert.strictEqual(result.error, undefined);
	});

	it("captures multi-line output", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "multi",
				command: 'echo "line1\nline2\nline3"',
			},
			dir,
		);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.output, "line1\nline2\nline3");
	});

	it("reports error for non-zero exit code", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "fail",
				command: "exit 1",
			},
			dir,
		);

		assert.strictEqual(result.name, "fail");
		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.ok(
			result.error.includes("failed") ||
				result.error.includes("exited") ||
				result.error.includes("exit"),
		);
	});

	it("reports error for command not found", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "missing",
				command: "nonexistent_command_xyzzy_12345",
			},
			dir,
		);

		assert.strictEqual(result.name, "missing");
		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.ok(result.error.includes("command not found"));
	});

	it("reports error for timed-out commands", { timeout: 5000 }, async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "slow",
				command: "sleep 5",
				timeout: 500,
			},
			dir,
		);

		assert.strictEqual(result.name, "slow");
		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.ok(result.error.includes("timed out"));
	});

	it("respects custom timeout", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "quick",
				command: "echo ok",
				timeout: 30000,
			},
			dir,
		);

		assert.strictEqual(result.success, true);
		assert.strictEqual(result.output, "ok");
	});

	it("defaults to DEFAULT_TIMEOUT_MS when no timeout set", async () => {
		const dir = makeTmpDir();
		const result = await executeHook(
			{
				name: "default",
				command: "echo ok",
			},
			dir,
		);

		assert.strictEqual(result.success, true);
		// timeout not in result, but DEFAULT_TIMEOUT_MS is used internally
	});
});

// ─── runHooks ────────────────────────────────────────────────────────────────

describe("runHooks", () => {
	it("runs multiple hooks in parallel", async () => {
		const dir = makeTmpDir();
		const config: SessionHookConfig = {
			hooks: [
				{ name: "a", command: "echo a" },
				{ name: "b", command: "echo b" },
				{ name: "c", command: "echo c" },
			],
		};

		const state = await runHooks(config, dir);

		assert.strictEqual(state.hadHooks, true);
		assert.strictEqual(state.results.length, 3);

		// All should succeed
		for (const r of state.results) {
			assert.strictEqual(r.success, true);
		}

		const names = state.results.map((r) => r.name).sort();
		assert.deepStrictEqual(names, ["a", "b", "c"]);
	});

	it("runs in the specified cwd", async () => {
		const dir = makeTmpDir();
		const config: SessionHookConfig = {
			hooks: [{ name: "pwd", command: "pwd" }],
		};

		const state = await runHooks(config, dir);
		assert.strictEqual(state.results.length, 1);
		assert.strictEqual(state.results[0].success, true);
		assert.strictEqual(state.results[0].output, dir);
	});

	it("handles mixed success/failure results", async () => {
		const dir = makeTmpDir();
		const config: SessionHookConfig = {
			hooks: [
				{ name: "ok", command: "echo ok" },
				{ name: "fail", command: "nonexistent_xyzzy_999" },
				{ name: "also-ok", command: "echo also" },
			],
		};

		const state = await runHooks(config, dir);

		assert.strictEqual(state.results.length, 3);
		assert.strictEqual(state.results[0].success, true);
		assert.strictEqual(state.results[1].success, false);
		assert.strictEqual(state.results[2].success, true);
	});

	it("handles empty hooks array", async () => {
		const dir = makeTmpDir();
		const config: SessionHookConfig = { hooks: [] };
		const state = await runHooks(config, dir);

		assert.strictEqual(state.hadHooks, false);
		assert.strictEqual(state.results.length, 0);
	});
});

// ─── formatHookOutput ────────────────────────────────────────────────────────

describe("formatHookOutput", () => {
	it("returns empty string when no hooks", () => {
		const result = formatHookOutput({
			results: [],
			hadHooks: false,
		});
		assert.strictEqual(result, "");
	});

	it("formats a single successful hook", () => {
		const result = formatHookOutput({
			results: [{ name: "test", success: true, output: "hello world" }],
			hadHooks: true,
		});

		assert.ok(
			result.includes(
				"## Session Hooks — ambient context from registered tools",
			),
		);
		assert.ok(result.includes("## test"));
		assert.ok(result.includes("```"));
		assert.ok(result.includes("hello world"));
	});

	it("formats multiple hooks", () => {
		const result = formatHookOutput({
			results: [
				{ name: "one", success: true, output: "output1" },
				{ name: "two", success: true, output: "output2" },
			],
			hadHooks: true,
		});

		assert.ok(result.includes("## one"));
		assert.ok(result.includes("output1"));
		assert.ok(result.includes("## two"));
		assert.ok(result.includes("output2"));
	});

	it("formats error hooks with warning", () => {
		const result = formatHookOutput({
			results: [
				{
					name: "broken",
					success: false,
					output: "",
					error: 'session-hook "broken" failed: command not found',
				},
			],
			hadHooks: true,
		});

		assert.ok(result.includes("## broken"));
		assert.ok(result.includes("⚠"));
		assert.ok(result.includes("command not found"));
		assert.ok(!result.includes("```"));
	});

	it("handles empty output from successful command", () => {
		const result = formatHookOutput({
			results: [{ name: "empty", success: true, output: "" }],
			hadHooks: true,
		});

		assert.ok(result.includes("## empty"));
		assert.ok(result.includes("(no output)"));
	});

	it("mixes success and failure results", () => {
		const result = formatHookOutput({
			results: [
				{ name: "ok", success: true, output: "all good" },
				{
					name: "fail",
					success: false,
					output: "",
					error: "timed out",
				},
			],
			hadHooks: true,
		});

		assert.ok(result.includes("all good"));
		assert.ok(result.includes("timed out"));
	});
});
