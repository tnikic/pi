/**
 * GitHub Issues Backend
 *
 * @see {@link https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json | GitHub REST API OpenAPI description}
 * @see {@link https://docs.github.com/en/rest/issues | GitHub Issues REST API docs}
 *
 * ## OpenAPI spec usage
 * The bundled spec is ~12 MB — do NOT read the whole file into context.
 * Extract only what you need with jq, e.g.:
 *   curl -s <url> | jq '.paths | to_entries | map(select(.key | test("issues|labels")))'
 *
 * Endpoints referenced from the spec:
 *   GET    /repos/{owner}/{repo}/issues
 *   POST   /repos/{owner}/{repo}/issues
 *   GET    /repos/{owner}/{repo}/issues/{issue_number}
 *   PATCH  /repos/{owner}/{repo}/issues/{issue_number}
 *   GET    /repos/{owner}/{repo}/issues/{issue_number}/comments
 *   POST   /repos/{owner}/{repo}/issues/{issue_number}/comments
 *   GET    /repos/{owner}/{repo}/labels
 *   POST   /repos/{owner}/{repo}/labels
 *   PATCH  /repos/{owner}/{repo}/labels/{name}
 *   DELETE /repos/{owner}/{repo}/labels/{name}
 *
 * ## Key notes from the spec
 * - GitHub returns pull requests in the issues list; we filter them out via the
 *   `pull_request` key.
 * - `assignee` (singular) is deprecated — we use `assignees` array exclusively.
 * - `state_reason` ("completed"|"not_planned"|"duplicate"|"reopened") is available
 *   on issue update when changing state.
 * - `parent_issue_url` in the response links sub-issues to their parent.
 * - Labels on update replace the entire set; add/remove modes are handled
 *   client-side in resolveLabelsForUpdate.
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
	ListIssuesParams,
	TokenInfo,
} from "../types.ts";
import {
	fetchAllPages,
	fetchIssueComments,
	resolveAuthenticatedUsername,
	resolveLabelsForUpdate,
	toIssueFromApi,
} from "./shared.ts";

type FetchFn = typeof fetch;

/** Default headers for GitHub API requests. */
function headers(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"Content-Type": "application/json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

/** Build query string for listIssues. */
function buildListQuery(params: ListIssuesParams, username?: string): string {
	const qs = new URLSearchParams();
	if (params.state) qs.set("state", params.state);
	if (params.labels && params.labels.length > 0) {
		qs.set(
			"labels",
			params.labels.map((l) => formatLabel(l, "github")).join(","),
		);
	}
	if (params.assignee) {
		if (params.assignee === "@me" && username) {
			qs.set("assignee", username);
		} else if (params.assignee === "@unassigned") {
			qs.set("assignee", "none");
		} else if (params.assignee !== "@me") {
			qs.set("assignee", params.assignee);
		}
		// @me without username: no filter (will return all issues, client can't filter by self)
	}
	qs.set("per_page", "100");
	return qs.toString();
}

/** Link a child issue as a sub-issue of a parent using GraphQL.
 *  Falls back gracefully — `parent_issue_url` will still be returned on read. */
async function linkSubIssue(
	fetchFn: FetchFn,
	config: BackendConfig,
	token: string,
	parentNumber: number,
	childNumber: number,
	childRaw: Record<string, unknown>,
): Promise<void> {
	const childNodeId = childRaw.node_id as string | undefined;
	if (!childNodeId) return;

	try {
		// Get parent's node_id
		const parentUrl = `${config.instanceUrl}/repos/${config.owner}/${config.repo}/issues/${parentNumber}`;
		const parentRes = await fetchFn(parentUrl, { headers: headers(token) });
		if (!parentRes.ok) return;
		const parentData = (await parentRes.json()) as Record<string, unknown>;
		const parentNodeId = parentData.node_id as string | undefined;
		if (!parentNodeId) return;

		// Use GraphQL addSubIssue mutation (REST POST /sub_issues is broken)
		const gqlRes = await fetchFn("https://api.github.com/graphql", {
			method: "POST",
			headers: {
				...headers(token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: `mutation { addSubIssue(input: { issueId: "${parentNodeId}", subIssueId: "${childNodeId}" }) { clientMutationId } }`,
			}),
		});
		if (!gqlRes.ok) {
			console.warn(
				`Failed to link sub-issue #${childNumber} to parent #${parentNumber}: GraphQL ${gqlRes.status}`,
			);
		}
	} catch (err) {
		console.warn(
			`Failed to link sub-issue #${childNumber} to parent #${parentNumber}: ${(err as Error).message}`,
		);
	}
}

/** Create a GitHub backend with the given fetch function (for testing). */
export function createGitHubBackend(fetchFn: FetchFn = fetch): Backend {
	async function requireToken(token?: TokenInfo): Promise<string> {
		if (!token?.token) throw new Error("GitHub token is required");
		return token.token;
	}

	async function apiUrl(path: string, config: BackendConfig): Promise<string> {
		return `${config.instanceUrl}/repos/${config.owner}/${config.repo}${path}`;
	}

	return {
		async createIssue(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl("/issues", config);
			const body: Record<string, unknown> = { title: params.title };
			if (params.body) body.body = params.body;
			if (params.labels) {
				body.labels = params.labels.map((l) => formatLabel(l, "github"));
			}
			if (params.assignee && params.assignee !== "@me") {
				body.assignees = [params.assignee];
			}

			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(
					`GitHub API error creating issue: ${res.status} ${res.statusText}`,
				);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const issue = toIssueFromApi(raw, "github");

			// Handle parent (sub-issue) — use GraphQL addSubIssue mutation
			if (params.parent) {
				issue.parent = params.parent;
				await linkSubIssue(
					fetchFn,
					config,
					t,
					params.parent,
					issue.number,
					raw,
				);
			}

			return issue;
		},

		async listIssues(params, config, token) {
			const t = await requireToken(token);

			const username =
				params.assignee === "@me"
					? await resolveAuthenticatedUsername(
							fetchFn,
							"https://api.github.com/user",
							headers(t),
							"login",
						)
					: undefined;

			const qs = buildListQuery(params, username);
			const url = `${await apiUrl("/issues", config)}?${qs}`;
			const rawIssues = await fetchAllPages(fetchFn, url, headers(t));

			let issues = rawIssues
				.map((r) => {
					const issue = toIssueFromApi(r as Record<string, unknown>, "github");
					// Filter out PRs (GitHub API returns PRs in issue list).
					return (r as Record<string, unknown>).pull_request ? null : issue;
				})
				.filter((i) => i !== null);

			// Filter by parent (client-side, after body extraction)
			if (params.parent !== undefined) {
				issues = issues.filter((i) => i.parent === params.parent);
			}

			// Filter unblocked (no open blockers)
			if (params.unblocked) {
				const withBlockers = await Promise.all(
					issues.map(async (issue) => {
						const depUrl = `${config.instanceUrl}/repos/${config.owner}/${config.repo}/issues/${issue.number}`;
						const res = await fetchFn(depUrl, { headers: headers(t) });
						const data = await res.json();
						const blocked = (data as Record<string, unknown>).blocked as
							| boolean
							| undefined;
						return { issue, blocked: blocked ?? false };
					}),
				);
				issues = withBlockers.filter((w) => !w.blocked).map((w) => w.issue);
			}

			if (params.limit && params.limit > 0) {
				issues = issues.slice(0, params.limit);
			}

			// Strip body for list view
			return issues.map((i) => ({ ...i, body: "" }));
		},

		async getIssue(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl(`/issues/${params.issue_number}`, config);
			const res = await fetchFn(url, { headers: headers(t) });
			if (!res.ok) {
				throw new Error(`GitHub API error getting issue: ${res.status}`);
			}
			const issue = toIssueFromApi(await res.json(), "github");

			if (params.include_comments) {
				const commentsUrl = await apiUrl(
					`/issues/${params.issue_number}/comments`,
					config,
				);
				issue.comments = await fetchIssueComments(
					fetchFn,
					commentsUrl,
					headers(t),
					"user",
					"login",
				);
			}

			return issue;
		},

		async updateIssue(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl(`/issues/${params.issue_number}`, config);
			const body: Record<string, unknown> = {};

			if (params.title !== undefined) body.title = params.title;
			if (params.body !== undefined) body.body = params.body;
			if (params.state !== undefined) body.state = params.state;
			if (params.assignee !== undefined) {
				body.assignees = params.assignee ? [params.assignee] : [];
			}
			if (params.labels) {
				body.labels = await resolveLabelsForUpdate(
					fetchFn,
					url,
					headers(t),
					{ labels: params.labels, label_mode: params.label_mode },
					"github",
				);
			}

			const res = await fetchFn(url, {
				method: "PATCH",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitHub API error updating issue: ${res.status}`);
			}

			const updatedIssue = toIssueFromApi(await res.json(), "github");

			// blocked_by: GitHub's dependency API requires node IDs, not issue numbers,
			// and isn't exposed via the standard Issues REST API in a writable form.
			// We keep blocked_by as a read-only hint from the response.

			return updatedIssue;
		},

		async commentIssue(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl(
				`/issues/${params.issue_number}/comments`,
				config,
			);
			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify({ body: params.body }),
			});
			if (!res.ok) {
				throw new Error(`GitHub API error commenting: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			return {
				id: String(raw.id),
				author: (raw.user as { login?: string })?.login ?? "unknown",
				body: raw.body as string,
				created_at: raw.created_at as string,
			};
		},

		async listLabels(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl("/labels", config);
			const rawLabels = await fetchAllPages(fetchFn, url, headers(t));

			let labels = (rawLabels as Array<Record<string, unknown>>).map((l) => {
				const parsed = parseLabel(l.name as string, "github");
				return {
					...parsed,
					color: fromApiColor(l.color as string, "github"),
					description: (l.description as string) || undefined,
				};
			});

			if (params.scope) {
				labels = labels.filter((l) => l.scope === params.scope);
			}

			return labels;
		},

		async createLabel(params, config, token) {
			const t = await requireToken(token);
			const url = await apiUrl("/labels", config);
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"github",
			);
			const body: Record<string, unknown> = {
				name: displayName,
				color: toApiColor(params.color ?? "000000", "github"),
			};
			if (params.description) body.description = params.description;

			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitHub API error creating label: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const parsed = parseLabel(raw.name as string, "github");
			return {
				...parsed,
				color: fromApiColor(raw.color as string, "github"),
				description: (raw.description as string) || undefined,
			};
		},

		async updateLabel(params, config, token) {
			const t = await requireToken(token);
			const oldName = formatLabel(
				{ name: params.name, scope: params.scope },
				"github",
			);
			const newName =
				params.new_name || params.new_scope
					? formatLabel(
							{
								name: params.new_name ?? params.name,
								scope: params.new_scope ?? params.scope,
							},
							"github",
						)
					: undefined;

			const url = await apiUrl(
				`/labels/${encodeURIComponent(oldName)}`,
				config,
			);
			const body: Record<string, unknown> = {};
			if (newName && newName !== oldName) body.name = newName;
			if (params.color) body.color = toApiColor(params.color, "github");
			if (params.description !== undefined)
				body.description = params.description;

			const res = await fetchFn(url, {
				method: "PATCH",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`GitHub API error updating label: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const parsed = parseLabel(raw.name as string, "github");
			return {
				...parsed,
				color: fromApiColor(raw.color as string, "github"),
				description: (raw.description as string) || undefined,
			};
		},

		async deleteLabel(params, config, token) {
			const t = await requireToken(token);
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"github",
			);
			const url = await apiUrl(
				`/labels/${encodeURIComponent(displayName)}`,
				config,
			);
			const res = await fetchFn(url, {
				method: "DELETE",
				headers: headers(t),
			});
			if (!res.ok && res.status !== 404) {
				throw new Error(`GitHub API error deleting label: ${res.status}`);
			}
		},
	};
}

/** Default GitHub backend (uses global fetch). */
export const githubBackend: Backend = createGitHubBackend(fetch);

/** Known GitHub hostnames. */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export const githubRegistration: BackendRegistration = {
	type: "github",
	backend: githubBackend,
	detect: (host: string) => GITHUB_HOSTS.has(host),
	resolveToken(auth: AuthConfig, config: BackendConfig): TokenInfo | null {
		if (auth.github?.token) {
			return { token: auth.github.token, instanceUrl: config.instanceUrl };
		}
		return null;
	},
};
