/**
 * Session Hook Extension — runs user-configured shell commands at session start
 * and injects their output as ambient context for the agent. At session end,
 * runs session_end_commands to capture per-tool session memory.
 *
 * Provides /session-hook slash commands for interactive hook management:
 *   add <name> --command <cmd> [--timeout <ms>] [--end-command <cmd>] [--project]
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
	loadConfig,
	loadMemory,
	parseAddArgs,
	parseArgs,
	parseEditArgs,
	parseRemoveArgs,
	parseTestArgs,
	removeHook,
	runHooks,
	type SessionMemory,
	writeMemory,
	writeConfigAtPath,
} from "./engine.ts";

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		if (!config) return;

		const state = await runHooks(config, ctx.cwd);
		if (!state.hadHooks) return;

		const memory = loadMemory(ctx.cwd);
		const content = formatHookOutput(state, memory);
		if (!content) return;

		// Inject hook output into agent context silently (agent sees it, user doesn't)
		pi.sendMessage({
			customType: "session-hook",
			content,
			display: false,
		});

		// Compact notification for the user
		const names = state.results.map((r) => r.name).join(", ");
		ctx.ui.notify(`Session hooks: ${names}`, "info");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		if (!config) return;

		// Collect session-end commands, grouped by scope (global vs project)
		const allHooks = listHooks(ctx.cwd);
		const endCommands: { entry: HookEntry; project: boolean }[] = [];
		for (const entry of config.hooks) {
			if (!entry.session_end_command) continue;

			const source = allHooks.find((h) => h.name === entry.name)?.source;
			endCommands.push({
				entry,
				project: source === "project",
			});
		}

		if (endCommands.length === 0) return;

		// Run session-end commands in parallel
		const results = await Promise.all(
			endCommands.map(async ({ entry, project }) => {
				const command = entry.session_end_command;
				if (!command) {
					return {
						name: entry.name,
						result: {
							name: entry.name,
							success: false,
							output: "",
							error: "missing session_end_command",
						},
						project,
					};
				}
				const result = await executeHook(
					{ name: entry.name, command },
					ctx.cwd,
				);
				return { name: entry.name, result, project };
			}),
		);

		// Build per-scope memory and write
		const globalMemory: SessionMemory = {};
		const projectMemory: SessionMemory = {};

		for (const { name, result, project } of results) {
			const memEntry = {
				output: result.success
					? result.output.trim() || "(no output)"
					: `error: ${result.error}`,
				timestamp: Date.now(),
			};
			if (project) {
				projectMemory[name] = memEntry;
			} else {
				globalMemory[name] = memEntry;
			}
		}

		if (Object.keys(globalMemory).length > 0) {
			writeMemory(ctx.cwd, false, globalMemory);
		}
		if (Object.keys(projectMemory).length > 0) {
			writeMemory(ctx.cwd, true, projectMemory);
		}
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
					if (result.endCommand !== undefined) {
						entry.session_end_command = result.endCommand;
					}

					const { overwrote } = addHook(ctx.cwd, entry, result.project);

					const target = result.project ? "project" : "global";
					const action = overwrote ? "Updated" : "Added";
					const timeoutInfo =
						entry.timeout !== undefined
							? ` (timeout: ${entry.timeout}ms)`
							: ` (default timeout: ${DEFAULT_TIMEOUT_MS}ms)`;
					const endInfo = entry.session_end_command
						? `, end-command: ${entry.session_end_command}`
						: "";

					ctx.ui.notify(
						`${action} hook "${result.name}" in ${target} config${timeoutInfo}${endInfo}`,
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
						const endCmd = h.session_end_command
							? `  end-command: ${h.session_end_command}`
							: "";
						return `${h.name}  [${h.source}]  managed_by: ${managed}  timeout: ${timeout}  command: ${h.command}${endCmd}`;
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
						return;
					}

					try {
						const parsed = JSON.parse(edited);
						if (!Array.isArray(parsed.hooks)) {
							ctx.ui.notify(
								"Invalid config: 'hooks' must be an array. Changes not saved.",
								"error",
							);
							return;
						}
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
