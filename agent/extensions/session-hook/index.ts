/**
 * Session Hook Extension — runs user-configured shell commands at session start
 * and injects their output as ambient context before the first agent turn.
 *
 * Provides /session-hook slash commands for interactive hook management:
 *   add <name> --command <cmd> [--timeout <ms>] [--project]
 *   list
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	addHook,
	DEFAULT_TIMEOUT_MS,
	editHookConfig,
	executeHook,
	findHook,
	formatHookOutput,
	type HookEntry,
	type HookRunState,
	listHooks,
	loadConfig,
	parseAddArgs,
	parseArgs,
	parseEditArgs,
	parseRemoveArgs,
	parseTestArgs,
	removeHook,
	runHooks,
	writeConfigAtPath,
} from "./engine.ts";

/** Module-level state: populated at session_start, consumed at before_agent_start. */
let currentState: HookRunState | null = null;

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		if (!config) {
			currentState = null;
			return;
		}

		const state = await runHooks(config, ctx.cwd);
		currentState = state;
	});

	pi.on("before_agent_start", async (_event, _ctx) => {
		if (!currentState?.hadHooks) return;

		const content = formatHookOutput(currentState);
		if (!content) return;

		return {
			message: {
				customType: "session-hook",
				content,
				display: true,
			},
		};
	});

	// ── /session-hook command ─────────────────────────────────────────────

	pi.registerCommand("session-hook", {
		description: "Manage session hooks: add, list, remove, test, edit",
		handler: async (rawArgs, ctx) => {
			const args = parseArgs(rawArgs.trim());

			if (args.length === 0) {
				ctx.ui.notify(
					"Usage: /session-hook <add|list|remove|test|edit>",
					"warning",
				);
				return;
			}

			const subcommand = args[0].toLowerCase();
			const subArgs = args.slice(1);

			switch (subcommand) {
				case "add": {
					const result = parseAddArgs(subArgs);
					if (typeof result === "string") {
						ctx.ui.notify(result, "error");
						return;
					}

					const entry: HookEntry = {
						name: result.name,
						command: result.command,
						managed_by: "user",
					};
					if (result.timeout !== undefined) {
						entry.timeout = result.timeout;
					}

					const { overwrote } = addHook(ctx.cwd, entry, result.project);

					const target = result.project ? "project" : "global";
					const action = overwrote ? "Updated" : "Added";
					const timeoutInfo =
						entry.timeout !== undefined
							? ` (timeout: ${entry.timeout}ms)`
							: ` (default timeout: ${DEFAULT_TIMEOUT_MS}ms)`;

					ctx.ui.notify(
						`${action} hook "${result.name}" in ${target} config${timeoutInfo}`,
						"info",
					);
					return;
				}

				case "list": {
					const hooks = listHooks(ctx.cwd);

					if (hooks.length === 0) {
						ctx.ui.notify("No session hooks configured.", "info");
						return;
					}

					const items = hooks.map((h) => {
						const managed = h.managed_by || "none";
						const timeout =
							h.timeout !== undefined
								? `${h.timeout}ms`
								: `${DEFAULT_TIMEOUT_MS}ms (default)`;
						return `${h.name}  [${h.source}]  managed_by: ${managed}  timeout: ${timeout}  command: ${h.command}`;
					});

					await ctx.ui.select("Session Hooks", items);
					return;
				}

				case "remove": {
					const parsed = parseRemoveArgs(subArgs);
					if (typeof parsed === "string") {
						ctx.ui.notify(parsed, "error");
						return;
					}

					const target = parsed.project ? "project" : "global";
					const hook = findHook(ctx.cwd, parsed.name);

					if (!hook && !parsed.project) {
						// For global, check if it exists at all (merged view).
						// If it's only in project config, tell the user to use --project.
						const projectHooks = listHooks(ctx.cwd).filter(
							(h) => h.source === "project" && h.name === parsed.name,
						);
						if (projectHooks.length > 0) {
							ctx.ui.notify(
								`Hook "${parsed.name}" is in project config. Use --project to remove it.`,
								"warning",
							);
							return;
						}
						ctx.ui.notify(`Hook "${parsed.name}" not found.`, "error");
						return;
					}

					if (!hook) {
						ctx.ui.notify(
							`Hook "${parsed.name}" not found in ${target} config.`,
							"error",
						);
						return;
					}

					const confirmed = await ctx.ui.confirm(
						"Remove Session Hook",
						`Remove hook "${parsed.name}" from ${target} config?`,
					);

					if (!confirmed) {
						ctx.ui.notify("Removal cancelled.", "info");
						return;
					}

					removeHook(ctx.cwd, parsed.name, parsed.project);
					ctx.ui.notify(
						`Removed hook "${parsed.name}" from ${target} config.`,
						"info",
					);
					return;
				}

				case "test": {
					const parsed = parseTestArgs(subArgs);
					if (typeof parsed === "string") {
						ctx.ui.notify(parsed, "error");
						return;
					}

					const hook = findHook(ctx.cwd, parsed.name);
					if (!hook) {
						ctx.ui.notify(
							`Hook "${parsed.name}" not found. Run /session-hook list to see available hooks.`,
							"error",
						);
						return;
					}

					ctx.ui.notify(
						`Running hook "${hook.name}" (timeout: ${hook.timeout ?? DEFAULT_TIMEOUT_MS}ms)...`,
						"info",
					);

					const result = await executeHook(hook, ctx.cwd);

					if (result.success) {
						const output = result.output || "(no output)";
						ctx.ui.notify(`Hook "${hook.name}" succeeded:\n${output}`, "info");
					} else {
						ctx.ui.notify(
							`Hook "${hook.name}" failed: ${result.error}`,
							"error",
						);
					}
					return;
				}

				case "edit": {
					const parsed = parseEditArgs(subArgs);
					if (typeof parsed === "string") {
						ctx.ui.notify(parsed, "error");
						return;
					}

					const target = parsed.project ? "project" : "global";
					const config = editHookConfig(ctx.cwd, parsed.project);

					if (!config) {
						ctx.ui.notify(
							`No ${target} session-hook config file found. Create one with /session-hook add.`,
							"info",
						);
						return;
					}

					const edited = await ctx.ui.editor(
						`Session Hook Config (${target})`,
						config.content,
					);

					if (edited === undefined) {
						// User cancelled
						return;
					}

					// Validate before saving
					try {
						const parsed = JSON.parse(edited);
						if (!Array.isArray(parsed.hooks)) {
							ctx.ui.notify(
								"Invalid config: 'hooks' must be an array. Changes not saved.",
								"error",
							);
							return;
						}
						// Write the raw edited text back
						writeConfigAtPath(config.path, parsed.hooks as HookEntry[]);
						ctx.ui.notify(
							`${target === "project" ? "Project" : "Global"} config updated.`,
							"info",
						);
					} catch {
						ctx.ui.notify("Invalid JSON. Changes not saved.", "error");
					}
					return;
				}

				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}. Use add, list, remove, test, edit.`,
						"warning",
					);
			}
		},
	});
}
