/**
 * GitLab smoke test — runs against a real GitLab instance in Podman.
 *
 * Prerequisites:
 *   podman run -d --name pi-gitlab-smoke --rm \
 *     -p 9980:80 \
 *     -e GITLAB_OMNIBUS_CONFIG="external_url 'http://localhost:9980'" \
 *     gitlab/gitlab-ce:latest
 *
 * Wait for GitLab to be ready (can take 3-5 min on first start):
 *   podman exec pi-gitlab-smoke grep 'Password:' /etc/gitlab/initial_root_password
 *
 * Then create a token at http://localhost:9980/-/user_settings/personal_access_tokens
 * (user: root, password: from above)
 *
 * Run this test with:
 *   GITLAB_URL=http://localhost:9980 GITLAB_TOKEN=<token> \
 *     npx tsx --test agent/extensions/issue-tracker/smoke/gitlab-smoke.test.ts
 *
 * Or use the setup script to automate all of the above:
 *   agent/extensions/issue-tracker/smoke/setup-gitlab.sh --run
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { createGitLabBackend } from "../backends/gitlab.ts";
import type { BackendConfig, TokenInfo } from "../types.ts";

const GITLAB_URL = process.env.GITLAB_URL ?? "http://localhost:9980";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const REPO_OWNER = process.env.GITLAB_OWNER ?? "root";
const REPO_NAME = process.env.GITLAB_REPO ?? "smoke-test";

const config: BackendConfig = {
	type: "gitlab",
	owner: REPO_OWNER,
	repo: REPO_NAME,
	instanceUrl: GITLAB_URL,
};

const token: TokenInfo = {
	token: GITLAB_TOKEN ?? "",
	instanceUrl: GITLAB_URL,
};

const createdIssueNumbers: number[] = [];
const createdLabelNames: string[] = [];
let gitlabVersion = "";

// ─── helpers ────────────────────────────────────────────────────

/** Direct API call helper for operations the backend doesn't expose. */
async function api(path: string, options: RequestInit = {}): Promise<Response> {
	const url = `${GITLAB_URL}/api/v4/${path}`;
	return fetch(url, {
		...options,
		headers: {
			"PRIVATE-TOKEN": GITLAB_TOKEN ?? "",
			"Content-Type": "application/json",
			...((options.headers as Record<string, string>) ?? {}),
		},
	});
}

/** Create a project via the API. */
async function ensureProject(): Promise<void> {
	try {
		const res = await api(
			`projects/${encodeURIComponent(`${REPO_OWNER}/${REPO_NAME}`)}`,
		);
		if (res.ok) return;
	} catch {
		// not found, create
	}
	await api("projects", {
		method: "POST",
		body: JSON.stringify({
			name: REPO_NAME,
			visibility: "private",
		}),
	});
}

// ─── test suite ─────────────────────────────────────────────────

describe("GitLab smoke test", () => {
	before(async () => {
		if (!GITLAB_TOKEN) {
			console.warn("SKIP: Set GITLAB_TOKEN and GITLAB_URL to run smoke tests");
			return;
		}
		try {
			const res = await fetch(`${GITLAB_URL}/api/v4/version`);
			if (!res.ok) throw new Error(`GitLab not reachable: ${res.status}`);
			const versionData = (await res.json()) as {
				version?: string;
			};
			gitlabVersion = versionData.version ?? "unknown";
			console.warn(`GitLab version: ${gitlabVersion}`);
			await ensureProject();
		} catch (err) {
			console.warn(
				`SKIP: GitLab not reachable at ${GITLAB_URL}: ${(err as Error).message}`,
			);
		}
	});

	after(async () => {
		if (!GITLAB_TOKEN) return;
		// Close all created issues
		for (const num of createdIssueNumbers) {
			try {
				await api(
					`projects/${encodeURIComponent(`${REPO_OWNER}/${REPO_NAME}`)}/issues/${num}`,
					{
						method: "PUT",
						body: JSON.stringify({ state_event: "close" }),
					},
				);
			} catch {
				// ignore cleanup errors
			}
		}
		// Delete all created labels (reverse order)
		for (const name of [...createdLabelNames].reverse()) {
			try {
				await api(
					`projects/${encodeURIComponent(`${REPO_OWNER}/${REPO_NAME}`)}/labels/${encodeURIComponent(name)}`,
					{ method: "DELETE" },
				);
			} catch {
				// ignore
			}
		}
	});

	const backend = createGitLabBackend(fetch);

	// ── Label CRUD ───────────────────────────────────────────────

	describe("labels", () => {
		it("creates a simple label", { skip: !GITLAB_TOKEN }, async () => {
			const label = await backend.createLabel(
				{
					name: "smoke-test",
					color: "#ff8800",
					description: "Smoke test label",
				},
				config,
				token,
			);
			assert.strictEqual(label.name, "smoke-test");
			assert.strictEqual(label.color, "#ff8800");
			assert.strictEqual(label.description, "Smoke test label");
			assert.strictEqual(label.scope, undefined);
			createdLabelNames.push("smoke-test");
		});

		it("creates a scoped label (GitLab double-colon separator)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "high", scope: "priority", color: "#ff0000" },
				config,
				token,
			);
			assert.strictEqual(label.name, "high");
			assert.strictEqual(label.scope, "priority");
			assert.strictEqual(label.color, "#ff0000");
			createdLabelNames.push("priority::high");
		});

		it("creates a second scoped label in the same scope", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "low", scope: "priority", color: "#00ff00" },
				config,
				token,
			);
			assert.strictEqual(label.name, "low");
			assert.strictEqual(label.scope, "priority");
			createdLabelNames.push("priority::low");
		});

		it("creates a label in a different scope", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const label = await backend.createLabel(
				{
					name: "bug",
					scope: "kind",
					color: "#d73a4a",
					description: "Something isn't working",
				},
				config,
				token,
			);
			assert.strictEqual(label.name, "bug");
			assert.strictEqual(label.scope, "kind");
			assert.strictEqual(label.color, "#d73a4a");
			assert.strictEqual(label.description, "Something isn't working");
			createdLabelNames.push("kind::bug");
		});

		it("lists all labels", { skip: !GITLAB_TOKEN }, async () => {
			const labels = await backend.listLabels({}, config, token);
			assert.ok(
				labels.length >= 4,
				`Expected >=4 labels, got ${labels.length}`,
			);
			assert.ok(labels.some((l) => l.name === "smoke-test"));
			assert.ok(
				labels.some((l) => l.name === "high" && l.scope === "priority"),
			);
		});

		it("filters labels by scope", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const labels = await backend.listLabels(
				{ scope: "priority" },
				config,
				token,
			);
			assert.strictEqual(labels.length, 2);
			assert.ok(labels.every((l) => l.scope === "priority"));
			const names = labels.map((l) => l.name).sort();
			assert.deepStrictEqual(names, ["high", "low"]);
		});

		it("filters labels by non-existent scope returns empty", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const labels = await backend.listLabels(
				{ scope: "nonexistent" },
				config,
				token,
			);
			assert.strictEqual(labels.length, 0);
		});

		it("updates a label color", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const updated = await backend.updateLabel(
				{ name: "smoke-test", color: "#00ff00" },
				config,
				token,
			);
			assert.strictEqual(updated.color, "#00ff00");
			assert.strictEqual(updated.name, "smoke-test");
			// Verify persisted
			const labels = await backend.listLabels({}, config, token);
			const found = labels.find((l) => l.name === "smoke-test");
			assert.strictEqual(found?.color, "#00ff00");
		});

		it("renames a label", { skip: !GITLAB_TOKEN }, async () => {
			const updated = await backend.updateLabel(
				{ name: "smoke-test", new_name: "smoke-renamed" },
				config,
				token,
			);
			assert.strictEqual(updated.name, "smoke-renamed");
			// Update tracking
			const idx = createdLabelNames.indexOf("smoke-test");
			if (idx !== -1) createdLabelNames[idx] = "smoke-renamed";
		});

		it("rescopes a label (new_scope without new_name)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const updated = await backend.updateLabel(
				{
					name: "smoke-renamed",
					new_scope: "kind",
				},
				config,
				token,
			);
			assert.strictEqual(updated.scope, "kind");
			assert.strictEqual(updated.name, "smoke-renamed");
			// Update tracking
			const idx = createdLabelNames.indexOf("smoke-renamed");
			if (idx !== -1) createdLabelNames[idx] = "kind::smoke-renamed";
		});

		it("updates a label description", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const updated = await backend.updateLabel(
				{
					name: "high",
					scope: "priority",
					description: "Critical priority",
				},
				config,
				token,
			);
			assert.strictEqual(updated.description, "Critical priority");
		});

		it("renames and rescopes a label simultaneously", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const updated = await backend.updateLabel(
				{
					name: "low",
					scope: "priority",
					new_name: "medium",
					new_scope: "severity",
				},
				config,
				token,
			);
			assert.strictEqual(updated.name, "medium");
			assert.strictEqual(updated.scope, "severity");
			// Update tracking
			const idx = createdLabelNames.indexOf("priority::low");
			if (idx !== -1) createdLabelNames[idx] = "severity::medium";
		});

		it("deletes a label", { skip: !GITLAB_TOKEN }, async () => {
			await backend.deleteLabel(
				{ name: "smoke-renamed", scope: "kind" },
				config,
				token,
			);
			const labels = await backend.listLabels({}, config, token);
			assert.ok(!labels.some((l) => l.name === "smoke-renamed"));
			const idx = createdLabelNames.indexOf("kind::smoke-renamed");
			if (idx !== -1) createdLabelNames.splice(idx, 1);
		});

		it("delete is idempotent (no error on missing label)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			await backend.deleteLabel(
				{ name: "nonexistent-label-12345" },
				config,
				token,
			);
		});
	});

	// ── Issue CRUD ───────────────────────────────────────────────

	describe("issues", () => {
		it("creates a basic issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issue = await backend.createIssue(
				{
					title: "Smoke test issue",
					body: "This issue was created by the automated smoke test.",
					labels: [{ name: "high", scope: "priority" }],
				},
				config,
				token,
			);
			assert.strictEqual(issue.title, "Smoke test issue");
			assert.strictEqual(issue.state, "open");
			assert.ok(issue.number > 0);
			assert.ok(
				issue.labels.some((l) => l.name === "high" && l.scope === "priority"),
			);
			assert.ok(issue.body.includes("automated smoke test"));
			assert.ok(issue.url.includes(String(issue.number)));
			assert.ok(issue.created_at);
			assert.ok(issue.updated_at);
			createdIssueNumbers.push(issue.number);
		});

		it("creates an issue with a body containing markdown", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const body = [
				"## Overview",
				"This is a **markdown** body.",
				"",
				"- Item 1",
				"- Item 2",
				"",
				"```ts",
				'console.log("code block");',
				"```",
			].join("\n");
			const issue = await backend.createIssue(
				{ title: "Markdown issue", body },
				config,
				token,
			);
			assert.strictEqual(issue.title, "Markdown issue");
			assert.ok(issue.body.includes("## Overview"));
			assert.ok(issue.body.includes("code block"));
			createdIssueNumbers.push(issue.number);
		});

		it("creates an issue with multiple labels", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issue = await backend.createIssue(
				{
					title: "Multi-label issue",
					labels: [
						{ name: "high", scope: "priority" },
						{ name: "bug", scope: "kind" },
					],
				},
				config,
				token,
			);
			assert.ok(issue.labels.some((l) => l.name === "high"));
			assert.ok(issue.labels.some((l) => l.name === "bug"));
			createdIssueNumbers.push(issue.number);
		});

		it("creates a sub-issue with a parent (body-based convention)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			assert.ok(parentNum);
			const issue = await backend.createIssue(
				{
					title: "Sub-issue of smoke test",
					body: "This is a child issue.",
					parent: parentNum,
				},
				config,
				token,
			);
			assert.strictEqual(issue.parent, parentNum);
			assert.ok(issue.body.includes(`#${parentNum}`));
			createdIssueNumbers.push(issue.number);
		});

		it("creates a second sub-issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			assert.ok(parentNum);
			const issue = await backend.createIssue(
				{
					title: "Second sub-issue",
					body: "Another child.",
					parent: parentNum,
				},
				config,
				token,
			);
			assert.strictEqual(issue.parent, parentNum);
			createdIssueNumbers.push(issue.number);
		});

		it("lists all open issues", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			// GitLab can be slow to index — retry a few times
			let issues: Awaited<ReturnType<typeof backend.listIssues>> = [];
			for (let i = 0; i < 10; i++) {
				issues = await backend.listIssues({ state: "open" }, config, token);
				if (issues.length >= 5) break;
				await new Promise((r) => setTimeout(r, 2000));
			}
			assert.ok(
				issues.length >= 5,
				`Expected >=5 issues, got ${issues.length}`,
			);
			for (const issue of issues) {
				assert.strictEqual(issue.body, "");
			}
		});

		it("lists issues filtered by a single label", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{
					state: "open",
					labels: [{ name: "high", scope: "priority" }],
				},
				config,
				token,
			);
			assert.ok(issues.length >= 2);
			assert.ok(
				issues.every((i) =>
					i.labels.some((l) => l.name === "high" && l.scope === "priority"),
				),
			);
		});

		it("lists issues filtered by multiple labels", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{
					state: "open",
					labels: [
						{ name: "high", scope: "priority" },
						{ name: "bug", scope: "kind" },
					],
				},
				config,
				token,
			);
			// GitLab ANDs multiple labels
			assert.ok(issues.length >= 1);
		});

		it("lists issues with limit", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{ state: "open", limit: 2 },
				config,
				token,
			);
			assert.ok(issues.length <= 2, `Expected <=2, got ${issues.length}`);
		});

		it("lists sub-issues filtered by parent", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			assert.ok(parentNum);
			const issues = await backend.listIssues(
				{ state: "open", parent: parentNum },
				config,
				token,
			);
			assert.strictEqual(
				issues.length,
				2,
				`Expected 2 sub-issues, got ${issues.length}`,
			);
			for (const i of issues) {
				assert.strictEqual(i.parent, parentNum);
			}
		});

		it("lists issues filtered by assignee (@me finds none, none assigned)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{ state: "open", assignee: "@me" },
				config,
				token,
			);
			assert.strictEqual(
				issues.length,
				0,
				`Expected 0 assigned-to-me issues, got ${issues.length}`,
			);
		});

		it("lists unassigned issues (@unassigned)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{ state: "open", assignee: "@unassigned" },
				config,
				token,
			);
			assert.ok(
				issues.length >= 5,
				`Expected >=5 unassigned issues, got ${issues.length}`,
			);
		});

		it("gets a single issue with body", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{ issue_number: num },
				config,
				token,
			);
			assert.strictEqual(issue.number, num);
			assert.ok(issue.body.length > 0);
			assert.strictEqual(issue.state, "open");
			assert.strictEqual(issue.comments, undefined);
		});

		it("gets a sub-issue with parent extracted from body", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			const subIssueNum = createdIssueNumbers[3];
			assert.ok(subIssueNum);
			const issue = await backend.getIssue(
				{ issue_number: subIssueNum },
				config,
				token,
			);
			assert.strictEqual(issue.parent, parentNum);
			assert.ok(issue.body.includes(`Sub-issue of #${parentNum}`));
		});

		it("gets an issue with comments (empty initially)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{
					issue_number: num,
					include_comments: true,
				},
				config,
				token,
			);
			assert.ok(Array.isArray(issue.comments));
		});

		it("updates an issue title", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					title: "Updated markdown issue",
				},
				config,
				token,
			);
			assert.strictEqual(updated.title, "Updated markdown issue");
			assert.ok(updated.body.includes("## Overview"));
		});

		it("updates an issue body", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					body: "Replaced body.",
				},
				config,
				token,
			);
			assert.strictEqual(updated.body, "Replaced body.");
		});

		it("adds labels to an issue (label_mode add)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[2];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					labels: [{ name: "medium", scope: "severity" }],
					label_mode: "add",
				},
				config,
				token,
			);
			assert.ok(
				updated.labels.some((l) => l.name === "high"),
				"should still have high",
			);
			assert.ok(
				updated.labels.some((l) => l.name === "bug"),
				"should still have bug",
			);
			assert.ok(
				updated.labels.some((l) => l.name === "medium"),
				"should have newly added medium",
			);
		});

		it("removes labels from an issue (label_mode remove)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[2];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					labels: [{ name: "high", scope: "priority" }],
					label_mode: "remove",
				},
				config,
				token,
			);
			assert.ok(
				!updated.labels.some((l) => l.name === "high"),
				"high should be removed",
			);
			assert.ok(
				updated.labels.some((l) => l.name === "bug"),
				"bug should remain",
			);
			assert.ok(
				updated.labels.some((l) => l.name === "medium"),
				"medium should remain",
			);
		});

		it("replaces labels on an issue (label_mode replace)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[2];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					labels: [{ name: "medium", scope: "severity" }],
					label_mode: "replace",
				},
				config,
				token,
			);
			assert.strictEqual(
				updated.labels.length,
				1,
				`Expected 1 label after replace, got ${updated.labels.length}: ${JSON.stringify(updated.labels)}`,
			);
			assert.strictEqual(updated.labels[0]?.name, "medium");
			assert.strictEqual(updated.labels[0]?.scope, "severity");
		});

		it("closes an issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, state: "closed" },
				config,
				token,
			);
			assert.strictEqual(updated.state, "closed");
		});

		it("reopens an issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, state: "open" },
				config,
				token,
			);
			assert.strictEqual(updated.state, "open");
		});

		it("lists closed issues only", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[1];
			await backend.updateIssue(
				{ issue_number: num, state: "closed" },
				config,
				token,
			);
			const closed = await backend.listIssues(
				{ state: "closed" },
				config,
				token,
			);
			assert.ok(closed.length >= 1);
			assert.ok(closed.some((i) => i.number === num));
			// Reopen for cleanup
			await backend.updateIssue(
				{ issue_number: num, state: "open" },
				config,
				token,
			);
		});

		it("lists all issues (state: all)", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const all = await backend.listIssues({ state: "all" }, config, token);
			assert.ok(all.length >= 5, `Expected >=5 issues, got ${all.length}`);
		});

		it("update preserves unchanged fields", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const before = await backend.getIssue(
				{ issue_number: num },
				config,
				token,
			);
			const updated = await backend.updateIssue(
				{
					issue_number: num,
					title: "Title only update",
				},
				config,
				token,
			);
			assert.strictEqual(updated.title, "Title only update");
			assert.strictEqual(updated.body, before.body);
			assert.strictEqual(updated.state, before.state);
		});
	});

	// ── Comments ─────────────────────────────────────────────────

	describe("comments", () => {
		it("adds a comment to an issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const comment = await backend.commentIssue(
				{
					issue_number: num,
					body: "First smoke test comment.",
				},
				config,
				token,
			);
			assert.strictEqual(comment.body, "First smoke test comment.");
			assert.ok(comment.id);
			assert.ok(comment.author);
			assert.ok(comment.created_at);
		});

		it("adds a second comment with markdown", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const comment = await backend.commentIssue(
				{
					issue_number: num,
					body: "Second comment with **markdown**.",
				},
				config,
				token,
			);
			assert.ok(comment.body.includes("**markdown**"));
		});

		it("retrieves issue comments via getIssue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{
					issue_number: num,
					include_comments: true,
				},
				config,
				token,
			);
			assert.ok(issue.comments);
			assert.ok(
				issue.comments?.length >= 2,
				`Expected >=2 comments, got ${issue.comments?.length}`,
			);
			assert.strictEqual(
				issue.comments?.[0]?.body,
				"First smoke test comment.",
			);
			assert.strictEqual(
				issue.comments?.[1]?.body,
				"Second comment with **markdown**.",
			);
		});

		it("getIssue without include_comments does not fetch comments", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{ issue_number: num },
				config,
				token,
			);
			assert.strictEqual(issue.comments, undefined);
		});

		it("filters out system notes from comments", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{
					issue_number: num,
					include_comments: true,
				},
				config,
				token,
			);
			assert.ok(issue.comments);
			// All comments should be user comments (non-system)
			assert.ok(issue.comments?.every((c) => c.body.length > 0));
		});
	});

	// ── Error handling ───────────────────────────────────────────

	describe("error handling", () => {
		it("getIssue throws for non-existent issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.getIssue({ issue_number: 999999 }, config, token);
			}, /GitLab API error/);
		});

		it("commentIssue throws for non-existent issue", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.commentIssue(
					{
						issue_number: 999999,
						body: "nope",
					},
					config,
					token,
				);
			}, /GitLab API error/);
		});

		it("updateLabel throws for non-existent label", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.updateLabel(
					{
						name: "no-such-label-xyz",
						color: "#000",
					},
					config,
					token,
				);
			}, /GitLab API error/);
		});

		it("backend throws without token", async () => {
			await assert.rejects(async () => {
				await backend.listIssues({ state: "open" }, config, { token: "" });
			}, /GitLab token is required/);
		});
	});

	// ── Final state verification ─────────────────────────────────

	describe("final state", () => {
		it("verifies all created issues exist and are open", {
			skip: !GITLAB_TOKEN,
		}, async () => {
			for (const num of createdIssueNumbers) {
				const issue = await backend.getIssue(
					{ issue_number: num },
					config,
					token,
				);
				assert.strictEqual(issue.state, "open");
				assert.ok(issue.title.length > 0);
			}
		});
	});
});
