/**
 * Session Hook Engine — pure logic for config loading, command execution,
 * and context formatting. No pi runtime dependencies.
 */

import { exec } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HookEntry {
	name: string;
	command: string;
	timeout?: number;
	managed_by?: string;
}

export interface HookEntryWithSource extends HookEntry {
	source: "global" | "project";
}

export interface SessionHookConfig {
	hooks: HookEntry[];
}

export interface HookResult {
	name: string;
	success: boolean;
	output: string;
	error?: string;
}

export interface HookRunState {
	results: HookResult[];
	hadHooks: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Paths ───────────────────────────────────────────────────────────────────

export const GLOBAL_CONFIG_PATH = join(
	homedir(),
	".pi",
	"agent",
	"session-hook.json",
);
const PROJECT_CONFIG_NAME = "session-hook.json";

function projectConfigPath(cwd: string): string {
	return join(cwd, ".pi", PROJECT_CONFIG_NAME);
}

/**
 * Parse a single hook entry from a raw JSON object.
 * Returns undefined if the entry is invalid (missing required fields).
 */
function parseHookEntry(raw: unknown): HookEntry | undefined {
	if (raw == null || typeof raw !== "object") return undefined;
	const e = raw as Record<string, unknown>;
	if (typeof e.name !== "string" || e.name.length === 0) return undefined;
	if (typeof e.command !== "string" || e.command.length === 0) return undefined;

	const timeout =
		typeof e.timeout === "number" && Number.isFinite(e.timeout) && e.timeout > 0
			? e.timeout
			: undefined;

	const managed_by =
		typeof e.managed_by === "string" && e.managed_by.length > 0
			? e.managed_by
			: undefined;

	return { name: e.name, command: e.command, timeout, managed_by };
}

/**
 * Read and parse a JSON hooks file. Returns undefined for missing files or
 * malformed JSON (graceful skip).
 */
function readConfigFile(path: string): SessionHookConfig | undefined {
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;

		if (!Array.isArray(parsed.hooks)) {
			return undefined;
		}

		const hooks: HookEntry[] = [];
		for (const entry of parsed.hooks as unknown[]) {
			const hook = parseHookEntry(entry);
			if (hook) hooks.push(hook);
		}

		return { hooks };
	} catch {
		// File missing or malformed JSON — skip gracefully
		return undefined;
	}
}

/**
 * Load and merge configs. Project config overrides global by hook name.
 * Returns undefined if no configs are found or no valid hooks.
 */
export function loadConfig(cwd: string): SessionHookConfig | undefined {
	const globalConfig = readConfigFile(GLOBAL_CONFIG_PATH);
	const projectConfig = readConfigFile(projectConfigPath(cwd));

	if (!globalConfig && !projectConfig) return undefined;

	// Merge: project overrides global by name
	const merged = new Map<string, HookEntry>();

	if (globalConfig) {
		for (const entry of globalConfig.hooks) {
			merged.set(entry.name, entry);
		}
	}

	if (projectConfig) {
		for (const entry of projectConfig.hooks) {
			merged.set(entry.name, entry);
		}
	}

	const hooks = Array.from(merged.values());
	if (hooks.length === 0) return undefined;

	return { hooks };
}

// ─── Command execution ───────────────────────────────────────────────────────

/**
 * Execute a single command with the configured timeout.
 * Returns a HookResult.
 */
export function executeHook(
	entry: HookEntry,
	cwd: string,
): Promise<HookResult> {
	const timeoutMs = entry.timeout ?? DEFAULT_TIMEOUT_MS;

	return new Promise((resolve) => {
		const child = exec(
			entry.command,
			{ cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					const killed = (err as NodeJS.ErrnoException).killed;
					const code = (err as NodeJS.ErrnoException).code;

					if (killed) {
						resolve({
							name: entry.name,
							success: false,
							output: "",
							error: `session-hook "${entry.name}" timed out after ${timeoutMs}ms`,
						});
					} else if (code === "ENOENT") {
						resolve({
							name: entry.name,
							success: false,
							output: "",
							error: `session-hook "${entry.name}" failed: command not found`,
						});
					} else {
						const trimmedStderr = stderr.trim();
						resolve({
							name: entry.name,
							success: false,
							output: stdout.trim(),
							error: trimmedStderr
								? trimmedStderr
								: `session-hook "${entry.name}" exited with code ${(err as NodeJS.ErrnoException).exitCode ?? "unknown"}`,
						});
					}
				} else {
					resolve({
						name: entry.name,
						success: true,
						output: stdout.trim(),
					});
				}
			},
		);

		// Cleanup on timeout: exec's `timeout` option handles killing,
		// but we still need to ensure the process is cleaned up.
		child.on("error", () => {
			// Already handled via callback
		});
	});
}

/**
 * Run all hooks in parallel and collect results.
 */
export async function runHooks(
	config: SessionHookConfig,
	cwd: string,
): Promise<HookRunState> {
	const results = await Promise.all(
		config.hooks.map((entry) => executeHook(entry, cwd)),
	);

	return {
		results,
		hadHooks: config.hooks.length > 0,
	};
}

// ─── Config writing ──────────────────────────────────────────────────────────

/**
 * Serialize hooks to JSON with pretty-printing.
 * Only includes timeout and managed_by when they are defined.
 */
function serializeHooks(hooks: HookEntry[]): string {
	const entries = hooks.map((h) => {
		const entry: Record<string, unknown> = {
			name: h.name,
			command: h.command,
		};
		if (h.timeout !== undefined) entry.timeout = h.timeout;
		if (h.managed_by !== undefined) entry.managed_by = h.managed_by;
		return entry;
	});
	return `${JSON.stringify({ hooks: entries }, null, "\t")}\n`;
}

/**
 * Write hooks to a config file, creating parent directories as needed.
 */
export function writeConfigAtPath(path: string, hooks: HookEntry[]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, serializeHooks(hooks), "utf-8");
}

/**
 * Read all valid hook entries from a config file at a specific path.
 * Returns an empty array if the file doesn't exist or has no valid hooks.
 */
export function readConfigAtPath(path: string): HookEntry[] {
	const config = readConfigFile(path);
	return config?.hooks ?? [];
}

// ─── Argument parsing ────────────────────────────────────────────────────────

/**
 * Parse shell-style arguments from a command string.
 * Handles quoted strings (single and double), --flags, and positional args.
 */
export function parseArgs(raw: string): string[] {
	const args: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (const char of raw) {
		if (inSingle) {
			if (char === "'") {
				inSingle = false;
			} else {
				current += char;
			}
		} else if (inDouble) {
			if (char === '"') {
				inDouble = false;
			} else {
				current += char;
			}
		} else if (char === "'") {
			inSingle = true;
		} else if (char === '"') {
			inDouble = true;
		} else if (char === " " || char === "\t") {
			if (current.length > 0) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current.length > 0) {
		args.push(current);
	}

	return args;
}

/**
 * Parse add subcommand: add <name> --command <cmd> [--timeout <ms>] [--project]
 */
export function parseAddArgs(
	args: string[],
):
	| { name: string; command: string; timeout?: number; project: boolean }
	| string {
	if (args.length < 1) {
		return "Usage: /session-hook add <name> --command <cmd> [--timeout <ms>] [--project]";
	}

	const name = args[0];
	let command: string | undefined;
	let timeout: number | undefined;
	let project = false;

	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--command" || args[i] === "-c") {
			if (i + 1 < args.length) {
				command = args[i + 1];
				i++;
			} else {
				return "--command requires a value";
			}
		} else if (args[i] === "--timeout" || args[i] === "-t") {
			if (i + 1 < args.length) {
				const parsed = Number.parseInt(args[i + 1], 10);
				if (Number.isNaN(parsed) || parsed <= 0) {
					return `Invalid timeout value: ${args[i + 1]}`;
				}
				timeout = parsed;
				i++;
			} else {
				return "--timeout requires a value";
			}
		} else if (args[i] === "--project") {
			project = true;
		} else {
			return `Unknown argument: ${args[i]}`;
		}
	}

	if (!command) {
		return "--command is required";
	}

	return { name, command, timeout, project };
}

// ─── Add / List operations ───────────────────────────────────────────────────

/**
 * Add a hook to the global or project config. Overwrites an existing entry
 * with the same name in the target config.
 * Returns whether an existing entry was overwritten.
 */
export function addHook(
	cwd: string,
	entry: HookEntry,
	project: boolean,
): { overwrote: boolean } {
	const targetPath = project ? projectConfigPath(cwd) : GLOBAL_CONFIG_PATH;

	const existing = readConfigAtPath(targetPath);
	const idx = existing.findIndex((h) => h.name === entry.name);

	if (idx >= 0) {
		existing[idx] = entry;
		writeConfigAtPath(targetPath, existing);
		return { overwrote: true };
	}

	existing.push(entry);
	writeConfigAtPath(targetPath, existing);
	return { overwrote: false };
}

/**
 * List all hooks from both global and project configs with source metadata.
 * When a project hook has the same name as a global hook, the project entry
 * is included with source "project" and the global entry is excluded.
 */
export function listHooks(cwd: string): HookEntryWithSource[] {
	const globalHooks = readConfigAtPath(GLOBAL_CONFIG_PATH);
	const projectHooks = readConfigAtPath(projectConfigPath(cwd));

	const projectNames = new Set(projectHooks.map((h) => h.name));

	const result: HookEntryWithSource[] = [];

	// Global hooks not overridden by project
	for (const hook of globalHooks) {
		if (!projectNames.has(hook.name)) {
			result.push({ ...hook, source: "global" });
		}
	}

	// Project hooks (always included; they override global)
	for (const hook of projectHooks) {
		result.push({ ...hook, source: "project" });
	}

	return result;
}

// ─── Output formatting ───────────────────────────────────────────────────────

const HEADER = "## Session Hooks — ambient context from registered tools";

/**
 * Format hook results into a single markdown string for injection.
 * Returns empty string if there are no hooks.
 */
export function formatHookOutput(state: HookRunState): string {
	if (!state.hadHooks) return "";

	const parts: string[] = [HEADER, ""];

	for (const result of state.results) {
		parts.push(`## ${result.name}`, "");
		if (result.success) {
			const trimmed = result.output.trim();
			if (trimmed) {
				parts.push("```", trimmed, "```");
			} else {
				parts.push("```", "(no output)", "```");
			}
		} else {
			parts.push(`> ⚠ ${result.error ?? "Unknown error"}`);
		}
		parts.push("");
	}

	return parts.join("\n");
}
