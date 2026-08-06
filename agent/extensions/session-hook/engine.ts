/**
 * Session Hook Engine — pure logic for config loading, command execution,
 * and context formatting. No pi runtime dependencies.
 */

import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HookEntry {
	name: string;
	command: string;
	timeout?: number;
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

// ─── Config loading ──────────────────────────────────────────────────────────

const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "session-hook.json");
const PROJECT_CONFIG_NAME = "session-hook.json";

/**
 * Read and parse a JSON file. Returns undefined for missing files or
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
			if (entry == null || typeof entry !== "object") continue;
			const e = entry as Record<string, unknown>;
			if (typeof e.name !== "string" || e.name.length === 0) continue;
			if (typeof e.command !== "string" || e.command.length === 0) continue;

			const timeout =
				typeof e.timeout === "number" && Number.isFinite(e.timeout)
					? e.timeout
					: undefined;

			hooks.push({ name: e.name, command: e.command, timeout });
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
	const projectPath = join(cwd, ".pi", PROJECT_CONFIG_NAME);

	const globalConfig = readConfigFile(GLOBAL_CONFIG_PATH);
	const projectConfig = readConfigFile(projectPath);

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
