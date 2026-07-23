import { formatLabel, fromApiColor, parseLabel } from "../labels.ts";
import type {
	BackendType,
	Comment,
	Issue,
	Label,
	ListIssuesParams,
} from "../types.ts";

// ─── Fetch helpers ──────────────────────────────────────────────

/** Fetch all pages of a paginated API response that uses Link headers. */
export async function fetchAllPages(
	fetchFn: typeof fetch,
	url: string,
	headers: Record<string, string>,
): Promise<unknown[]> {
	const results: unknown[] = [];
	let pageUrl: string | null = url;

	while (pageUrl) {
		const res = await fetchFn(pageUrl, { headers });
		if (!res.ok) {
			throw new Error(`API error: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as unknown[];
		if (Array.isArray(data)) results.push(...data);

		const link = res.headers.get("Link");
		pageUrl = null;
		if (link) {
			const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
			if (nextMatch?.[1]) pageUrl = nextMatch[1];
		}
	}

	return results;
}

// ─── Issue mapping ──────────────────────────────────────────────

/**
 * Extract parent issue number from `parent_issue_url` (GitHub-specific).
 * The URL looks like "https://api.github.com/repos/owner/repo/issues/123".
 */
function extractParentFromUrl(parentIssueUrl: string): number | null {
	const match = parentIssueUrl.match(/\/issues\/(\d+)$/);
	return match ? Number(match[1]) : null;
}

/** Convert a raw API issue object into the canonical Issue type. */
export function toIssueFromApi(
	raw: Record<string, unknown>,
	backendType: BackendType,
): Issue {
	const rawLabels =
		(raw.labels as Array<{ name?: string; color?: string }>) ?? [];
	const labels: Label[] = rawLabels.map((l) => {
		const parsed = parseLabel(l.name ?? "", backendType);
		return {
			...parsed,
			color: fromApiColor(l.color, backendType),
		};
	});

	// Extract parent from `parent_issue_url` if available (GitHub API).
	let parent: number | null = null;
	const parentUrl = raw.parent_issue_url as string | undefined;
	if (parentUrl) {
		parent = extractParentFromUrl(parentUrl);
	}

	return {
		number: raw.number as number,
		title: raw.title as string,
		body: raw.body as string,
		state: (raw.state === "closed" ? "closed" : "open") as "open" | "closed",
		labels,
		assignee: (raw.assignee as { login?: string } | null)?.login ?? null,
		parent,
		blocked_by: [],
		created_at: raw.created_at as string,
		updated_at: raw.updated_at as string,
		url: (raw.html_url as string) ?? "",
	};
}

// ─── Sub-issue body convention ─────────────────────────────────

/**
 * Extract parent issue number from the body convention used for sub-issues:
 * "> Sub-issue of #N" at the start of the body.
 */
export function extractParentFromBody(body: string): number | null {
	const match = body.match(/^> Sub-issue of #(\d+)/m);
	return match ? Number(match[1]) : null;
}

/** Build the child body for a sub-issue. */
export function buildSubIssueChildBody(
	body: string,
	parentNumber: number,
): string {
	return `> Sub-issue of #${parentNumber}\n\n${body}`;
}

/**
 * Build the updated parent body, appending a sub-issue entry to the
 * "## Sub-issues" section (creating it if needed).
 */
export function buildSubIssueParentBody(
	existingBody: string,
	childNumber: number,
	childTitle: string,
): string {
	const entry = `- [ ] #${childNumber} ${childTitle}\n`;
	if (existingBody.includes("## Sub-issues")) {
		return existingBody.replace(/(## Sub-issues\n)/, `$1${entry}`);
	}
	return `${existingBody}\n## Sub-issues\n${entry}`;
}

// ─── Client-side issue filtering ────────────────────────────────

/**
 * Apply client-side filters that backends can't express server-side:
 *   - Extract parent from body text
 *   - Filter unassigned (@unassigned)
 *   - Filter unblocked
 *   - Filter by parent
 *   - Limit results
 *   - Strip body text from list results
 */
export function applyIssueFilters(
	issues: Issue[],
	params: ListIssuesParams,
): Issue[] {
	// Extract parent from body text (sub-issue body convention)
	for (const issue of issues) {
		if (issue.body && !issue.parent) {
			issue.parent = extractParentFromBody(issue.body);
		}
	}

	// Client-side filter for unassigned
	if (params.assignee === "@unassigned") {
		issues = issues.filter((i) => i.assignee === null);
	}

	// Filter unblocked
	if (params.unblocked) {
		issues = issues.filter((i) => i.blocked_by.length === 0);
	}

	if (params.parent !== undefined) {
		issues = issues.filter((i) => i.parent === params.parent);
	}

	if (params.limit && params.limit > 0) {
		issues = issues.slice(0, params.limit);
	}

	return issues.map((i) => ({ ...i, body: "" }));
}

// ─── Username resolution ───────────────────────────────────────

/**
 * Resolve the authenticated username from the API's /user endpoint.
 * Used by listIssues to resolve @me to a real username for server-side filtering.
 * Logs a warning instead of throwing — when resolution fails the caller falls back
 * to fetching unfiltered results.
 */
export async function resolveAuthenticatedUsername(
	fetchFn: typeof fetch,
	userUrl: string,
	headers: Record<string, string>,
	field: "login" | "username",
): Promise<string | undefined> {
	try {
		const res = await fetchFn(userUrl, { headers });
		const data = (await res.json()) as Record<string, unknown>;
		return data[field] as string | undefined;
	} catch (err) {
		console.warn(
			`Failed to resolve @me username from ${userUrl}: ${(err as Error).message}`,
		);
		return undefined;
	}
}

// ─── Comment fetching ──────────────────────────────────────────

/**
 * Fetch comments for an issue from a paginated comments/notes endpoint.
 *
 * @param userField — the JSON key for the author object ("user" for GitHub/Forgejo, "author" for GitLab).
 * @param usernameField — the JSON key for the username inside the author object ("login" for GitHub/Forgejo, "username" for GitLab).
 * @param filterSystem — if true, skips entries where `.system` is truthy (GitLab system notes).
 */
export async function fetchIssueComments(
	fetchFn: typeof fetch,
	commentsUrl: string,
	headers: Record<string, string>,
	userField: "user" | "author",
	usernameField: "login" | "username",
	filterSystem?: boolean,
): Promise<Comment[]> {
	const res = await fetchFn(commentsUrl, { headers });
	if (!res.ok) return [];

	let items = (await res.json()) as Array<Record<string, unknown>>;

	if (filterSystem) {
		items = items.filter((n) => !n.system);
	}

	return items.map((c) => ({
		id: String(c.id),
		author:
			(c[userField] as { [key: string]: unknown } | undefined)?.[
				usernameField
			] ?? "unknown",
		body: c.body as string,
		created_at: c.created_at as string,
	}));
}

// ─── Label resolution ───────────────────────────────────────────

/** Resolve the final label list for updateIssue, handling add/remove/replace modes. */
export async function resolveLabelsForUpdate(
	fetchFn: typeof fetch,
	issueUrl: string,
	headers: Record<string, string>,
	params: {
		labels: Label[];
		label_mode?: "replace" | "add" | "remove";
	},
	backendType: BackendType,
): Promise<string[]> {
	if (!params.label_mode || params.label_mode === "replace") {
		return params.labels.map((l) => formatLabel(l, backendType));
	}

	const currentRes = await fetchFn(issueUrl, { headers });
	const current = await currentRes.json();
	const currentLabels = (current as Record<string, unknown>).labels as Array<{
		name: string;
	}>;
	const currentNames = new Set((currentLabels ?? []).map((l) => l.name));

	if (params.label_mode === "add") {
		const toAdd = params.labels
			.map((l) => formatLabel(l, backendType))
			.filter((n) => !currentNames.has(n));
		return [...currentNames, ...toAdd];
	}

	// remove
	const removeNames = new Set(
		params.labels.map((l) => formatLabel(l, backendType)),
	);
	return (currentLabels ?? [])
		.filter((l) => !removeNames.has(l.name))
		.map((l) => l.name);
}
