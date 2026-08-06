/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentConfig } from "./agent-config.ts";
import { type AgentScope, discoverAgents } from "./agents.ts";
import { mapWithConcurrencyLimit } from "./concurrency.ts";
import { validateModes } from "./orchestrator.ts";
import { DEFAULT_CAPS, runSubagent } from "./engine.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";
import {
	formatAvailableAgents,
	formatChainToon,
	formatParallelToon,
	formatSingleToon,
	getFinalOutput,
	isFailedResult,
} from "./toon-formatter.ts";
import { type SubagentDetails, renderCall, renderResult } from "./renderer.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

/**
 * Resolves safety caps from agent config, falling back to defaults.
 */
function resolveCaps(agent: AgentConfig): typeof DEFAULT_CAPS {
	return {
		toolTimeout: agent.toolTimeout ?? DEFAULT_CAPS.toolTimeout,
		globalTimeout: agent.timeout
			? agent.timeout * 1000
			: DEFAULT_CAPS.globalTimeout,
		maxTurns: agent.maxTurns ?? DEFAULT_CAPS.maxTurns,
	};
}

async function runSingleAgent(
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
					text:
						getFinalOutput(engineState.messages) || "(running...)",
				},
			],
			details: makeDetails([currentResult]),
		});
	};

	const caps = resolveCaps(agent);
	const engineResult = await runSubagent({
		agent,
		task,
		cwd: cwd ?? defaultCwd,
		caps,
		signal,
		onEvent,
	});

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

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({
		description:
			"Task to delegate to the agent (use {previous} placeholder for chain mode)",
	}),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	chain: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for sequential execution",
		}),
	),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description: "Prompt before running project-local agents. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process (single mode)",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SubagentResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			const modeError = validateModes(hasChain, hasTasks, hasSingle);
			if (modeError) {
				return {
					content: [
						{
							type: "text",
							text: `${modeError}\nAvailable agents: ${formatAvailableAgents(agents)}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI
			) {
				const requestedAgentNames = new Set<string>();
				if (params.chain)
					for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks)
					for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [
								{
									type: "text",
									text: "Canceled: project-local agents not approved.",
								},
							],
							details: makeDetails(
								hasChain ? "chain" : hasTasks ? "parallel" : "single",
							)([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SubagentResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(
						/\{previous\}/g,
						previousOutput,
					);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError = isFailedResult(result);
					if (isError) {
						return {
							content: [
								{
									type: "text",
									text: formatChainToon(results),
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [
						{
							type: "text",
							text: formatChainToon(results),
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SubagentResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							cost: 0,
							contextTokens: 0,
							turns: 0,
						},
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{
									type: "text",
									text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
								},
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					MAX_CONCURRENCY,
					async (t, index) => {
						const result = await runSingleAgent(
							ctx.cwd,
							agents,
							t.agent,
							t.task,
							t.cwd,
							undefined,
							signal,
							// Per-task update callback
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallelUpdate();
								}
							},
							makeDetails("parallel"),
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				return {
					content: [
						{
							type: "text",
							text: formatParallelToon(results),
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = isFailedResult(result);
				return {
					content: [
						{
							type: "text",
							text: formatSingleToon(result),
						},
					],
					details: makeDetails("single")([result]),
					...(isError ? { isError: true } : {}),
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available agents: ${formatAvailableAgents(agents)}`,
					},
				],
				details: makeDetails("single")([]),
			};
		},

		renderCall,
		renderResult,
	});
}
