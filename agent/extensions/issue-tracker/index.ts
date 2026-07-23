import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { clearMeCache } from "./auth-prompts.ts";
import {
	executeCommentIssue,
	executeCreateIssue,
	executeCreateLabel,
	executeDeleteLabel,
	executeGetIssue,
	executeListIssues,
	executeListLabels,
	executeUpdateIssue,
	executeUpdateLabel,
} from "./tools.ts";

const labelSchema = Type.Object({
	name: Type.String(),
	scope: Type.Optional(Type.String()),
	color: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
});

const stateSchema = Type.Union([
	Type.Literal("open"),
	Type.Literal("closed"),
	Type.Literal("all"),
]);

function toToolContext(ctx: ExtensionContext): ToolContext {
	return {
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		ui: {
			confirm: (title, message) => ctx.ui.confirm(title, message),
			input: (title, placeholder) => ctx.ui.input(title, placeholder),
			notify: (message, type) => ctx.ui.notify(message, type),
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		clearMeCache();
	});

	pi.registerTool({
		name: "create_issue",
		label: "Create Issue",
		description:
			"Create a new issue on the detected issue tracker (GitHub, Forgejo, GitLab, or local). " +
			"Auto-creates missing labels. Use parent to create sub-issues.",
		parameters: Type.Object({
			title: Type.String(),
			body: Type.Optional(Type.String()),
			labels: Type.Optional(Type.Array(labelSchema)),
			parent: Type.Optional(
				Type.Number({ description: "Parent issue number for sub-issues" }),
			),
			assignee: Type.Optional(Type.String({ description: "Username or @me" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeCreateIssue(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "list_issues",
		label: "List Issues",
		description:
			"List issues from the detected issue tracker (GitHub, Forgejo, GitLab, or local). Filters by state, labels, assignee, parent, or unblocked status. " +
			"Returns summaries without full bodies; use get_issue for details.",
		parameters: Type.Object({
			state: Type.Optional(stateSchema),
			labels: Type.Optional(Type.Array(labelSchema)),
			assignee: Type.Optional(
				Type.String({ description: "Username, @me, or @unassigned" }),
			),
			unblocked: Type.Optional(
				Type.Boolean({ description: "Only issues with no open blockers" }),
			),
			parent: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeListIssues(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "get_issue",
		label: "Get Issue",
		description: "Get a single issue by number, optionally including comments.",
		parameters: Type.Object({
			issue_number: Type.Number(),
			include_comments: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeGetIssue(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "update_issue",
		label: "Update Issue",
		description:
			"Update an issue's title, body, state, labels, assignee, or blocked_by list. " +
			"blocked_by is a set-replacement: pass the complete list of blocker issue numbers. " +
			"Auto-creates missing labels.",
		parameters: Type.Object({
			issue_number: Type.Number(),
			title: Type.Optional(Type.String()),
			body: Type.Optional(Type.String()),
			state: Type.Optional(
				Type.Union([Type.Literal("open"), Type.Literal("closed")]),
			),
			labels: Type.Optional(Type.Array(labelSchema)),
			label_mode: Type.Optional(
				Type.Union([
					Type.Literal("replace"),
					Type.Literal("add"),
					Type.Literal("remove"),
				]),
			),
			assignee: Type.Optional(
				Type.Union([
					Type.String({ description: "Username or @me" }),
					Type.Null({ description: "Unassign" }),
				]),
			),
			blocked_by: Type.Optional(
				Type.Array(Type.Number(), {
					description: "Complete list of blocker issue numbers",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeUpdateIssue(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "comment_issue",
		label: "Comment on Issue",
		description: "Add a comment to an issue.",
		parameters: Type.Object({
			issue_number: Type.Number(),
			body: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeCommentIssue(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "list_labels",
		label: "List Labels",
		description: "List labels in the repository, optionally filtered by scope.",
		parameters: Type.Object({
			scope: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeListLabels(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "create_label",
		label: "Create Label",
		description:
			"Create a new label. Use scope to create a scoped label (e.g., priority:low on GitHub, priority/low on Forgejo, priority::low on GitLab).",
		parameters: Type.Object({
			name: Type.String(),
			scope: Type.Optional(Type.String()),
			color: Type.Optional(
				Type.String({ description: "Hex color, e.g. #d73a4a" }),
			),
			description: Type.Optional(Type.String()),
			exclusive: Type.Optional(
				Type.Boolean({
					description: "Only one label per scope (Forgejo/local UI hint)",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeCreateLabel(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "update_label",
		label: "Update Label",
		description: "Rename, recolor, or update a label's description.",
		parameters: Type.Object({
			name: Type.String(),
			scope: Type.Optional(Type.String()),
			new_name: Type.Optional(Type.String()),
			new_scope: Type.Optional(Type.String()),
			color: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			exclusive: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeUpdateLabel(toToolContext(ctx), params);
		},
	});

	pi.registerTool({
		name: "delete_label",
		label: "Delete Label",
		description:
			"Delete a label. The forge API will reject this if the label is in use on issues.",
		parameters: Type.Object({
			name: Type.String(),
			scope: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return executeDeleteLabel(toToolContext(ctx), params);
		},
	});
}
