/**
 * GitLab Issues Backend
 *
 * @see {@link https://docs.gitlab.com/api/issues/ | GitLab Issues API docs}
 * @see {@link https://docs.gitlab.com/api/labels/ | GitLab Labels API docs}
 * @see {@link https://docs.gitlab.com/api/notes/ | GitLab Notes API docs}
 *
 * ## OpenAPI spec usage
 * The GitLab OpenAPI spec (~2.4 MB) is at:
 *   https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/api/openapi/openapi_v2.yaml
 * Extract issue/label endpoints with jq:
 *   curl -s <url> | yq '.paths | to_entries | map(select(.key | test("issues|labels")))'
 *
 * ## Key API differences from Forgejo/GitHub
 * - Base path: `/api/v4`.  Uses project path (URL-encoded) in URLs.
 * - Auth: `PRIVATE-TOKEN` header or `Authorization: Bearer`.
 * - Issues use `iid` (project-scoped internal ID), not a global number.
 * - `state` values: `opened` / `closed` (not `open`).
 * - Labels are comma-separated strings (not arrays).  Scoped labels use `::`.
 * - Label colors are `#`-prefixed in the API (like Forgejo).
 * - Comments are "notes" at `/projects/:id/issues/:issue_iid/notes`.
 * - Update uses `PUT` (not `PATCH`).  Label add/remove via `add_labels` / `remove_labels`.
 * - Assignee uses `assignee_ids` (array of user IDs).  Usernames must be resolved to IDs.
 * - Pagination via Link headers (same pattern as Forgejo).
 */

import {
	formatLabel,
	fromApiColor,
	parseLabel,
	toApiColor,
} from "../labels.ts";
import type {
	AuthConfig,
	Backend,
	BackendConfig,
	BackendRegistration,
	Issue,
	Label,
	ListIssuesParams,
	TokenInfo,
} from "../types.ts";
import {
	applyIssueFilters,
	buildSubIssueChildBody,
	buildSubIssueParentBody,
	extractParentFromBody,
	fetchAllPages,
	fetchIssueComments,
	resolveAuthenticatedUsername,
} from "./shared.ts";

type FetchFn = typeof fetch;

/** Default headers for GitLab API requests. */
function headers(token: string): Record<string, string> {
	return {
		"PRIVATE-TOKEN": token,
		"Content-Type": "application/json",
	};
}

/** API base URL: {instance}/api/v4 */
function apiBase(config: BackendConfig): string {
	const base = config.instanceUrl.replace(/\/$/, "");
	return `${base}/api/v4`;
}

/** URL-encoded project path, e.g. "owner/repo" → "owner%2Frepo". */
function projectPath(config: BackendConfig): string {
	return encodeURIComponent(`${config.owner}/${config.repo}`);
}

// ─── Issue mapping (GitLab → canonical) ────────────────────────

function toIssueFromGitLab(raw: Record<string, unknown>): Issue {
	// GitLab labels are either string[] (default) or Array<{name: string}> (with_labels_details=true).
	// Handle both shapes.
	const rawLabels = (raw.labels as Array<string | { name: string }>) ?? [];
	const labels: Label[] = rawLabels.map((l) =>
		parseLabel(typeof l === "string" ? l : l.name, "gitlab"),
	);

	// GitLab returns assignees as an array of user objects, assignee is deprecated
	const assignees = raw.assignees as Array<{ username?: string }> | undefined;
	const assignee =
		assignees?.[0]?.username ??
		(raw.assignee as { username?: string } | null)?.username ??
		null;

	// GitLab state values: "opened" / "closed"
	const state: "open" | "closed" = raw.state === "closed" ? "closed" : "open";

	return {
		number: raw.iid as number,
		title: raw.title as string,
		body: (raw.description as string) ?? "",
		state,
		labels,
		assignee,
		parent: null, // Extracted later via body convention
		blocked_by: [], // GitLab issue links are separate; not mapped here
		created_at: raw.created_at as string,
		updated_at: raw.updated_at as string,
		url: (raw.web_url as string) ?? "",
	};
}

// ─── Label mapping (GitLab → canonical) ────────────────────────

function toLabelFromGitLab(raw: Record<string, unknown>): Label {
	const parsed = parseLabel(raw.name as string, "gitlab");
	return {
		...parsed,
		color: fromApiColor(raw.color as string, "gitlab"),
		description: (raw.description as string) || undefined,
	};
}

// ─── Query builder ──────────────────────────────────────────────

function buildListQuery(params: ListIssuesParams, username?: string): string {
	const qs = new URLSearchParams();
	if (params.state) {
		// GitLab uses "opened" not "open"
		qs.set("state", params.state === "open" ? "opened" : params.state);
	}
	if (params.labels && params.labels.length > 0) {
		qs.set(
			"labels",
			params.labels.map((l) => formatLabel(l, "gitlab")).join(","),
		);
	}
	if (params.assignee) {
		if (params.assignee === "@me" && username) {
			qs.set("assignee_username", username);
		} else if (params.assignee === "@unassigned") {
			qs.set("assignee_id", "None");
		} else if (params.assignee !== "@me") {
			qs.set("assignee_username", params.assignee);
		}
		// @me without username: no filter
	}
	qs.set("per_page", "100");
	return qs.toString();
}

// ─── Resolve username → user ID (needed for assignee_ids) ──────

async function resolveUserId(
	fetchFn: FetchFn,
	config: BackendConfig,
	token: string,
	username: string,
): Promise<number | null> {
	try {
		const url = `${apiBase(config)}/users?username=${encodeURIComponent(username)}`;
		const res = await fetchFn(url, { headers: headers(token) });
		if (!res.ok) return null;
		const users = (await res.json()) as Array<{ id: number }>;
		return users[0]?.id ?? null;
	} catch {
		return null;
	}
}

// ─── Issue links (blocked_by) ──────────────────────────────────

interface GitLabLink {
	id: number;
	link_type: string;
	target_issue_iid: number;
}

/** Fetch all issue links for an issue. */
async function fetchIssueLinks(
	fetchFn: FetchFn,
	config: BackendConfig,
	token: string,
	issueIid: number,
): Promise<GitLabLink[]> {
	const url = `${apiBase(config)}/projects/${projectPath(config)}/issues/${issueIid}/links`;
	const res = await fetchFn(url, { headers: headers(token) });
	if (!res.ok) return [];
	return (await res.json()) as GitLabLink[];
}

/**
 * Sync the blocked_by list for an issue using GitLab's issue links API.
 * Creates "is_blocked_by" links from this issue to each blocker.
 */
async function syncBlockedBy(
	fetchFn: FetchFn,
	config: BackendConfig,
	token: string,
	issueIid: number,
	desiredBlockers: number[],
): Promise<void> {
	const links = await fetchIssueLinks(fetchFn, config, token, issueIid);
	const desired = new Set(desiredBlockers);

	// Delete links that are no longer needed
	for (const link of links) {
		if (
			link.link_type === "is_blocked_by" &&
			!desired.has(link.target_issue_iid)
		) {
			const delUrl = `${apiBase(config)}/projects/${projectPath(config)}/issues/${issueIid}/links/${link.id}`;
			await fetchFn(delUrl, {
				method: "DELETE",
				headers: headers(token),
			});
		}
	}

	// Create new links for blockers not already present
	const existingBlockers = new Set(
		links
			.filter((l) => l.link_type === "is_blocked_by")
			.map((l) => l.target_issue_iid),
	);
	const projectPathEncoded = projectPath(config);
	for (const blocker of desiredBlockers) {
		if (!existingBlockers.has(blocker)) {
			const createUrl = `${apiBase(config)}/projects/${projectPathEncoded}/issues/${issueIid}/links`;
			await fetchFn(createUrl, {
				method: "POST",
				headers: headers(token),
				body: JSON.stringify({
					target_project_id: projectPathEncoded,
					target_issue_iid: blocker,
					link_type: "is_blocked_by",
				}),
			});
		}
	}
}

// ─── Backend factory ────────────────────────────────────────────

export function createGitLabBackend(fetchFn: FetchFn = fetch): Backend {
	async function requireToken(token?: TokenInfo): Promise<string> {
		if (!token?.token) throw new Error("GitLab token is required");
		return token.token;
	}

	return {
		async createIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/issues`;
			const body: Record<string, unknown> = { title: params.title };
			if (params.body) body.description = params.body;
			if (params.labels && params.labels.length > 0) {
				body.labels = params.labels
					.map((l) => formatLabel(l, "gitlab"))
					.join(",");
			}
			if (params.assignee && params.assignee !== "@me") {
				const uid = await resolveUserId(fetchFn, config, t, params.assignee);
				if (uid !== null) {
					body.assignee_ids = [uid];
				}
			}

			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitLab API error creating issue: ${res.status}`);
			}
			const issue = toIssueFromGitLab(
				(await res.json()) as Record<string, unknown>,
			);

			// Handle parent (sub-issue fallback) — update parent body
			if (params.parent) {
				const parentUrl = `${apiBase(config)}/projects/${projectPath(config)}/issues/${params.parent}`;
				const parentRes = await fetchFn(parentUrl, {
					headers: headers(t),
				});
				if (parentRes.ok) {
					const parentData = (await parentRes.json()) as Record<
						string,
						unknown
					>;
					const parentBody = (parentData.description as string) ?? "";
					const newBody = buildSubIssueParentBody(
						parentBody,
						issue.number,
						params.title,
					);
					await fetchFn(parentUrl, {
						method: "PUT",
						headers: headers(t),
						body: JSON.stringify({ description: newBody }),
					});
				}
				issue.parent = params.parent;
				issue.body = buildSubIssueChildBody(issue.body, params.parent);
				// Update child body
				const childUrl = `${apiBase(config)}/projects/${projectPath(config)}/issues/${issue.number}`;
				await fetchFn(childUrl, {
					method: "PUT",
					headers: headers(t),
					body: JSON.stringify({ description: issue.body }),
				});
			}

			return issue;
		},

		async listIssues(params, config, token) {
			const t = await requireToken(token);

			const username =
				params.assignee === "@me"
					? await resolveAuthenticatedUsername(
							fetchFn,
							`${apiBase(config)}/user`,
							headers(t),
							"username",
						)
					: undefined;

			const qs = buildListQuery(params, username);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/issues?${qs}`;
			const rawIssues = await fetchAllPages(fetchFn, url, headers(t));

			const issues = rawIssues.map((r) =>
				toIssueFromGitLab(r as Record<string, unknown>),
			);

			return applyIssueFilters(issues, params);
		},

		async getIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/issues/${params.issue_number}`;
			const res = await fetchFn(url, { headers: headers(t) });
			if (!res.ok) {
				throw new Error(`GitLab API error getting issue: ${res.status}`);
			}
			const issue = toIssueFromGitLab(
				(await res.json()) as Record<string, unknown>,
			);

			// Extract parent from body text (sub-issue body convention)
			if (issue.body && !issue.parent) {
				issue.parent = extractParentFromBody(issue.body);
			}

			// Fetch blocked_by from issue links
			try {
				const links = await fetchIssueLinks(
					fetchFn,
					config,
					t,
					params.issue_number,
				);
				issue.blocked_by = links
					.filter((l) => l.link_type === "is_blocked_by")
					.map((l) => l.target_issue_iid);
			} catch (err) {
				console.warn(
					`Failed to fetch issue links for #${params.issue_number}: ${(err as Error).message}`,
				);
			}

			if (params.include_comments) {
				const notesUrl = `${apiBase(config)}/projects/${projectPath(config)}/issues/${params.issue_number}/notes?sort=asc&order_by=created_at`;
				issue.comments = await fetchIssueComments(
					fetchFn,
					notesUrl,
					headers(t),
					"author",
					"username",
					true,
				);
			}

			return issue;
		},

		async updateIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/issues/${params.issue_number}`;
			const body: Record<string, unknown> = {};

			if (params.title !== undefined) body.title = params.title;
			if (params.body !== undefined) body.description = params.body;
			if (params.state !== undefined) {
				body.state_event = params.state === "closed" ? "close" : "reopen";
			}

			// Handle assignee changes
			if (params.assignee !== undefined) {
				if (params.assignee === null) {
					body.assignee_ids = [0]; // 0 = unassign all
				} else if (params.assignee) {
					const uid = await resolveUserId(fetchFn, config, t, params.assignee);
					if (uid !== null) {
						body.assignee_ids = [uid];
					}
				}
			}

			// Handle labels — GitLab uses add_labels/remove_labels or labels
			if (params.labels) {
				if (params.label_mode === "add" && params.labels.length > 0) {
					body.add_labels = params.labels
						.map((l) => formatLabel(l, "gitlab"))
						.join(",");
				} else if (params.label_mode === "remove" && params.labels.length > 0) {
					body.remove_labels = params.labels
						.map((l) => formatLabel(l, "gitlab"))
						.join(",");
				} else {
					// replace
					body.labels = params.labels
						.map((l) => formatLabel(l, "gitlab"))
						.join(",");
				}
			}

			const res = await fetchFn(url, {
				method: "PUT",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitLab API error updating issue: ${res.status}`);
			}

			const updatedIssue = toIssueFromGitLab(
				(await res.json()) as Record<string, unknown>,
			);

			if (params.blocked_by !== undefined) {
				await syncBlockedBy(
					fetchFn,
					config,
					t,
					params.issue_number,
					params.blocked_by,
				);
				updatedIssue.blocked_by = params.blocked_by;
			}

			return updatedIssue;
		},

		async commentIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/issues/${params.issue_number}/notes`;
			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify({ body: params.body }),
			});
			if (!res.ok) {
				throw new Error(`GitLab API error commenting: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			return {
				id: String(raw.id),
				author: (raw.author as { username?: string })?.username ?? "unknown",
				body: raw.body as string,
				created_at: raw.created_at as string,
			};
		},

		async listLabels(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/labels`;
			const rawLabels = await fetchAllPages(fetchFn, url, headers(t));

			let labels = (rawLabels as Array<Record<string, unknown>>).map(
				toLabelFromGitLab,
			);

			if (params.scope) {
				labels = labels.filter((l) => l.scope === params.scope);
			}

			return labels;
		},

		async createLabel(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/labels`;
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"gitlab",
			);
			const color = toApiColor(params.color ?? "#000000", "gitlab");
			const body: Record<string, unknown> = {
				name: displayName,
				color,
			};
			if (params.description) body.description = params.description;

			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitLab API error creating label: ${res.status}`);
			}
			return toLabelFromGitLab((await res.json()) as Record<string, unknown>);
		},

		async updateLabel(params, config, token) {
			const t = await requireToken(token);
			const oldName = formatLabel(
				{ name: params.name, scope: params.scope },
				"gitlab",
			);

			const url = `${apiBase(config)}/projects/${projectPath(config)}/labels/${encodeURIComponent(oldName)}`;
			const body: Record<string, unknown> = {};

			const newName =
				params.new_name || params.new_scope
					? formatLabel(
							{
								name: params.new_name ?? params.name,
								scope: params.new_scope ?? params.scope,
							},
							"gitlab",
						)
					: undefined;
			if (newName && newName !== oldName) body.new_name = newName;
			if (params.color) body.color = toApiColor(params.color, "gitlab");
			if (params.description !== undefined)
				body.description = params.description;

			const res = await fetchFn(url, {
				method: "PUT",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitLab API error updating label: ${res.status}`);
			}
			return toLabelFromGitLab((await res.json()) as Record<string, unknown>);
		},

		async deleteLabel(params, config, token) {
			const t = await requireToken(token);
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"gitlab",
			);
			const url = `${apiBase(config)}/projects/${projectPath(config)}/labels/${encodeURIComponent(displayName)}`;
			const res = await fetchFn(url, {
				method: "DELETE",
				headers: headers(t),
			});
			if (!res.ok && res.status !== 404) {
				throw new Error(`GitLab API error deleting label: ${res.status}`);
			}
		},
	};
}

/** Default GitLab backend (uses global fetch). */
export const gitlabBackend: Backend = createGitLabBackend(fetch);

/** Known GitLab hostnames. Self-hosted instances are detected via API probe. */
export const GITLAB_HOSTS = new Set(["gitlab.com", "www.gitlab.com"]);

export const gitlabRegistration: BackendRegistration = {
	type: "gitlab",
	backend: gitlabBackend,
	detect: (host: string) => GITLAB_HOSTS.has(host),
	resolveToken(auth: AuthConfig, config: BackendConfig): TokenInfo | null {
		const host = new URL(config.instanceUrl).host;
		const instance = auth.gitlab?.[host];
		if (instance?.token) {
			return {
				token: instance.token,
				instanceUrl: instance.instance_url,
			};
		}
		return null;
	},
};
