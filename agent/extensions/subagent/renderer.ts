/**
 * TUI rendering for subagent results.
 *
 * Extracted from index.ts — takes SubagentDetails and produces
 * TUI tree nodes (Text, Container, Markdown, Spacer).
 *
 * The seam is simple: SubagentDetails + theme → TUI tree.
 * Execution (index.ts) builds SubagentDetails; renderer.ts
 * turns them into displayable output.
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { AgentScope } from "./agents.ts";
import type { SubagentResult, SubagentUsage } from "./result-types.ts";
import {
	type DisplayItem,
	formatToolCall,
	formatUsageStats,
	getDisplayItems,
	getFinalOutput,
	isFailedResult,
} from "./toon-formatter.ts";

// ── Theme (minimal interface) ─────────────────────────────────

interface RenderTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

// ── Constants ─────────────────────────────────────────────────

export const COLLAPSED_ITEM_COUNT = 3;

// ── Types ─────────────────────────────────────────────────────

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SubagentResult[];
}

// ── Helpers ───────────────────────────────────────────────────

function renderDisplayItems(
	items: DisplayItem[],
	theme: RenderTheme,
	expanded: boolean,
	limit?: number,
	isRunning = false,
): string {
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0)
		text += theme.fg("muted", `... ${skipped} earlier items\n`);
	for (let i = 0; i < toShow.length; i++) {
		const item = toShow[i];
		const isLast = i === toShow.length - 1;
		if (item.type === "text") {
			const preview = expanded
				? item.text
				: item.text.split("\n").slice(0, 3).join("\n");
			text += `${theme.fg("toolOutput", preview)}\n`;
		} else {
			const arrow =
				isRunning && isLast
					? theme.fg("warning", "→ ")
					: theme.fg("muted", "→ ");
			text += `${arrow + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
		}
	}
	return text.trimEnd();
}

function aggregateUsage(results: SubagentResult[]): SubagentUsage {
	const total: SubagentUsage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

// ── renderCall ────────────────────────────────────────────────

/**
 * Renders the subagent tool call card before execution.
 * Shows mode, agent name(s), task preview, and scope.
 */
export function renderCall(
	args: Record<string, unknown>,
	theme: RenderTheme,
	_context: unknown,
): Text {
	const scope: AgentScope = (args.agentScope as AgentScope) ?? "user";
	if (args.chain && Array.isArray(args.chain) && args.chain.length > 0) {
		let text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", `chain (${args.chain.length} steps)`) +
			theme.fg("muted", ` [${scope}]`);
		for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
			const step = args.chain[i] as Record<string, unknown>;
			// Clean up {previous} placeholder for display
			const cleanTask = (step.task as string).replace(/\{previous\}/g, "").trim();
			const preview =
				cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
			text +=
				"\n  " +
				theme.fg("muted", `${i + 1}.`) +
				" " +
				theme.fg("accent", step.agent as string) +
				theme.fg("dim", ` ${preview}`);
		}
		if (args.chain.length > 3)
			text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}
	if (args.tasks && Array.isArray(args.tasks) && args.tasks.length > 0) {
		let text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
			theme.fg("muted", ` [${scope}]`);
		for (const t of args.tasks.slice(0, 3)) {
			const task = t as Record<string, unknown>;
			const taskStr = task.task as string;
			const preview =
				taskStr.length > 40 ? `${taskStr.slice(0, 40)}...` : taskStr;
			text += `\n  ${theme.fg("accent", task.agent as string)}${theme.fg("dim", ` ${preview}`)}`;
		}
		if (args.tasks.length > 3)
			text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		return new Text(text, 0, 0);
	}
	const agentName = (args.agent as string) || "...";
	const taskStr = args.task as string | undefined;
	const preview = taskStr
		? taskStr.length > 60
			? `${taskStr.slice(0, 60)}...`
			: taskStr
		: "...";
	let text =
		theme.fg("toolTitle", theme.bold("subagent ")) +
		theme.fg("accent", agentName) +
		theme.fg("muted", ` [${scope}]`);
	text += `\n  ${theme.fg("dim", preview)}`;
	return new Text(text, 0, 0);
}

// ── Per-mode render functions ─────────────────────────────────

/**
 * Render a single subagent result.
 * Handles both expanded (Container) and collapsed (Text) views.
 */
function renderSingleResult(
	details: SubagentDetails,
	expanded: boolean,
	theme: RenderTheme,
	mdTheme: ReturnType<typeof getMarkdownTheme>,
): Text | Container {
	const r = details.results[0];
	const isError = isFailedResult(r);
	const icon = isError
		? theme.fg("error", "✗")
		: theme.fg("success", "✓");
	const displayItems = getDisplayItems(r.messages);
	const finalOutput = getFinalOutput(r.messages);

	if (expanded) {
		const container = new Container();
		let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
		if (isError && r.stopReason)
			header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
		container.addChild(new Text(header, 0, 0));
		if (isError && r.errorMessage)
			container.addChild(
				new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
			);
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
		container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(
			new Text(theme.fg("muted", "─── Output ───"), 0, 0),
		);
		if (displayItems.length === 0 && !finalOutput) {
			container.addChild(
				new Text(theme.fg("muted", "(no output)"), 0, 0),
			);
		} else {
			for (const item of displayItems) {
				if (item.type === "toolCall")
					container.addChild(
						new Text(
							theme.fg("muted", "→ ") +
								formatToolCall(
									item.name,
									item.args,
									theme.fg.bind(theme),
								),
							0,
							0,
						),
					);
			}
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(
					new Markdown(finalOutput.trim(), 0, 0, mdTheme),
				);
			}
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
		}
		return container;
	}

	// Collapsed
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
	if (isError && r.stopReason)
		text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
	if (isError && r.errorMessage)
		text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
	else if (displayItems.length === 0)
		text += `\n${theme.fg("muted", "(no output)")}`;
	else {
		const isRunning = r.exitCode === -1;
		text += `\n${renderDisplayItems(displayItems, theme, expanded, COLLAPSED_ITEM_COUNT, isRunning)}`;
		if (displayItems.length > COLLAPSED_ITEM_COUNT)
			text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	const usageStr = formatUsageStats(r.usage, r.model);
	if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
	return new Text(text, 0, 0);
}

/**
 * Render a chain of subagent results.
 * Handles both expanded (Container) and collapsed (Text) views.
 */
function renderChainResult(
	details: SubagentDetails,
	expanded: boolean,
	theme: RenderTheme,
	mdTheme: ReturnType<typeof getMarkdownTheme>,
): Text | Container {
	const successCount = details.results.filter(
		(r) => r.exitCode === 0,
	).length;
	const icon =
		successCount === details.results.length
			? theme.fg("success", "✓")
			: theme.fg("error", "✗");

	if (expanded) {
		const container = new Container();
		container.addChild(
			new Text(
				icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg(
						"accent",
						`${successCount}/${details.results.length} steps`,
					),
				0,
				0,
			),
		);

		for (const r of details.results) {
			const rIcon =
				r.exitCode === 0
					? theme.fg("success", "✓")
					: theme.fg("error", "✗");
			const displayItems = getDisplayItems(r.messages);
			const finalOutput = getFinalOutput(r.messages);

			container.addChild(new Spacer(1));
			container.addChild(
				new Text(
					`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
					0,
					0,
				),
			);
			container.addChild(
				new Text(
					theme.fg("muted", "Task: ") + theme.fg("dim", r.task),
					0,
					0,
				),
			);

			// Show tool calls
			for (const item of displayItems) {
				if (item.type === "toolCall") {
					container.addChild(
						new Text(
							theme.fg("muted", "→ ") +
								formatToolCall(
									item.name,
									item.args,
									theme.fg.bind(theme),
								),
							0,
							0,
						),
					);
				}
			}

			// Show final output as markdown
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(
					new Markdown(finalOutput.trim(), 0, 0, mdTheme),
				);
			}

			const stepUsage = formatUsageStats(r.usage, r.model);
			if (stepUsage)
				container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
		}

		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(
				new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0),
			);
		}
		return container;
	}

	// Collapsed view
	let text =
		icon +
		" " +
		theme.fg("toolTitle", theme.bold("chain ")) +
		theme.fg("accent", `${successCount}/${details.results.length} steps`);
	for (const r of details.results) {
		const rIcon =
			r.exitCode === 0
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");
		const displayItems = getDisplayItems(r.messages);
		text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
		if (displayItems.length === 0)
			text += `\n${theme.fg("muted", "(no output)")}`;
		else {
			const isRunning = r.exitCode === -1;
			text += `\n${renderDisplayItems(displayItems, theme, expanded, 3, isRunning)}`;
		}
	}
	const usageStr = formatUsageStats(aggregateUsage(details.results));
	if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}

/**
 * Render a set of parallel subagent results.
 * Handles both expanded (Container) and collapsed (Text) views,
 * including the live-streaming "still running" state.
 */
function renderParallelResult(
	details: SubagentDetails,
	expanded: boolean,
	theme: RenderTheme,
	mdTheme: ReturnType<typeof getMarkdownTheme>,
): Text | Container {
	const running = details.results.filter((r) => r.exitCode === -1).length;
	const successCount = details.results.filter(
		(r) => r.exitCode !== -1 && !isFailedResult(r),
	).length;
	const failCount = details.results.filter(
		(r) => r.exitCode !== -1 && isFailedResult(r),
	).length;
	const isRunning = running > 0;
	const icon = isRunning
		? theme.fg("warning", "⏳")
		: failCount > 0
			? theme.fg("warning", "◐")
			: theme.fg("success", "✓");
	const status = isRunning
		? `${successCount + failCount}/${details.results.length} done, ${running} running`
		: `${successCount}/${details.results.length} tasks`;

	if (expanded && !isRunning) {
		const container = new Container();
		container.addChild(
			new Text(
				`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
				0,
				0,
			),
		);

		for (const r of details.results) {
			const rIcon = isFailedResult(r)
				? theme.fg("error", "✗")
				: theme.fg("success", "✓");
			const displayItems = getDisplayItems(r.messages);
			const finalOutput = getFinalOutput(r.messages);

			container.addChild(new Spacer(1));
			container.addChild(
				new Text(
					`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`,
					0,
					0,
				),
			);
			container.addChild(
				new Text(
					theme.fg("muted", "Task: ") + theme.fg("dim", r.task),
					0,
					0,
				),
			);

			// Show tool calls
			for (const item of displayItems) {
				if (item.type === "toolCall") {
					container.addChild(
						new Text(
							theme.fg("muted", "→ ") +
								formatToolCall(
									item.name,
									item.args,
									theme.fg.bind(theme),
								),
							0,
							0,
						),
					);
				}
			}

			// Show final output as markdown
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(
					new Markdown(finalOutput.trim(), 0, 0, mdTheme),
				);
			}

			const taskUsage = formatUsageStats(r.usage, r.model);
			if (taskUsage)
				container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
		}

		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(
				new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0),
			);
		}
		return container;
	}

	// Collapsed view (or still running)
	let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
	for (const r of details.results) {
		const rIcon =
			r.exitCode === -1
				? theme.fg("warning", "⏳")
				: isFailedResult(r)
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
		const displayItems = getDisplayItems(r.messages);
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
		if (displayItems.length === 0)
			text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
		else {
			const isRunningAgent = r.exitCode === -1;
			text += `\n${renderDisplayItems(displayItems, theme, expanded, 3, isRunningAgent)}`;
		}
	}
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	}
	if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}

// ── renderResult (dispatcher) ─────────────────────────────────

/**
 * Route subagent results to the appropriate per-mode renderer.
 * Exported for use by index.ts tool registration.
 */
export function renderResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	{ expanded }: { expanded: boolean },
	theme: RenderTheme,
	_context: unknown,
): Text | Container {
	const details = result.details as SubagentDetails | undefined;
	if (!details || details.results.length === 0) {
		const text = result.content[0];
		return new Text(
			text?.type === "text" ? text.text : "(no output)",
			0,
			0,
		);
	}

	const mdTheme = getMarkdownTheme();

	if (details.mode === "single" && details.results.length === 1) {
		return renderSingleResult(details, expanded, theme, mdTheme);
	}
	if (details.mode === "chain") {
		return renderChainResult(details, expanded, theme, mdTheme);
	}
	if (details.mode === "parallel") {
		return renderParallelResult(details, expanded, theme, mdTheme);
	}

	// Fallback: raw content text
	const text = result.content[0];
	return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
}
