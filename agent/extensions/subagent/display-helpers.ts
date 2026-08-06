/**
 * Display helpers — message extraction, tool call rendering, and
 * aggregate usage formatting for the subagent renderer.
 *
 * Extracted from toon-formatter.ts (Candidate 3).
 * Depends on toon-serialize.ts for formatTokens.
 */

import * as os from "node:os";
import { formatTokens } from "./toon-serialize.ts";

// ── Types ─────────────────────────────────────────────────────

export type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, unknown> };

// ── Usage stats ───────────────────────────────────────────────

/**
 * Formats aggregate usage stats into a compact single-line summary.
 * Includes turns, tokens in/out, cache r/w, cost, context tokens, and model.
 */
/**
 * Structural type: any object with these numeric fields works.
 * Both SubagentUsage and UsageAggregate satisfy it automatically.
 */
interface UsageStatsInput {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens?: number;
	turns: number;
}

export function formatUsageStats(
	usage: UsageStatsInput,
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns)
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

// ── Tool call display ─────────────────────────────────────────

/**
 * Formats a single tool call for display in subagent output.
 * Each tool gets a custom short representation.
 */
export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: string, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return (
				themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
			);
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

// ── Message extraction ────────────────────────────────────────

/** Returns the final text output from the last assistant message. */
export function getFinalOutput(messages: Record<string, unknown>[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			const content = msg.content as Array<Record<string, unknown>>;
			if (!content) continue;
			for (const part of content) {
				if (part.type === "text") return part.text as string;
			}
		}
	}
	return "";
}

/** Extracts display items (text blocks and tool calls) from messages. */
export function getDisplayItems(
	messages: Record<string, unknown>[],
): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			const content = msg.content as Array<Record<string, unknown>>;
			if (!content) continue;
			for (const part of content) {
				if (part.type === "text")
					items.push({ type: "text", text: part.text as string });
				else if (part.type === "toolCall")
					items.push({
						type: "toolCall",
						name: part.name as string,
						args: part.arguments as Record<string, unknown>,
					});
			}
		}
	}
	return items;
}
