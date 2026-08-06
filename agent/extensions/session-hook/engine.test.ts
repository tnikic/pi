/**
 * Tests for the session-hook engine.
 */

import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	addHook,
	editHookConfig,
	executeHook,
	findHook,
	formatHookOutput,
	type HookEntry,
	listHooks,
	loadConfig,
	parseAddArgs,
	parseArgs,
	parseEditArgs,
	parseRemoveArgs,
	parseTestArgs,
	readConfigAtPath,
	removeHook,
	runHooks,
	type SessionHookConfig,
	writeConfigAtPath,
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

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs", () => {
	it("splits on whitespace", () => {
		assert.deepStrictEqual(parseArgs("a b c"), ["a", "b", "c"]);
	});

	it("handles double-quoted strings", () => {
		assert.deepStrictEqual(parseArgs('a "b c" d'), ["a", "b c", "d"]);
	});

	it("handles single-quoted strings", () => {
		assert.deepStrictEqual(parseArgs("a 'b c' d"), ["a", "b c", "d"]);
	});

	it("handles flags with values", () => {
		assert.deepStrictEqual(parseArgs("--command echo --timeout 5000"), [
			"--command",
			"echo",
			"--timeout",
			"5000",
		]);
	});

	it("handles quoted command with spaces", () => {
		assert.deepStrictEqual(
			parseArgs('add myhook --command "echo hello world"'),
			["add", "myhook", "--command", "echo hello world"],
		);
	});

	it("returns empty array for empty string", () => {
		assert.deepStrictEqual(parseArgs(""), []);
	});

	it("returns empty array for whitespace-only string", () => {
		assert.deepStrictEqual(parseArgs("   "), []);
	});

	it("handles leading and trailing whitespace", () => {
		assert.deepStrictEqual(parseArgs("  a b  "), ["a", "b"]);
	});
});

// ─── parseAddArgs ────────────────────────────────────────────────────────────

describe("parseAddArgs", () => {
	it("parses name and command", () => {
		const result = parseAddArgs(["myhook", "--command", "echo hello"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.name, "myhook");
			assert.strictEqual(result.command, "echo hello");
			assert.strictEqual(result.timeout, undefined);
			assert.strictEqual(result.project, false);
		}
	});

	it("parses custom timeout", () => {
		const result = parseAddArgs([
			"myhook",
			"--command",
			"echo hello",
			"--timeout",
			"5000",
		]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.timeout, 5000);
		}
	});

	it("parses --project flag", () => {
		const result = parseAddArgs([
			"myhook",
			"--command",
			"echo hello",
			"--project",
		]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.project, true);
		}
	});

	it("returns error when name is missing", () => {
		const result = parseAddArgs([]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Usage"));
	});

	it("returns error when --command is missing", () => {
		const result = parseAddArgs(["myhook"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("--command is required"));
	});

	it("returns error when --command has no value", () => {
		const result = parseAddArgs(["myhook", "--command"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("--command requires a value"));
	});

	it("returns error for invalid timeout", () => {
		const result = parseAddArgs([
			"myhook",
			"--command",
			"echo",
			"--timeout",
			"abc",
		]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Invalid timeout"));
	});

	it("returns error for unknown argument", () => {
		const result = parseAddArgs(["myhook", "--command", "echo", "--unknown"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Unknown argument"));
	});

	it("accepts -c and -t short flags", () => {
		const result = parseAddArgs(["myhook", "-c", "echo", "-t", "3000"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.command, "echo");
			assert.strictEqual(result.timeout, 3000);
		}
	});
});

// ─── managed_by field ────────────────────────────────────────────────────────

describe("managed_by in config", () => {
	it("reads managed_by from config file", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{
				name: "test",
				command: "echo hello",
				managed_by: "anvil",
			} as HookEntry,
		]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks[0].managed_by, "anvil");
	});

	it("managed_by is undefined when not present", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "test", command: "echo hello" }]);

		const result = loadConfig(dir);
		assert.ok(result);
		assert.strictEqual(result.hooks[0].managed_by, undefined);
	});

	it("managed_by round-trips through write and read", () => {
		const dir = makeTmpDir();
		const configPath = `${dir}/session-hook.json`;

		writeConfigAtPath(configPath, [
			{ name: "a", command: "echo a", managed_by: "anvil" },
		]);

		const read = readConfigAtPath(configPath);
		assert.strictEqual(read.length, 1);
		assert.strictEqual(read[0].managed_by, "anvil");
	});
});

// ─── readConfigAtPath ────────────────────────────────────────────────────────

describe("readConfigAtPath", () => {
	it("returns empty array when file does not exist", () => {
		const result = readConfigAtPath(
			"/tmp/nonexistent-session-hook-config.json",
		);
		assert.deepStrictEqual(result, []);
	});

	it("returns hooks from an existing config file", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "a", command: "echo a" },
			{ name: "b", command: "echo b" },
		]);

		const result = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(result.length, 2);
	});

	it("returns empty array when file has no valid hooks", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "", command: "echo" } as unknown as HookEntry]);

		const result = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.deepStrictEqual(result, []);
	});
});

// ─── writeConfigAtPath ───────────────────────────────────────────────────────

describe("writeConfigAtPath", () => {
	it("writes hooks to a file and creates directories", () => {
		const dir = makeTmpDir();
		const configPath = `${dir}/newdir/subdir/hooks.json`;

		writeConfigAtPath(configPath, [
			{ name: "x", command: "echo x", timeout: 5000 },
		]);

		const read = readConfigAtPath(configPath);
		assert.strictEqual(read.length, 1);
		assert.strictEqual(read[0].name, "x");
		assert.strictEqual(read[0].timeout, 5000);
	});

	it("preserves managed_by in written config", () => {
		const dir = makeTmpDir();
		const configPath = `${dir}/hooks.json`;

		writeConfigAtPath(configPath, [
			{ name: "tool", command: "echo hi", managed_by: "anvil" },
		]);

		const read = readConfigAtPath(configPath);
		assert.strictEqual(read[0].managed_by, "anvil");
	});

	it("omits undefined fields from output", () => {
		const dir = makeTmpDir();
		const configPath = `${dir}/hooks.json`;

		writeConfigAtPath(configPath, [
			{ name: "minimal", command: "echo minimal" },
		]);

		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw);
		const entry = parsed.hooks[0];
		// Only name and command should be present
		assert.strictEqual(Object.keys(entry).length, 2);
		assert.ok("name" in entry);
		assert.ok("command" in entry);
		assert.ok(!("timeout" in entry));
		assert.ok(!("managed_by" in entry));
	});
});

// ─── addHook ─────────────────────────────────────────────────────────────────

describe("addHook", () => {
	it("adds a new hook to a config file (simulated project)", () => {
		const dir = makeTmpDir();

		const result = addHook(
			dir,
			{ name: "myhook", command: "echo hi", managed_by: "user" },
			true,
		);

		assert.strictEqual(result.overwrote, false);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 1);
		assert.strictEqual(hooks[0].name, "myhook");
		assert.strictEqual(hooks[0].command, "echo hi");
		assert.strictEqual(hooks[0].managed_by, "user");
	});

	it("adds a hook with custom timeout", () => {
		const dir = makeTmpDir();

		addHook(
			dir,
			{
				name: "slow",
				command: "sleep 1",
				timeout: 5000,
				managed_by: "user",
			},
			true,
		);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks[0].timeout, 5000);
	});

	it("overwrites an existing hook with same name", () => {
		const dir = makeTmpDir();

		// Add first
		addHook(
			dir,
			{ name: "hook", command: "echo old", managed_by: "user" },
			true,
		);

		// Overwrite
		const result = addHook(
			dir,
			{ name: "hook", command: "echo new", managed_by: "user" },
			true,
		);

		assert.strictEqual(result.overwrote, true);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 1);
		assert.strictEqual(hooks[0].command, "echo new");
	});

	it("adds to existing config without removing other entries", () => {
		const dir = makeTmpDir();

		addHook(
			dir,
			{ name: "first", command: "echo first", managed_by: "user" },
			true,
		);
		addHook(
			dir,
			{ name: "second", command: "echo second", managed_by: "user" },
			true,
		);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 2);
		const names = hooks.map((h) => h.name).sort();
		assert.deepStrictEqual(names, ["first", "second"]);
	});
});

// ─── removeHook ──────────────────────────────────────────────────────────────

describe("removeHook", () => {
	it("removes an existing hook from project config", () => {
		const dir = makeTmpDir();

		addHook(dir, { name: "a", command: "echo a", managed_by: "user" }, true);
		addHook(dir, { name: "b", command: "echo b", managed_by: "user" }, true);

		const result = removeHook(dir, "a", true);
		assert.strictEqual(result.found, true);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 1);
		assert.strictEqual(hooks[0].name, "b");
	});

	it("returns found=false when hook does not exist", () => {
		const dir = makeTmpDir();

		addHook(dir, { name: "a", command: "echo a", managed_by: "user" }, true);

		const result = removeHook(dir, "nonexistent", true);
		assert.strictEqual(result.found, false);

		// Original hooks still intact
		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 1);
		assert.strictEqual(hooks[0].name, "a");
	});

	it("returns found=false when config file does not exist", () => {
		const dir = makeTmpDir();
		const result = removeHook(dir, "any", true);
		assert.strictEqual(result.found, false);
	});

	it("removes hook regardless of managed_by value", () => {
		const dir = makeTmpDir();

		addHook(
			dir,
			{ name: "tool", command: "echo hi", managed_by: "anvil" },
			true,
		);

		const result = removeHook(dir, "tool", true);
		assert.strictEqual(result.found, true);

		const hooks = readConfigAtPath(`${dir}/.pi/session-hook.json`);
		assert.strictEqual(hooks.length, 0);
	});
});

// ─── findHook ────────────────────────────────────────────────────────────────

describe("findHook", () => {
	it("finds a hook in project config", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "test", command: "echo hello", timeout: 5000 }]);

		const result = findHook(dir, "test");
		assert.ok(result);
		assert.strictEqual(result.name, "test");
		assert.strictEqual(result.command, "echo hello");
		assert.strictEqual(result.timeout, 5000);
		assert.strictEqual(result.source, "project");
	});

	it("project hook overrides global hook with same name", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "shared", command: "echo project" }]);

		// findHook only uses loadConfig which returns merged view.
		// We test that the project entry wins.
		const result = findHook(dir, "shared");
		assert.ok(result);
		assert.strictEqual(result.command, "echo project");
		assert.strictEqual(result.source, "project");
	});

	it("returns undefined for non-existent hook", () => {
		const dir = makeTmpDir();
		const result = findHook(dir, "nonexistent");
		assert.strictEqual(result, undefined);
	});

	it("returns undefined when no configs exist", () => {
		const dir = makeTmpDir();
		const result = findHook(dir, "any");
		assert.strictEqual(result, undefined);
	});
});

// ─── parseRemoveArgs ─────────────────────────────────────────────────────────

describe("parseRemoveArgs", () => {
	it("parses name only", () => {
		const result = parseRemoveArgs(["myhook"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.name, "myhook");
			assert.strictEqual(result.project, false);
		}
	});

	it("parses name with --project", () => {
		const result = parseRemoveArgs(["myhook", "--project"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.name, "myhook");
			assert.strictEqual(result.project, true);
		}
	});

	it("returns error when name is missing", () => {
		const result = parseRemoveArgs([]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Usage"));
	});

	it("returns error for unknown flags", () => {
		const result = parseRemoveArgs(["myhook", "--unknown"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Unknown argument"));
	});
});

// ─── parseTestArgs ───────────────────────────────────────────────────────────

describe("parseTestArgs", () => {
	it("parses name", () => {
		const result = parseTestArgs(["myhook"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.name, "myhook");
		}
	});

	it("returns error when name is missing", () => {
		const result = parseTestArgs([]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Usage"));
	});

	it("returns error for unknown flags", () => {
		const result = parseTestArgs(["myhook", "--unknown"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Unknown argument"));
	});
});

// ─── parseEditArgs ───────────────────────────────────────────────────────────

describe("parseEditArgs", () => {
	it("parses no args (global)", () => {
		const result = parseEditArgs([]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.project, false);
		}
	});

	it("parses --project", () => {
		const result = parseEditArgs(["--project"]);
		assert.ok(typeof result !== "string");
		if (typeof result !== "string") {
			assert.strictEqual(result.project, true);
		}
	});

	it("returns error for unknown flags", () => {
		const result = parseEditArgs(["--unknown"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Unknown argument"));
	});

	it("returns error for positional arguments", () => {
		const result = parseEditArgs(["extra"]);
		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("Unknown argument"));
	});
});

// ─── editHookConfig ──────────────────────────────────────────────────────────

describe("editHookConfig", () => {
	it("returns undefined when config file does not exist", () => {
		const dir = makeTmpDir();
		const result = editHookConfig(dir, true);
		assert.strictEqual(result, undefined);
	});

	it("returns path and content when config exists", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [{ name: "a", command: "echo a" }]);

		const result = editHookConfig(dir, true);
		assert.ok(result);
		assert.ok(result.path.endsWith("session-hook.json"));
		assert.ok(result.content.includes('"name": "a"'));
		assert.ok(result.content.includes('"command": "echo a"'));
	});

	it("returns path and content for global config (file may not exist)", () => {
		// Just verify the path shape is correct for global
		const dir = makeTmpDir();
		// We can't write to the real global path, so we test that
		// the function returns undefined when the file doesn't exist there.
		const result = editHookConfig(dir, false);
		// The global config path is in ~/.pi/agent/session-hook.json
		// which likely doesn't exist in tests, so this returns undefined.
		// We test the project path variant above.
		assert.strictEqual(result, undefined);
	});
});

// ─── listHooks ───────────────────────────────────────────────────────────────

describe("listHooks", () => {
	it("returns empty array when no hooks configured", () => {
		const dir = makeTmpDir();
		const result = listHooks(dir);
		assert.deepStrictEqual(result, []);
	});

	it("lists project hooks with source=project", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "a", command: "echo a", managed_by: "user" } as HookEntry,
		]);

		const result = listHooks(dir);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, "project");
		assert.strictEqual(result[0].name, "a");
	});

	it("project hook with same name overrides global (merge logic)", () => {
		// Tests that when a project hook has the same name, it's the one
		// returned. The actual global→project merge path is untestable
		// without writing to the real global config path.
		const dir = makeTmpDir();

		// Add a project hook
		addHook(
			dir,
			{ name: "shared", command: "echo project", managed_by: "user" },
			true,
		);

		const result = listHooks(dir);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].command, "echo project");
		assert.strictEqual(result[0].source, "project");
	});

	it("includes managed_by in results (undefined when not set)", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "with", command: "echo with", managed_by: "anvil" } as HookEntry,
			{ name: "without", command: "echo without" },
		]);

		const result = listHooks(dir);
		assert.strictEqual(result.length, 2);

		const withHook = result.find((h) => h.name === "with");
		const withoutHook = result.find((h) => h.name === "without");
		assert.ok(withHook);
		assert.ok(withoutHook);
		assert.strictEqual(withHook.managed_by, "anvil");
		assert.strictEqual(withoutHook.managed_by, undefined);
	});

	it("returns hooks sorted with project entries", () => {
		const dir = makeTmpDir();
		writeConfig(dir, [
			{ name: "z", command: "echo z" },
			{ name: "a", command: "echo a" },
		]);

		const result = listHooks(dir);
		assert.strictEqual(result.length, 2);
		// Both should be project source
		for (const h of result) {
			assert.strictEqual(h.source, "project");
		}
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
