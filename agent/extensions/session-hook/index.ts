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
	formatHookOutput,
	type HookEntry,
	type HookRunState,
	listHooks,
	loadConfig,
	parseAddArgs,
	parseArgs,
	runHooks,
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
		description:
			"Manage session hooks: add, list (remove, test, edit coming soon)",
		handler: async (rawArgs, ctx) => {
			const args = parseArgs(rawArgs.trim());

			if (args.length === 0) {
				ctx.ui.notify("Usage: /session-hook <add|list>", "warning");
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

				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}. Use add, list.`,
						"warning",
					);
			}
		},
	});
}
