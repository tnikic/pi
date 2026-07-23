import type { Comment, Issue, Label } from "../types.ts";

/** Extract YAML front-matter and body from a markdown file. */
export function parseFrontMatter(content: string): {
	meta: Record<string, unknown>;
	body: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return { meta: {}, body: content };
	}
	const [, yaml = "", body = ""] = match;
	const meta: Record<string, unknown> = {};
	for (const line of yaml.split("\n")) {
		const kv = line.match(/^(\w[\w_]*):\s*(.*?)\s*$/);
		if (kv) {
			const [, key = "", value = ""] = kv;
			meta[key] = value;
		}
	}
	return { meta, body };
}

/** Parse a YAML list of labels from the front-matter text. */
export function parseLabelsYaml(yaml: string): Label[] {
	const labels: Label[] = [];
	const lines = yaml.split("\n");
	let current: { name: string; scope?: string } | null = null;
	for (const line of lines) {
		const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
		const scopeMatch = line.match(/^\s*scope:\s*(.+)$/);
		if (nameMatch) {
			const name = nameMatch[1];
			if (!name) continue;
			if (current) labels.push(current);
			current = { name };
		} else if (scopeMatch && current) {
			const scope = scopeMatch[1];
			if (scope) current.scope = scope;
		}
	}
	if (current) labels.push(current);
	return labels;
}

/** Parse a comma-separated or YAML list of integers. */
export function parseBlockedBy(value: unknown): number[] {
	if (Array.isArray(value))
		return value.map(Number).filter((n) => !Number.isNaN(n));
	if (typeof value === "string") {
		const cleaned = value.replace(/^\[|\]$/g, "");
		if (cleaned.trim() === "") return [];
		return cleaned
			.split(",")
			.map((s) => Number(s.trim()))
			.filter((n) => !Number.isNaN(n));
	}
	return [];
}

/** Format labels as YAML for front-matter. */
export function labelsToYaml(labels: Label[]): string {
	if (labels.length === 0) return "[]";
	return labels
		.map((l) => {
			if (l.scope) return `  - name: ${l.name}\n    scope: ${l.scope}`;
			return `  - name: ${l.name}`;
		})
		.join("\n");
}

/** Format a number array as a compact JSON array for YAML. */
export function numbersToBlockedBy(nums: number[]): string {
	if (nums.length === 0) return "[]";
	return `[${nums.join(", ")}]`;
}

/** Format metadata as YAML front-matter. */
export function toFrontMatter(issue: {
	title: string;
	number: number;
	state: string;
	labels: Label[];
	assignee: string | null;
	parent: number | null;
	blocked_by: number[];
	created_at: string;
	updated_at: string;
}): string {
	const l = labelsToYaml(issue.labels);
	const labelsBlock = l === "[]" ? "labels: []" : `labels:\n${l}`;
	return `---
title: ${issue.title}
number: ${issue.number}
state: ${issue.state}
${labelsBlock}
assignee: ${issue.assignee ?? "null"}
parent: ${issue.parent ?? "null"}
blocked_by: ${numbersToBlockedBy(issue.blocked_by)}
created_at: "${issue.created_at}"
updated_at: "${issue.updated_at}"
---`;
}

/** Extract the raw YAML text for labels from front-matter. */
export function extractLabelsYaml(content: string): string {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return "";
	const [, yaml = ""] = match;
	const labelStart = yaml.indexOf("labels:");
	if (labelStart === -1) return "";
	const afterLabels = yaml.slice(labelStart + 7);
	const nextKey = afterLabels.search(/\n(?=\w)/);
	return nextKey === -1 ? afterLabels : afterLabels.slice(0, nextKey);
}

/** Parse comments from the body section. */
export function parseComments(body: string): {
	bodyText: string;
	comments: Comment[];
} {
	const commentsHeader = body.indexOf("\n## Comments\n");
	if (commentsHeader === -1) {
		if (body.startsWith("## Comments")) {
			return { bodyText: "", comments: extractComments(body) };
		}
		return { bodyText: body, comments: [] };
	}

	const bodyText = body.slice(0, commentsHeader);
	const commentsSection = body.slice(commentsHeader + 1);
	const comments = extractComments(commentsSection);
	return { bodyText: bodyText.trim(), comments };
}

function extractComments(section: string): Comment[] {
	const comments: Comment[] = [];
	const regex = /### Comment by (.+?) on (.+?)\n\n([\s\S]*?)\n---/g;
	let counter = 0;
	for (
		let match = regex.exec(section);
		match !== null;
		match = regex.exec(section)
	) {
		counter++;
		comments.push({
			id: `c${counter}`,
			author: match[1]?.trim(),
			created_at: match[2]?.trim(),
			body: match[3]?.trim(),
		});
	}
	return comments;
}

/** Parse a markdown issue file into an Issue object. */
export function parseIssueFile(content: string, issuePath: string): Issue {
	const { meta, body } = parseFrontMatter(content);

	const labelsYaml = extractLabelsYaml(content);
	const labels = parseLabelsYaml(labelsYaml);

	const created = String(meta.created_at ?? new Date().toISOString());
	const updated = String(meta.updated_at ?? created);

	const { bodyText, comments } = parseComments(body);

	return {
		number: Number(meta.number) || 0,
		title: String(meta.title ?? ""),
		body: bodyText.trim(),
		state: meta.state === "closed" ? "closed" : "open",
		labels,
		assignee:
			meta.assignee === "null" || !meta.assignee ? null : String(meta.assignee),
		parent: meta.parent === "null" || !meta.parent ? null : Number(meta.parent),
		blocked_by: parseBlockedBy(meta.blocked_by),
		created_at: created,
		updated_at: updated,
		url: `file://${issuePath}`,
		comments,
	};
}

/** Generate a slug from a title. */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}

/** Check if a label matches a filter label (by scope and/or name). */
export function labelMatches(haystack: Label, needle: Label): boolean {
	if (needle.scope) {
		return haystack.scope === needle.scope;
	}
	return haystack.name === needle.name;
}
