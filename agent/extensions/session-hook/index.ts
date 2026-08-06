/**
 * Session Hook Extension — runs user-configured shell commands at session start
 * and injects their output as ambient context before the first agent turn.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	formatHookOutput,
	type HookRunState,
	loadConfig,
	runHooks,
} from "./engine.ts";

/** Module-level state: populated at session_start, consumed at before_agent_start. */
let currentState: HookRunState | null = null;

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
}
