/**
 * Forgejo / Gitea Issues Backend
 *
 * @see {@link https://code.forgejo.org/swagger.v1.json | Forgejo Swagger spec}
 * @see {@link https://forgejo.org/docs/latest/user/api-usage/ | Forgejo API docs}
 *
 * ## OpenAPI spec usage
 * The swagger.json is a Swagger 2.0 document (~800 KB). Filter with jq:
 *   curl -s <url> | jq '.paths | to_entries | map(select(.key | test("issues|labels")))'
 *
 * Endpoints referenced from the spec:
 *   GET    /repos/{owner}/{repo}/issues
 *   POST   /repos/{owner}/{repo}/issues
 *   GET    /repos/{owner}/{repo}/issues/{index}
 *   PATCH  /repos/{owner}/{repo}/issues/{index}
 *   GET    /repos/{owner}/{repo}/issues/{index}/comments
 *   POST   /repos/{owner}/{repo}/issues/{index}/comments
 *   PUT    /repos/{owner}/{repo}/issues/{index}/labels
 *   GET    /repos/{owner}/{repo}/labels
 *   POST   /repos/{owner}/{repo}/labels
 *   GET    /repos/{owner}/{repo}/labels/{id}
 *   PATCH  /repos/{owner}/{repo}/labels/{id}
 *   DELETE /repos/{owner}/{repo}/labels/{id}
 *
 * ## Key notes from the spec
 * - Base path: `/api/v1`.  Spec version: 17.0.0-dev (tracking Gitea ~1.22).
 * - Forgejo uses label **IDs** (integers) in `CreateIssueOption.labels`, not names.
 *   We resolve names → IDs via the labels list endpoint before creating.
 * - `assignee` (singular) is deprecated — we use `assignees` array exclusively.
 * - Labels on an issue are managed via separate endpoints
 *   (`PUT /issues/{index}/labels` replaces the set; POST/DELETE for single labels).
 * - Label update/delete endpoints use the label **ID** in the path, not the name.
 * - `CreateLabelOption` and `EditLabelOption` support `exclusive` (boolean) and
 *   `is_archived` (boolean).
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
	applyIssueFilters,
	buildSubIssueChildBody,
	buildSubIssueParentBody,
	extractParentFromBody,
	fetchAllPages,
	fetchIssueComments,
	resolveAuthenticatedUsername,
	resolveLabelsForUpdate,
	toIssueFromApi,
} from "./shared.ts";

type FetchFn = typeof fetch;

/** Default headers for Forgejo/Gitea API. */
function headers(token: string): Record<string, string> {
	return {
		Authorization: `token ${token}`,
		"Content-Type": "application/json",
	};
}

/** API base URL: {instance}/api/v1 */
function apiBase(config: BackendConfig): string {
	const base = config.instanceUrl.replace(/\/$/, "");
	return `${base}/api/v1`;
}

/** Build query string for listIssues. */
function buildListQuery(params: ListIssuesParams, username?: string): string {
	const qs = new URLSearchParams();
	if (params.state) qs.set("state", params.state);
	if (params.labels && params.labels.length > 0) {
		qs.set(
			"labels",
			params.labels.map((l) => formatLabel(l, "forgejo")).join(","),
		);
	}
	if (params.assignee) {
		if (params.assignee === "@unassigned") {
			// Forgejo v16 has no reliable server-side filter for unassigned
			// (assigned_by=none is gone, q=-assignee:* fails on fresh repos).
			// We fetch all and filter client-side in listIssues instead.
		} else if (params.assignee === "@me" && username) {
			qs.set("assigned_by", username);
		} else {
			qs.set("assigned_by", params.assignee);
		}
	}
	qs.set("limit", "100");
	return qs.toString();
}

/** Resolve label names to their numeric IDs by fetching the label list. */
async function resolveLabelIds(
	fetchFn: FetchFn,
	config: BackendConfig,
	token: string,
	names: string[],
): Promise<number[]> {
	if (names.length === 0) return [];
	const listUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels`;
	const res = await fetchFn(listUrl, { headers: headers(token) });
	if (!res.ok) return [];
	const allLabels = (await res.json()) as Array<{ id: number; name: string }>;
	const nameToId = new Map(allLabels.map((l) => [l.name, l.id]));
	return names
		.map((n) => nameToId.get(n))
		.filter((id): id is number => id !== undefined);
}

export function createForgejoBackend(fetchFn: FetchFn = fetch): Backend {
	async function requireToken(token?: TokenInfo): Promise<string> {
		if (!token?.token) throw new Error("Forgejo token is required");
		return token.token;
	}

	return {
		async createIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues`;
			const body: Record<string, unknown> = { title: params.title };
			if (params.body) body.body = params.body;
			if (params.labels && params.labels.length > 0) {
				const labelNames = params.labels.map((l) => formatLabel(l, "forgejo"));
				body.labels = await resolveLabelIds(fetchFn, config, t, labelNames);
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
				throw new Error(`Forgejo API error creating issue: ${res.status}`);
			}
			const issue = toIssueFromApi(await res.json(), "forgejo");

			// Handle parent (sub-issue fallback) — update parent body
			if (params.parent) {
				const parentUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.parent}`;
				const parentRes = await fetchFn(parentUrl, { headers: headers(t) });
				if (parentRes.ok) {
					const parentData = await parentRes.json();
					const parentBody = (parentData as Record<string, unknown>)
						.body as string;
					const newBody = buildSubIssueParentBody(
						parentBody,
						issue.number,
						params.title,
					);
					await fetchFn(parentUrl, {
						method: "PATCH",
						headers: headers(t),
						body: JSON.stringify({ body: newBody }),
					});
				}
				issue.parent = params.parent;
				issue.body = buildSubIssueChildBody(issue.body, params.parent);
				// Update child body
				const childUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${issue.number}`;
				await fetchFn(childUrl, {
					method: "PATCH",
					headers: headers(t),
					body: JSON.stringify({ body: issue.body }),
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
							"login",
						)
					: undefined;

			const qs = buildListQuery(params, username);
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues?${qs}`;
			const rawIssues = await fetchAllPages(fetchFn, url, headers(t));

			const issues = rawIssues.map((r) =>
				toIssueFromApi(r as Record<string, unknown>, "forgejo"),
			);

			return applyIssueFilters(issues, params);
		},

		async getIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.issue_number}`;
			const res = await fetchFn(url, { headers: headers(t) });
			if (!res.ok) {
				throw new Error(`Forgejo API error getting issue: ${res.status}`);
			}
			const issue = toIssueFromApi(await res.json(), "forgejo");

			// Extract parent from body text (sub-issue body convention)
			if (issue.body && !issue.parent) {
				issue.parent = extractParentFromBody(issue.body);
			}

			if (params.include_comments) {
				const commentsUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.issue_number}/comments`;
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
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.issue_number}`;
			const body: Record<string, unknown> = {};

			if (params.title !== undefined) body.title = params.title;
			if (params.body !== undefined) body.body = params.body;
			if (params.state !== undefined) body.state = params.state;
			if (params.assignee !== undefined) {
				body.assignees = params.assignee ? [params.assignee] : [];
			}

			// PATCH the issue fields (everything except labels)
			const res = await fetchFn(url, {
				method: "PATCH",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`Forgejo API error updating issue: ${res.status}`);
			}

			// Update labels via the dedicated labels endpoint (Forgejo v16+ requires this)
			if (params.labels) {
				const labelNames = await resolveLabelsForUpdate(
					fetchFn,
					url,
					headers(t),
					{ labels: params.labels, label_mode: params.label_mode },
					"forgejo",
				);
				const labelIds = await resolveLabelIds(fetchFn, config, t, labelNames);

				const labelsUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.issue_number}/labels`;
				const labelsRes = await fetchFn(labelsUrl, {
					method: "PUT",
					headers: headers(t),
					body: JSON.stringify({ labels: labelIds }),
				});
				if (!labelsRes.ok) {
					throw new Error(
						`Forgejo API error updating issue labels: ${labelsRes.status}`,
					);
				}
			}

			// Re-fetch the issue to get the final state after all updates
			const updatedRes = await fetchFn(url, { headers: headers(t) });
			const updatedIssue = toIssueFromApi(await updatedRes.json(), "forgejo");

			// Forgejo does not expose blocked_by as a writable field on the issue
			// endpoint. We read it back from the response (if present) for
			// consistency with the other backends.
			if (params.blocked_by !== undefined) {
				updatedIssue.blocked_by = params.blocked_by;
			}

			return updatedIssue;
		},

		async commentIssue(params, config, token) {
			const t = await requireToken(token);
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/issues/${params.issue_number}/comments`;
			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify({ body: params.body }),
			});
			if (!res.ok) {
				throw new Error(`Forgejo API error commenting: ${res.status}`);
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
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels`;
			const rawLabels = await fetchAllPages(fetchFn, url, headers(t));

			let labels = (rawLabels as Array<Record<string, unknown>>).map((l) => {
				const parsed = parseLabel(l.name as string, "forgejo");
				return {
					...parsed,
					color: fromApiColor(l.color as string, "forgejo"),
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
			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels`;
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"forgejo",
			);
			const body: Record<string, unknown> = {
				name: displayName,
				color: toApiColor(params.color ?? "#000000", "forgejo"),
			};
			if (params.description) body.description = params.description;
			if (params.exclusive !== undefined) body.exclusive = params.exclusive;

			const res = await fetchFn(url, {
				method: "POST",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`Forgejo API error creating label: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const parsed = parseLabel(raw.name as string, "forgejo");
			return {
				...parsed,
				color: fromApiColor(raw.color as string, "forgejo"),
				description: (raw.description as string) || undefined,
			};
		},

		async updateLabel(params, config, token) {
			const t = await requireToken(token);
			const oldName = formatLabel(
				{ name: params.name, scope: params.scope },
				"forgejo",
			);

			// Find label by name to get its ID
			const listUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels`;
			const allLabels = await fetchAllPages(fetchFn, listUrl, headers(t));
			const found = (allLabels as Array<Record<string, unknown>>).find(
				(l) => l.name === oldName,
			);
			if (!found) {
				throw new Error(`Label "${oldName}" not found`);
			}

			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels/${found.id}`;
			const body: Record<string, unknown> = {};
			if (params.new_name || params.new_scope) {
				body.name = formatLabel(
					{
						name: params.new_name ?? params.name,
						scope: params.new_scope ?? params.scope,
					},
					"forgejo",
				);
			}
			if (params.color) body.color = toApiColor(params.color, "forgejo");
			if (params.description !== undefined)
				body.description = params.description;
			if (params.exclusive !== undefined) body.exclusive = params.exclusive;

			const res = await fetchFn(url, {
				method: "PATCH",
				headers: headers(t),
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`Forgejo API error updating label: ${res.status}`);
			}
			const raw = (await res.json()) as Record<string, unknown>;
			const parsed = parseLabel(raw.name as string, "forgejo");
			return {
				...parsed,
				color: fromApiColor(raw.color as string, "forgejo"),
				description: (raw.description as string) || undefined,
			};
		},

		async deleteLabel(params, config, token) {
			const t = await requireToken(token);
			const displayName = formatLabel(
				{ name: params.name, scope: params.scope },
				"forgejo",
			);

			// Find label by name to get its ID
			const listUrl = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels`;
			const allLabels = await fetchAllPages(fetchFn, listUrl, headers(t));
			const found = (allLabels as Array<Record<string, unknown>>).find(
				(l) => l.name === displayName,
			);
			if (!found) return; // Already gone, no-op

			const url = `${apiBase(config)}/repos/${config.owner}/${config.repo}/labels/${found.id}`;
			const res = await fetchFn(url, {
				method: "DELETE",
				headers: headers(t),
			});
			if (!res.ok && res.status !== 404) {
				throw new Error(`Forgejo API error deleting label: ${res.status}`);
			}
		},
	};
}

export const forgejoBackend: Backend = createForgejoBackend(fetch);

export const forgejoRegistration: BackendRegistration = {
	type: "forgejo",
	backend: forgejoBackend,
	detect: () => true, // catch-all for any non-GitHub host
	resolveToken(auth: AuthConfig, config: BackendConfig): TokenInfo | null {
		const host = new URL(config.instanceUrl).host;
		const instance = auth.forgejo?.[host];
		if (instance?.token) {
			return { token: instance.token, instanceUrl: instance.instance_url };
		}
		return null;
	},
};
