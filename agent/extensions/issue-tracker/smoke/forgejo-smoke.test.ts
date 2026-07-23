/**
 * Forgejo smoke test — runs against a real Forgejo instance in Podman.
 *
 * Prerequisites:
 *   podman run -d --name pi-forgejo-smoke --rm \
 *     -p 9876:3000 \
 *     -e FORGEJO__security__INSTALL_LOCK=true \
 *     codeberg.org/forgejo/forgejo:16.0
 *
 * Then: podman exec -u 1000 pi-forgejo-smoke forgejo admin user create \
 *          --admin --username ci --password ci-password --email ci@test.local --must-change-password=false
 *
 * Then run this test with:
 *   FORGEJO_URL=http://localhost:9876 FORGEJO_TOKEN=<token> \
 *     npx tsx --test agent/extensions/issue-tracker/smoke/forgejo-smoke.test.ts
 *
 * Or use the setup script to automate all of the above:
 *   agent/extensions/issue-tracker/smoke/setup-forgejo.sh --run
 */

import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { createForgejoBackend } from "../backends/forgejo.ts";
import type { BackendConfig, TokenInfo } from "../types.ts";

const FORGEJO_URL = process.env.FORGEJO_URL ?? "http://localhost:9876";
const FORGEJO_TOKEN = process.env.FORGEJO_TOKEN;
const REPO_OWNER = process.env.FORGEJO_OWNER ?? "ci";
const REPO_NAME = process.env.FORGEJO_REPO ?? "smoke-test";

const config: BackendConfig = {
	type: "forgejo",
	owner: REPO_OWNER,
	repo: REPO_NAME,
	instanceUrl: FORGEJO_URL,
};

const token: TokenInfo = {
	token: FORGEJO_TOKEN ?? "",
	instanceUrl: FORGEJO_URL,
};

const createdIssueNumbers: number[] = [];
const createdLabelNames: string[] = [];
let forgejoVersion = "";

// ─── helpers ────────────────────────────────────────────────────

/** Direct API call helper for operations the backend doesn't expose. */
async function api(path: string, options: RequestInit = {}): Promise<Response> {
	const url = `${FORGEJO_URL}/api/v1/${path}`;
	return fetch(url, {
		...options,
		headers: {
			Authorization: `token ${FORGEJO_TOKEN}`,
			"Content-Type": "application/json",
			...((options.headers as Record<string, string>) ?? {}),
		},
	});
}

// ─── test suite ─────────────────────────────────────────────────

describe("Forgejo smoke test", () => {
	before(async () => {
		if (!FORGEJO_TOKEN) {
			console.warn(
				"SKIP: Set FORGEJO_TOKEN and FORGEJO_URL to run smoke tests",
			);
			return;
		}
		try {
			const res = await fetch(`${FORGEJO_URL}/api/v1/version`);
			if (!res.ok) throw new Error(`Forgejo not reachable: ${res.status}`);
			const versionData = (await res.json()) as { version?: string };
			forgejoVersion = versionData.version ?? "unknown";
			console.warn(`Forgejo version: ${forgejoVersion}`);
		} catch (err) {
			console.warn(
				`SKIP: Forgejo not reachable at ${FORGEJO_URL}: ${(err as Error).message}`,
			);
		}
	});

	after(async () => {
		if (!FORGEJO_TOKEN) return;
		// Close all created issues
		for (const num of createdIssueNumbers) {
			try {
				await api(`repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`, {
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
				const listRes = await api(`repos/${REPO_OWNER}/${REPO_NAME}/labels`);
				const labels = (await listRes.json()) as Array<{
					id: number;
					name: string;
				}>;
				const found = labels.find((l) => l.name === name);
				if (found) {
					await api(`repos/${REPO_OWNER}/${REPO_NAME}/labels/${found.id}`, {
						method: "DELETE",
					});
				}
			} catch {
				// ignore
			}
		}
	});

	const backend = createForgejoBackend(fetch);

	// ── Label CRUD ───────────────────────────────────────────────

	describe("labels", () => {
		it("creates a simple label", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("creates a scoped label (Forgejo slash separator)", {
			skip: !FORGEJO_TOKEN,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "high", scope: "priority", color: "#ff0000" },
				config,
				token,
			);
			assert.strictEqual(label.name, "high");
			assert.strictEqual(label.scope, "priority");
			assert.strictEqual(label.color, "#ff0000");
			createdLabelNames.push("priority/high");
		});

		it("creates a second scoped label in the same scope", {
			skip: !FORGEJO_TOKEN,
		}, async () => {
			const label = await backend.createLabel(
				{ name: "low", scope: "priority", color: "#00ff00" },
				config,
				token,
			);
			assert.strictEqual(label.name, "low");
			assert.strictEqual(label.scope, "priority");
			createdLabelNames.push("priority/low");
		});

		it("creates a label in a different scope", {
			skip: !FORGEJO_TOKEN,
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
			createdLabelNames.push("kind/bug");
		});

		it("lists all labels", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("filters labels by scope", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
		}, async () => {
			const labels = await backend.listLabels(
				{ scope: "nonexistent" },
				config,
				token,
			);
			assert.strictEqual(labels.length, 0);
		});

		it("updates a label color", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("renames a label", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
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
			if (idx !== -1) createdLabelNames[idx] = "kind/smoke-renamed";
		});

		it("updates a label description", { skip: !FORGEJO_TOKEN }, async () => {
			const updated = await backend.updateLabel(
				{ name: "high", scope: "priority", description: "Critical priority" },
				config,
				token,
			);
			assert.strictEqual(updated.description, "Critical priority");
		});

		it("renames and rescopes a label simultaneously", {
			skip: !FORGEJO_TOKEN,
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
			const idx = createdLabelNames.indexOf("priority/low");
			if (idx !== -1) createdLabelNames[idx] = "severity/medium";
		});

		it("deletes a label", { skip: !FORGEJO_TOKEN }, async () => {
			await backend.deleteLabel(
				{ name: "smoke-renamed", scope: "kind" },
				config,
				token,
			);
			const labels = await backend.listLabels({}, config, token);
			assert.ok(!labels.some((l) => l.name === "smoke-renamed"));
			const idx = createdLabelNames.indexOf("kind/smoke-renamed");
			if (idx !== -1) createdLabelNames.splice(idx, 1);
		});

		it("delete is idempotent (no error on missing label)", {
			skip: !FORGEJO_TOKEN,
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
		it("creates a basic issue", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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
			// The backend sets parent on the returned object and updates body text
			assert.strictEqual(issue.parent, parentNum);
			assert.ok(issue.body.includes(`#${parentNum}`));
			createdIssueNumbers.push(issue.number);
		});

		it("creates a second sub-issue", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("lists all open issues", { skip: !FORGEJO_TOKEN }, async () => {
			const issues = await backend.listIssues({ state: "open" }, config, token);
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
			skip: !FORGEJO_TOKEN,
		}, async () => {
			const issues = await backend.listIssues(
				{ state: "open", labels: [{ name: "high", scope: "priority" }] },
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
			skip: !FORGEJO_TOKEN,
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
			// Forgejo ANDs multiple labels — only the multi-label issue should match
			assert.ok(issues.length >= 1);
		});

		it("lists issues with limit", { skip: !FORGEJO_TOKEN }, async () => {
			const issues = await backend.listIssues(
				{ state: "open", limit: 2 },
				config,
				token,
			);
			assert.ok(issues.length <= 2, `Expected <=2, got ${issues.length}`);
		});

		it("lists sub-issues filtered by parent", {
			skip: !FORGEJO_TOKEN,
		}, async () => {
			const parentNum = createdIssueNumbers[0];
			assert.ok(parentNum);
			const issues = await backend.listIssues(
				{ state: "open", parent: parentNum },
				config,
				token,
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
		}, async () => {
			// All 5 created issues are unassigned
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

		it("gets a single issue with body", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
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
			assert.ok(issue.body.includes(`Sub-issue of #${parentNum}`));
		});

		it("gets an issue with comments (empty initially)", {
			skip: !FORGEJO_TOKEN,
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

		it("updates an issue title", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("updates an issue body", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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

		it("closes an issue", { skip: !FORGEJO_TOKEN }, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, state: "closed" },
				config,
				token,
			);
			assert.strictEqual(updated.state, "closed");
		});

		it("reopens an issue", { skip: !FORGEJO_TOKEN }, async () => {
			const num = createdIssueNumbers[1];
			assert.ok(num);
			const updated = await backend.updateIssue(
				{ issue_number: num, state: "open" },
				config,
				token,
			);
			assert.strictEqual(updated.state, "open");
		});

		it("lists closed issues only", { skip: !FORGEJO_TOKEN }, async () => {
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

		it("lists all issues (state: all)", { skip: !FORGEJO_TOKEN }, async () => {
			const all = await backend.listIssues({ state: "all" }, config, token);
			assert.ok(all.length >= 5, `Expected >=5 issues, got ${all.length}`);
		});

		it("update preserves unchanged fields", {
			skip: !FORGEJO_TOKEN,
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
		it("adds a comment to an issue", { skip: !FORGEJO_TOKEN }, async () => {
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
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
			skip: !FORGEJO_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.getIssue({ issue_number: 999999 }, config, token);
			}, /Forgejo API error/);
		});

		it("commentIssue throws for non-existent issue", {
			skip: !FORGEJO_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.commentIssue(
					{ issue_number: 999999, body: "nope" },
					config,
					token,
				);
			}, /Forgejo API error/);
		});

		it("updateLabel throws for non-existent label", {
			skip: !FORGEJO_TOKEN,
		}, async () => {
			await assert.rejects(async () => {
				await backend.updateLabel(
					{ name: "no-such-label-xyz", color: "#000" },
					config,
					token,
				);
			}, /Label.*not found/);
		});

		it("backend throws without token", async () => {
			await assert.rejects(async () => {
				await backend.listIssues({ state: "open" }, config, { token: "" });
			}, /Forgejo token is required/);
		});
	});

	// ── Final state verification ─────────────────────────────────

	describe("final state", () => {
		it("verifies all created issues exist and are open", {
			skip: !FORGEJO_TOKEN,
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
