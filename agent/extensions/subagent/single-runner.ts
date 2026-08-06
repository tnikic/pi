/**
 * Single agent runner — looks up an agent by name, wires up streaming
 * callbacks, and delegates to the engine via runSubagent + spawnSubprocess.
 *
 * Extracted from index.ts (Candidate 4) so the composition logic is
 * independently testable and index.ts stays focused on orchestration
 * and tool registration.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentConfig } from "./agent-config.ts";
import { getFinalOutput } from "./display-helpers.ts";
import { DEFAULT_CAPS, runSubagent } from "./engine.ts";
import { spawnSubprocess } from "./pi-process.ts";
import type { SubagentDetails } from "./renderer.ts";
import type { SubagentResult } from "./result-types.ts";

// ── Types ─────────────────────────────────────────────────────

export type OnUpdateCallback = (
	partial: AgentToolResult<SubagentDetails>,
) => void;

// ── Caps resolution ───────────────────────────────────────────

/**
 * Resolves safety caps from agent config, falling back to defaults.
 */
export function resolveCaps(agent: AgentConfig): typeof DEFAULT_CAPS {
	return {
		toolTimeout: agent.toolTimeout ?? DEFAULT_CAPS.toolTimeout,
		globalTimeout: agent.timeout
			? agent.timeout * 1000
			: DEFAULT_CAPS.globalTimeout,
		maxTurns: agent.maxTurns ?? DEFAULT_CAPS.maxTurns,
	};
}

// ── Runner ────────────────────────────────────────────────────

export async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SubagentResult[]) => SubagentDetails,
): Promise<SubagentResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
			step,
			completed: false,
		};
	}

	// Track streaming result for onUpdate callbacks
	let currentResult: SubagentResult | null = null;
	const onEvent = (engineState: import("./engine.ts").EventState) => {
		if (!onUpdate) return;
		currentResult = {
			agent: agentName,
			agentSource: agent.source,
			task,
			exitCode: -1, // still running
			messages: engineState.messages,
			stderr: "",
			usage: engineState.usage,
			model: engineState.model || agent.model,
			stopReason: engineState.stopReason,
			errorMessage: engineState.errorMessage,
			step,
			completed: engineState.completed,
		};
		onUpdate({
			content: [
				{
					type: "text",
					text: getFinalOutput(engineState.messages) || "(running...)",
				},
			],
			details: makeDetails([currentResult]),
		});
	};

	const caps = resolveCaps(agent);
	const engineResult = await runSubagent(
		{
			agent,
			task,
			cwd: cwd ?? defaultCwd,
			caps,
			signal,
			onEvent,
		},
		spawnSubprocess,
	);

	return {
		agent: engineResult.agent,
		agentSource: engineResult.agentSource,
		task: engineResult.task,
		exitCode: engineResult.exitCode,
		messages: engineResult.messages,
		stderr: engineResult.stderr,
		usage: engineResult.usage,
		model: engineResult.model,
		stopReason: engineResult.stopReason,
		errorMessage: engineResult.errorMessage,
		step,
		completed: engineResult.completed,
		reportDoneStatus: engineResult.reportDoneStatus,
		reportDoneSummary: engineResult.reportDoneSummary,
		reportDoneFindings: engineResult.reportDoneFindings,
	};
}
