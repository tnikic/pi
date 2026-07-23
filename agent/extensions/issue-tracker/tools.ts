import { ensureAuth, resolveMeUsername } from "./auth-prompts.ts";
import { detectBackend } from "./backend.ts";
import { formatLabel } from "./labels.ts";
import type {
	Backend,
	BackendConfig,
	CreateIssueParams as CreateIssueBackendParams,
	Label,
	ListIssuesParams as ListIssuesBackendParams,
	TokenInfo,
	UpdateIssueParams as UpdateIssueBackendParams,
} from "./types.ts";

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;

// ─── Output truncation ──────────────────────────────────────────

function truncateHead(
	text: string,
	options: { maxLines: number; maxBytes: number },
): string {
	const lines = text.split("\n");
	if (lines.length > options.maxLines) {
		return lines.slice(0, options.maxLines).join("\n");
	}
	const encoder = new TextEncoder();
	if (encoder.encode(text).length > options.maxBytes) {
		let result = text;
		while (
			encoder.encode(result).length > options.maxBytes &&
			result.length > 0
		) {
			result = result.slice(0, -1);
		}
		return result;
	}
	return text;
}

function truncateResult(text: string): string {
	return truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
}

// ─── Response formatting ────────────────────────────────────────

function formatResponse(
	text: string,
	details: unknown,
): {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
} {
	return {
		content: [{ type: "text", text: truncateResult(text) }],
		details,
	};
}

// ─── UI interface ───────────────────────────────────────────────

export interface ToolUI {
	confirm(title: string, message: string): Promise<boolean>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
	notify(message: string, type: string): void;
}

export interface ToolContext {
	cwd: string;
	hasUI: boolean;
	ui: ToolUI;
	authPath?: string;
}

// ─── Pipeline ───────────────────────────────────────────────────

/** Resolve backend + auth — the common first step for every tool. */
async function resolveBackend(ctx: ToolContext): Promise<{
	config: BackendConfig;
	backend: Backend;
	token: TokenInfo;
}> {
	const { config, backend } = await detectBackend(ctx.cwd);
	const token = await ensureAuth(config, ctx);
	return { config, backend, token };
}

// ─── Label helpers ──────────────────────────────────────────────

export async function ensureLabels(
	labels: Label[],
	backend: Backend,
	config: BackendConfig,
	token: TokenInfo,
): Promise<{ created: string[] }> {
	const created: string[] = [];
	if (labels.length === 0) return { created };

	const existing = await backend.listLabels({}, config, token);
	const existingNames = new Set(
		existing.map((l) => formatLabel(l, config.type)),
	);

	for (const label of labels) {
		const displayName = formatLabel(label, config.type);
		if (!existingNames.has(displayName)) {
			await backend.createLabel(
				{
					name: label.name,
					scope: label.scope,
					color: label.color,
					description: label.description,
				},
				config,
				token,
			);
			created.push(displayName);
		}
	}

	return { created };
}

export async function normalizeAssignee(
	assignee: string | undefined,
	backend: BackendConfig,
	token: TokenInfo,
): Promise<string | undefined> {
	if (!assignee) return undefined;
	if (assignee === "@me") {
		return await resolveMeUsername(backend, token);
	}
	return assignee;
}

// ─── Tool implementations ───────────────────────────────────────

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
};

export async function executeCreateIssue(
	ctx: ToolContext,
	params: {
		title: string;
		body?: string;
		labels?: Label[];
		parent?: number;
		assignee?: string;
	},
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const labels = params.labels ?? [];
	const { created } = await ensureLabels(labels, backend, config, token);

	const createParams: CreateIssueBackendParams = {
		title: params.title,
		body: params.body,
		labels,
		parent: params.parent,
		assignee: await normalizeAssignee(params.assignee, config, token),
	};

	const issue = await backend.createIssue(createParams, config, token);

	const createdNote =
		created.length > 0 ? `\n(created labels: ${created.join(", ")})` : "";
	return formatResponse(
		JSON.stringify(
			{ ...issue, note: `Created issue #${issue.number}${createdNote}` },
			null,
			2,
		),
		{ issue, createdLabels: created },
	);
}

export async function executeListIssues(
	ctx: ToolContext,
	params: {
		state?: "open" | "closed" | "all";
		labels?: Label[];
		assignee?: "@me" | "@unassigned" | string;
		unblocked?: boolean;
		parent?: number;
		limit?: number;
	},
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const listParams: ListIssuesBackendParams = {
		state: params.state,
		labels: params.labels,
		assignee: params.assignee,
		unblocked: params.unblocked,
		parent: params.parent,
		limit: params.limit,
	};

	if (listParams.assignee === "@me") {
		listParams.assignee = await resolveMeUsername(config, token);
	}

	const issues = await backend.listIssues(listParams, config, token);
	return formatResponse(JSON.stringify(issues, null, 2), { issues });
}

export async function executeGetIssue(
	ctx: ToolContext,
	params: { issue_number: number; include_comments?: boolean },
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const issue = await backend.getIssue(
		{
			issue_number: params.issue_number,
			include_comments: params.include_comments,
		},
		config,
		token,
	);

	return formatResponse(JSON.stringify(issue, null, 2), { issue });
}

export async function executeUpdateIssue(
	ctx: ToolContext,
	params: {
		issue_number: number;
		title?: string;
		body?: string;
		state?: "open" | "closed";
		labels?: Label[];
		label_mode?: "replace" | "add" | "remove";
		assignee?: string | null;
		blocked_by?: number[];
	},
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const labels = params.labels ?? [];
	let created: string[] = [];
	if (labels.length > 0 && params.label_mode !== "remove") {
		const ensured = await ensureLabels(labels, backend, config, token);
		created = ensured.created;
	}

	const updateParams: UpdateIssueBackendParams = {
		issue_number: params.issue_number,
		title: params.title,
		body: params.body,
		state: params.state,
		labels: params.labels,
		label_mode: params.label_mode,
		assignee:
			params.assignee === undefined
				? undefined
				: params.assignee === null
					? null
					: await normalizeAssignee(params.assignee, config, token),
		blocked_by: params.blocked_by,
	};

	const issue = await backend.updateIssue(updateParams, config, token);

	const createdNote =
		created.length > 0 ? `\n(created labels: ${created.join(", ")})` : "";
	return formatResponse(
		JSON.stringify(
			{ ...issue, note: `Updated issue #${issue.number}${createdNote}` },
			null,
			2,
		),
		{ issue, createdLabels: created },
	);
}

export async function executeCommentIssue(
	ctx: ToolContext,
	params: { issue_number: number; body: string },
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const comment = await backend.commentIssue(
		{ issue_number: params.issue_number, body: params.body },
		config,
		token,
	);

	return formatResponse(JSON.stringify(comment, null, 2), { comment });
}

export async function executeListLabels(
	ctx: ToolContext,
	params: { scope?: string },
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const labels = await backend.listLabels(
		{ scope: params.scope },
		config,
		token,
	);
	return formatResponse(JSON.stringify(labels, null, 2), { labels });
}

export async function executeCreateLabel(
	ctx: ToolContext,
	params: {
		name: string;
		scope?: string;
		color?: string;
		description?: string;
		exclusive?: boolean;
	},
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const label = await backend.createLabel(params, config, token);
	return formatResponse(JSON.stringify(label, null, 2), { label });
}

export async function executeUpdateLabel(
	ctx: ToolContext,
	params: {
		name: string;
		scope?: string;
		new_name?: string;
		new_scope?: string;
		color?: string;
		description?: string;
		exclusive?: boolean;
	},
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	const label = await backend.updateLabel(params, config, token);
	return formatResponse(JSON.stringify(label, null, 2), { label });
}

export async function executeDeleteLabel(
	ctx: ToolContext,
	params: { name: string; scope?: string },
): Promise<ToolResult> {
	const { config, backend, token } = await resolveBackend(ctx);

	await backend.deleteLabel(params, config, token);

	return formatResponse(
		`Deleted label ${formatLabel({ name: params.name, scope: params.scope }, config.type)}`,
		{},
	);
}
