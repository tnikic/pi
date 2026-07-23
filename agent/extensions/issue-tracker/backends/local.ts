import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { formatLabel } from "../labels.ts";
import type {
	AuthConfig,
	Backend,
	BackendConfig,
	BackendRegistration,
	Issue,
	Label,
	TokenInfo,
} from "../types.ts";
import { labelRow, labelsTable, parseLabelsTable } from "./local-labels.ts";
import {
	extractLabelsYaml,
	labelMatches,
	parseBlockedBy,
	parseFrontMatter,
	parseIssueFile,
	parseLabelsYaml,
	slugify,
	toFrontMatter,
} from "./local-markdown.ts";

// ─── File helpers ───────────────────────────────────────────────

function findIssueFile(issuesPath: string, number: number): string | null {
	const prefix = String(number).padStart(3, "0");
	const files = readdirSync(issuesPath).filter(
		(f) => f.startsWith(`${prefix}-`) && f.endsWith(".md") && f !== "labels.md",
	);
	const first = files[0];
	return first ? join(issuesPath, first) : null;
}

function nextNumber(issuesPath: string): number {
	if (!existsSync(issuesPath)) return 1;
	const files = readdirSync(issuesPath).filter(
		(f) => f.match(/^\d{3}-.+\.md$/) && f !== "labels.md",
	);
	if (files.length === 0) return 1;
	const numbers = files
		.map((f) => parseInt(f.slice(0, 3), 10))
		.filter((n) => !Number.isNaN(n));
	return Math.max(0, ...numbers) + 1;
}

// ─── Backend ────────────────────────────────────────────────────

export const localBackend: Backend = {
	async createIssue(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		mkdirSync(p, { recursive: true });

		const number = nextNumber(p);
		const now = new Date().toISOString();
		const prefix = String(number).padStart(3, "0");
		const slug = slugify(params.title);
		const filePath = join(p, `${prefix}-${slug}.md`);

		const labels = params.labels ?? [];

		const issueData = {
			title: params.title,
			number,
			state: "open",
			labels,
			assignee: params.assignee ?? null,
			parent: params.parent ?? null,
			blocked_by: [] as number[],
			created_at: now,
			updated_at: now,
		};

		const frontMatter = toFrontMatter(issueData);
		const content = `${frontMatter}\n\n${params.body ?? ""}\n`;

		writeFileSync(filePath, content, "utf8");

		// If this is a sub-issue, update the parent body
		if (params.parent) {
			const parentPath = findIssueFile(p, params.parent);
			if (parentPath) {
				const raw = readFileSync(parentPath, "utf8");
				const { meta, body } = parseFrontMatter(raw);
				const newBody = body.includes("## Sub-issues")
					? body.replace(
							/(## Sub-issues\n)/,
							`$1- [ ] #${number} ${params.title}\n`,
						)
					: `${body}\n## Sub-issues\n- [ ] #${number} ${params.title}\n`;
				const updatedRaw = `${toFrontMatter({
					title: String(meta.title ?? ""),
					number: Number(meta.number) || params.parent,
					state: String(meta.state ?? "open"),
					labels: parseLabelsYaml(extractLabelsYaml(raw)),
					assignee:
						meta.assignee === "null" || !meta.assignee
							? null
							: String(meta.assignee),
					parent:
						meta.parent === "null" || !meta.parent ? null : Number(meta.parent),
					blocked_by: parseBlockedBy(meta.blocked_by),
					created_at: String(meta.created_at ?? now),
					updated_at: now,
				})}\n\n${newBody}`;
				writeFileSync(parentPath, updatedRaw, "utf8");
			}
		}

		return {
			...issueData,
			body: params.body ?? "",
			url: `file://${filePath}`,
		};
	},

	async listIssues(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		if (!existsSync(p)) return [];

		const files = readdirSync(p).filter(
			(f) => f.match(/^\d{3}-.+\.md$/) && f !== "labels.md",
		);

		let issues: Issue[] = [];
		for (const file of files) {
			const content = readFileSync(join(p, file), "utf8");
			const issue = parseIssueFile(content, join(p, file));
			issues.push(issue);
		}

		if (params.state && params.state !== "all") {
			issues = issues.filter((i) => i.state === params.state);
		}
		if (params.labels && params.labels.length > 0) {
			issues = issues.filter((i) =>
				params.labels?.every((fl) =>
					i.labels.some((il) => labelMatches(il, fl)),
				),
			);
		}
		if (params.assignee === "@unassigned") {
			issues = issues.filter((i) => i.assignee === null);
		} else if (params.assignee && params.assignee !== "@me") {
			issues = issues.filter((i) => i.assignee === params.assignee);
		}
		if (params.parent !== undefined) {
			issues = issues.filter((i) => i.parent === params.parent);
		}
		if (params.unblocked) {
			issues = issues.filter((i) => i.blocked_by.length === 0);
		}

		issues.sort((a, b) => b.number - a.number);

		if (params.limit) {
			issues = issues.slice(0, params.limit);
		}

		return issues.map((i) => {
			const { body: _body, comments: _comments, ...rest } = i;
			return { ...rest, body: "" };
		});
	},

	async getIssue(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const filePath = findIssueFile(p, params.issue_number);
		if (!filePath) {
			throw new Error(`Issue #${params.issue_number} not found`);
		}
		const content = readFileSync(filePath, "utf8");
		const issue = parseIssueFile(content, filePath);
		if (!params.include_comments) {
			issue.comments = undefined;
		}
		return issue;
	},

	async updateIssue(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const filePath = findIssueFile(p, params.issue_number);
		if (!filePath) {
			throw new Error(`Issue #${params.issue_number} not found`);
		}
		const content = readFileSync(filePath, "utf8");
		parseFrontMatter(content); // validate front matter exists
		const issue = parseIssueFile(content, filePath);
		const now = new Date().toISOString();

		if (params.title !== undefined) issue.title = params.title;
		if (params.body !== undefined) issue.body = params.body;
		if (params.state !== undefined) issue.state = params.state;
		if (params.assignee !== undefined) issue.assignee = params.assignee;
		if (params.blocked_by !== undefined) issue.blocked_by = params.blocked_by;

		if (params.labels) {
			if (params.label_mode === "add") {
				for (const newLabel of params.labels) {
					if (!issue.labels.some((l) => labelMatches(l, newLabel))) {
						issue.labels.push(newLabel);
					}
				}
			} else if (params.label_mode === "remove") {
				issue.labels = issue.labels.filter(
					(l) => !params.labels?.some((rl) => labelMatches(l, rl)),
				);
			} else {
				issue.labels = params.labels;
			}
		}

		const commentsSection = content.includes("\n## Comments\n")
			? content.slice(content.indexOf("\n## Comments\n"))
			: "";

		issue.updated_at = now;
		const frontMatter = toFrontMatter(issue);
		const newContent = `${frontMatter}\n\n${issue.body}${commentsSection}\n`;
		writeFileSync(filePath, newContent, "utf8");

		return issue;
	},

	async commentIssue(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const filePath = findIssueFile(p, params.issue_number);
		if (!filePath) {
			throw new Error(`Issue #${params.issue_number} not found`);
		}
		const content = readFileSync(filePath, "utf8");
		const now = new Date().toISOString();

		let author = "user";
		try {
			author =
				execSync("git config user.name", {
					encoding: "utf8",
					stdio: ["pipe", "pipe", "ignore"],
				}).trim() || "user";
		} catch {
			// keep default
		}

		const comment = `\n### Comment by ${author} on ${now}\n\n${params.body}\n---\n`;

		let newContent: string;
		if (content.includes("\n## Comments\n")) {
			newContent = content + comment;
		} else {
			newContent = `${content.trimEnd()}\n## Comments\n${comment}`;
		}

		writeFileSync(filePath, newContent, "utf8");

		return {
			id: `c${Date.now()}`,
			author,
			body: params.body,
			created_at: now,
		};
	},

	async listLabels(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const labelsPath = join(p, "labels.md");
		if (!existsSync(labelsPath)) return [];

		const content = readFileSync(labelsPath, "utf8");
		const labels = parseLabelsTable(content);

		const scope = params.scope;
		if (scope) {
			return labels.filter(
				(l) => l.scope === scope || l.name.startsWith(`${scope}:`),
			);
		}
		return labels;
	},

	async createLabel(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		mkdirSync(p, { recursive: true });
		const labelsPath = join(p, "labels.md");

		const label: Label = {
			name: params.name,
			scope: params.scope,
			color: params.color,
			description: params.description,
			exclusive: params.exclusive,
		};

		const displayName = formatLabel(label, "local");

		if (!existsSync(labelsPath)) {
			const table = labelsTable([label]);
			writeFileSync(labelsPath, `# Labels\n\n${table}`, "utf8");
		} else {
			const content = readFileSync(labelsPath, "utf8");
			const existing = parseLabelsTable(content);
			const found = existing.some(
				(l) => formatLabel(l, "local") === displayName,
			);
			if (!found) {
				const row = labelRow(label);
				const newContent = `${content.trimEnd()}\n${row}`;
				writeFileSync(labelsPath, newContent, "utf8");
			}
		}

		return label;
	},

	async updateLabel(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const labelsPath = join(p, "labels.md");
		if (!existsSync(labelsPath)) {
			throw new Error("Labels file not found");
		}

		const displayName = formatLabel(
			{ name: params.name, scope: params.scope },
			"local",
		);

		const content = readFileSync(labelsPath, "utf8");
		const labels = parseLabelsTable(content);

		const existingLabel = labels.find(
			(l) => formatLabel(l, "local") === displayName,
		);
		if (!existingLabel) {
			throw new Error(`Label "${displayName}" not found`);
		}

		const updated: Label = {
			name: params.new_name ?? existingLabel.name,
			scope: params.new_scope ?? existingLabel.scope,
			color: params.color ?? existingLabel.color,
			description:
				params.description !== undefined
					? params.description
					: existingLabel.description,
			exclusive:
				params.exclusive !== undefined
					? params.exclusive
					: existingLabel.exclusive,
		};

		const idx = labels.indexOf(existingLabel);
		labels[idx] = updated;
		const table = labelsTable(labels);
		writeFileSync(labelsPath, `# Labels\n\n${table}`, "utf8");

		return updated;
	},

	async deleteLabel(params, config) {
		const p = config.issuesPath ?? join(process.cwd(), "docs", "issues");
		const labelsPath = join(p, "labels.md");
		if (!existsSync(labelsPath)) return;

		const displayName = formatLabel(
			{ name: params.name, scope: params.scope },
			"local",
		);

		const content = readFileSync(labelsPath, "utf8");
		const labels = parseLabelsTable(content);

		const filtered = labels.filter(
			(l) => formatLabel(l, "local") !== displayName,
		);

		if (filtered.length === labels.length) return;

		const table = labelsTable(filtered);
		if (filtered.length === 0) {
			unlinkSync(labelsPath);
		} else {
			writeFileSync(labelsPath, `# Labels\n\n${table}`, "utf8");
		}
	},
};

// ─── Registration ───────────────────────────────────────────────

export const localRegistration: BackendRegistration = {
	type: "local",
	backend: localBackend,
	detect: () => false, // never auto-detected — fallback only
	resolveToken(auth: AuthConfig, _config: BackendConfig): TokenInfo | null {
		if (auth.local?.username) {
			return { username: auth.local.username };
		}
		return null;
	},
};
