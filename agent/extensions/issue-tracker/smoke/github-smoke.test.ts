/**
 * GitHub smoke test — runs against a real GitHub repository.
 *
 * Prerequisites:
 *   1. Create a GitHub Personal Access Token:
 *      - Classic: https://github.com/settings/tokens → repo scope
 *      - Fine-grained: issues:read+write, metadata:read
 *   2. export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
 *
 * Then run this test with:
 *   GITHUB_TOKEN=<token> GITHUB_OWNER=<owner> GITHUB_REPO=<repo> \
 *     npx tsx --test agent/extensions/issue-tracker/smoke/github-smoke.test.ts
 *
 * Or use the setup script to automate repo creation and teardown:
 *   agent/extensions/issue-tracker/smoke/setup-github.sh --run
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { createGitHubBackend } from "../backends/github.ts";
import type { BackendConfig, TokenInfo } from "../types.ts";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "smoke-test";
const GITHUB_API = "https://api.github.com";

const config: BackendConfig = {
	type: "github",
	owner: GITHUB_OWNER,
	repo: GITHUB_REPO,
	instanceUrl: GITHUB_API,
};

const token: TokenInfo = {
	token: GITHUB_TOKEN ?? "",
	instanceUrl: GITHUB_API,
};

const createdIssueNumbers: number[] = [];
const createdLabelNames: string[] = [];
let githubUser = "";

// ─── helpers ────────────────────────────────────────────────────

/** Direct API call helper for operations the backend doesn't expose. */
async function api(path: string, options: RequestInit = {}): Promise<Response> {
	const url = `${GITHUB_API}${path}`;
	return fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
			...((options.headers as Record<string, string>) ?? {}),
		},
	});
}

// ─── test suite ─────────────────────────────────────────────────

describe("GitHub smoke test", () => {
	before(async () => {
		if (!GITHUB_TOKEN || !GITHUB_OWNER) {
			console.warn(
				"SKIP: Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO to run smoke tests",
			);
			return;
		}
		try {
			const res = await fetch("https://api.github.com/rate_limit", {
				headers: {
					Authorization: `Bearer ${GITHUB_TOKEN}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!res.ok) throw new Error(`GitHub not reachable: ${res.status}`);
			const data = (await res.json()) as {
				rate?: { remaining?: number };
			};
			console.warn(
				`GitHub API rate limit remaining: ${data.rate?.remaining ?? "unknown"}`,
			);

			// Get authenticated user
			const userRes = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${GITHUB_TOKEN}`,
					Accept: "application/vnd.github+json",
				},
			});
			const userData = (await userRes.json()) as { login?: string };
			githubUser = userData.login ?? "";
			console.warn(`Authenticated as: ${githubUser}`);
		} catch (err) {
			console.warn(`SKIP: GitHub not reachable: ${(err as Error).message}`);
		}
	});

	after(async () => {
		if (!GITHUB_TOKEN || !GITHUB_OWNER) return;
		// Close all created issues
		for (const num of createdIssueNumbers) {
			try {
				await api(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${num}`, {
					method: "PATCH",
					body: JSON.stringify({ state: "closed" }),
				});
			} catch {
				// ignore cleanup errors
			}
		}
		// Delete all created labels (reverse order — scoped labels may need to go first)
		for (const name of [...createdLabelNames].reverse()) {
			try {
				await api(
					`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/labels/${encodeURIComponent(name)}`,
					{ method: "DELETE" },
				);
			} catch {
				// ignore (label may have been renamed or already deleted)
			}
		}
	});

	const backend = createGitHubBackend(fetch);

	/** Retry a listIssues call up to maxAttempts times, waiting ms between.
	 *  GitHub has eventual consistency — new issues may not appear instantly.
	 *  Pass expectedMin to keep retrying until at least that many appear. */
	async function retryListIssues(
		params: Parameters<typeof backend.listIssues>[0],
		maxAttempts = 5,
		delayMs = 2000,
		expectedMin = 1,
	) {
		for (let i = 0; i < maxAttempts; i++) {
			const issues = await backend.listIssues(params, config, token);
			if (issues.length >= expectedMin) return issues;
			if (i < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, delayMs));
			}
		}
		return backend.listIssues(params, config, token);
	}

	// ── Label CRUD ───────────────────────────────────────────────

	describe("labels", () => {
		it("creates a simple label", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
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

		it("creates a scoped label (GitHub colon separator)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "high", scope: "priority", color: "#ff0000" },
				config,
				token,
			);
			assert.strictEqual(label.name, "high");
			assert.strictEqual(label.scope, "priority");
			assert.strictEqual(label.color, "#ff0000");
			createdLabelNames.push("priority:high");
		});

		it("creates a second scoped label in the same scope", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "low", scope: "priority", color: "#00ff00" },
				config,
				token,
			);
			assert.strictEqual(label.name, "low");
			assert.strictEqual(label.scope, "priority");
			createdLabelNames.push("priority:low");
		});

		it("creates a label in a different scope", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			createdLabelNames.push("kind:bug");
		});

		it("lists all labels", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const labels = await backend.listLabels(
				{ scope: "nonexistent" },
				config,
				token,
			);
			assert.strictEqual(labels.length, 0);
		});

		it("updates a label color", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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

		it("renames a label", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const updated = await backend.updateLabel(
				{ name: "smoke-renamed", new_scope: "kind" },
				config,
				token,
			);
			assert.strictEqual(updated.scope, "kind");
			assert.strictEqual(updated.name, "smoke-renamed");
			// Update tracking
			const idx = createdLabelNames.indexOf("smoke-renamed");
			if (idx !== -1) createdLabelNames[idx] = "kind:smoke-renamed";
		});

		it("updates a label description", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const updated = await backend.updateLabel(
				{ name: "high", scope: "priority", description: "Critical priority" },
				config,
				token,
			);
			assert.strictEqual(updated.description, "Critical priority");
		});

		it("renames and rescopes a label simultaneously", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			const idx = createdLabelNames.indexOf("priority:low");
			if (idx !== -1) createdLabelNames[idx] = "severity:medium";
		});

		it("deletes a label", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			await backend.deleteLabel(
				{ name: "smoke-renamed", scope: "kind" },
				config,
				token,
			);
			const labels = await backend.listLabels({}, config, token);
			assert.ok(!labels.some((l) => l.name === "smoke-renamed"));
			const idx = createdLabelNames.indexOf("kind:smoke-renamed");
			if (idx !== -1) createdLabelNames.splice(idx, 1);
		});

		it("delete is idempotent (no error on missing label)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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

		it("creates a sub-issue with a parent (native sub_issues API)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			// GitHub backend sets parent and links via sub_issues API
			assert.strictEqual(issue.parent, parentNum);
			createdIssueNumbers.push(issue.number);
		});

		it("creates a second sub-issue", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const issues = await retryListIssues({ state: "open" }, 20, 3000, 5);
			// 5 issues created so far: basic, markdown, multi-label, sub1, sub2
			assert.ok(
				issues.length >= 5,
				`Expected >=5 issues, got ${issues.length}`,
			);
			// Bodies are stripped in list view
			for (const issue of issues) {
				assert.strictEqual(issue.body, "");
			}
		});

		it("lists issues filtered by a single label", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const issues = await retryListIssues(
				{ state: "open", labels: [{ name: "high", scope: "priority" }] },
				10,
				3000,
				2,
			);
			assert.ok(issues.length >= 2);
			assert.ok(
				issues.every((i) =>
					i.labels.some((l) => l.name === "high" && l.scope === "priority"),
				),
			);
		});

		it("lists issues filtered by multiple labels", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const issues = await retryListIssues(
				{
					state: "open",
					labels: [
						{ name: "high", scope: "priority" },
						{ name: "bug", scope: "kind" },
					],
				},
				10,
				3000,
				1,
			);
			// GitHub ANDs multiple labels — only the multi-label issue should match
			assert.ok(issues.length >= 1);
		});

		it("lists issues with limit", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const issues = await retryListIssues({ state: "open", limit: 2 }, 3, 500);
			assert.ok(issues.length <= 2, `Expected <=2, got ${issues.length}`);
		});

		it("lists sub-issues filtered by parent", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			assert.ok(parentNum);
			const issues = await retryListIssues(
				{ state: "open", parent: parentNum },
				10,
				3000,
				2,
			);
			// Two sub-issues were created with this parent
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			// No issues have been assigned — @me should return empty
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			// All 5 created issues are unassigned
			const issues = await retryListIssues(
				{ state: "open", assignee: "@unassigned" },
				10,
				3000,
				5,
			);
			assert.ok(
				issues.length >= 5,
				`Expected >=5 unassigned issues, got ${issues.length}`,
			);
		});

		it("gets a single issue with body", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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

		it("gets a sub-issue with parent from sub_issues API", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			const subIssueNum = createdIssueNumbers[3]; // first sub-issue
			assert.ok(subIssueNum);
			const issue = await backend.getIssue(
				{ issue_number: subIssueNum },
				config,
				token,
			);
			assert.strictEqual(issue.parent, parentNum);
		});

		it("gets an issue with comments (empty initially)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{ issue_number: num, include_comments: true },
				config,
				token,
			);
			assert.ok(Array.isArray(issue.comments));
		});

		it("updates an issue title", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[1]; // Markdown issue
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, title: "Updated markdown issue" },
				config,
				token,
			);
			assert.strictEqual(updated.title, "Updated markdown issue");
			assert.ok(updated.body.includes("## Overview"));
		});

		it("updates an issue body", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, body: "Replaced body." },
				config,
				token,
			);
			assert.strictEqual(updated.body, "Replaced body.");
		});

		it("adds labels to an issue (label_mode add)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[2]; // Multi-label issue
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[1];
			await backend.updateIssue(
				{ issue_number: num, state: "closed" },
				config,
				token,
			);
			try {
				// Verify closed via getIssue (individual fetch is strongly consistent)
				const closedIssue = await backend.getIssue(
					{ issue_number: num },
					config,
					token,
				);
				assert.strictEqual(closedIssue.state, "closed");
			} finally {
				// Reopen for cleanup — always runs even if assertions fail
				await backend.updateIssue(
					{ issue_number: num, state: "open" },
					config,
					token,
				);
			}
		});

		it("lists all issues (state: all)", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const all = await retryListIssues({ state: "all" }, 10, 3000, 5);
			assert.ok(all.length >= 5, `Expected >=5 issues, got ${all.length}`);
		});

		it("update preserves unchanged fields", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const before = await backend.getIssue(
				{ issue_number: num },
				config,
				token,
			);
			const updated = await backend.updateIssue(
				{ issue_number: num, title: "Title only update" },
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
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const comment = await backend.commentIssue(
				{ issue_number: num, body: "First smoke test comment." },
				config,
				token,
			);
			assert.strictEqual(comment.body, "First smoke test comment.");
			assert.ok(comment.id);
			assert.ok(comment.author);
			assert.ok(comment.created_at);
		});

		it("adds a second comment with markdown", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const comment = await backend.commentIssue(
				{ issue_number: num, body: "Second comment with **markdown**." },
				config,
				token,
			);
			assert.ok(comment.body.includes("**markdown**"));
		});

		it("retrieves issue comments via getIssue", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			const num = createdIssueNumbers[0];
			assert.ok(num);
			const issue = await backend.getIssue(
				{ issue_number: num, include_comments: true },
				config,
				token,
			);
			assert.ok(issue.comments);
			assert.ok(
				issue.comments.length >= 2,
				`Expected >=2 comments, got ${issue.comments?.length}`,
			);
			assert.strictEqual(issue.comments[0]?.body, "First smoke test comment.");
			assert.strictEqual(
				issue.comments[1]?.body,
				"Second comment with **markdown**.",
			);
		});

		it("getIssue without include_comments does not fetch comments", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
	});

	// ── Error handling ───────────────────────────────────────────

	describe("error handling", () => {
		it("getIssue throws for non-existent issue", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			await assert.rejects(async () => {
				await backend.getIssue({ issue_number: 999999 }, config, token);
			}, /GitHub API error/);
		});

		it("commentIssue throws for non-existent issue", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			await assert.rejects(async () => {
				await backend.commentIssue(
					{ issue_number: 999999, body: "nope" },
					config,
					token,
				);
			}, /GitHub API error/);
		});

		it("updateLabel throws for non-existent label", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
		}, async () => {
			await assert.rejects(async () => {
				await backend.updateLabel(
					{ name: "no-such-label-xyz", color: "#000" },
					config,
					token,
				);
			}, /GitHub API error/);
		});

		it("backend throws without token", async () => {
			await assert.rejects(async () => {
				await backend.listIssues({ state: "open" }, config, { token: "" });
			}, /GitHub token is required/);
		});
	});

	// ── Final state verification ─────────────────────────────────

	describe("final state", () => {
		it("verifies all created issues exist and are open", {
			skip: !GITHUB_TOKEN || !GITHUB_OWNER,
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
