import assert from "node:assert";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { BackendConfig } from "../types.ts";
import { localBackend } from "./local.ts";

// Temp directory for tests
const testDir = join(tmpdir(), `pi-test-local-tracker-${Date.now()}`);
const issuesPath = join(testDir, "docs", "issues");

function makeConfig(overrides?: Partial<BackendConfig>): BackendConfig {
	return {
		type: "local",
		owner: "",
		repo: "",
		instanceUrl: "",
		issuesPath,
		...overrides,
	};
}

describe("localBackend", () => {
	beforeEach(() => {
		// Clean and recreate test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(issuesPath, { recursive: true });
	});

	after(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("createIssue", () => {
		it("creates an issue file with sequential number", async () => {
			const issue = await localBackend.createIssue(
				{ title: "My first issue", body: "Description here" },
				makeConfig(),
			);
			assert.strictEqual(issue.number, 1);
			assert.strictEqual(issue.title, "My first issue");
			assert.strictEqual(issue.body, "Description here");
			assert.strictEqual(issue.state, "open");
			assert.deepStrictEqual(issue.labels, []);
			assert.strictEqual(issue.assignee, null);
			assert.strictEqual(issue.parent, null);
			assert.deepStrictEqual(issue.blocked_by, []);

			// Second issue gets number 2
			const issue2 = await localBackend.createIssue(
				{ title: "Second" },
				makeConfig(),
			);
			assert.strictEqual(issue2.number, 2);
		});

		it("creates an issue with labels", async () => {
			const issue = await localBackend.createIssue(
				{
					title: "Labeled issue",
					labels: [{ name: "bug" }, { name: "low", scope: "priority" }],
				},
				makeConfig(),
			);
			assert.strictEqual(issue.labels.length, 2);
			assert.deepStrictEqual(issue.labels[0], { name: "bug" });
			assert.deepStrictEqual(issue.labels[1], {
				name: "low",
				scope: "priority",
			});
		});

		it("creates an issue with a parent (sub-issue)", async () => {
			const parent = await localBackend.createIssue(
				{ title: "Parent" },
				makeConfig(),
			);
			const child = await localBackend.createIssue(
				{ title: "Child", parent: parent.number },
				makeConfig(),
			);
			assert.strictEqual(child.parent, parent.number);

			// Parent body should contain reference to child
			const fetchedParent = await localBackend.getIssue(
				{ issue_number: parent.number },
				makeConfig(),
			);
			assert.ok(
				fetchedParent.body.includes(`#${child.number}`),
				"Parent body should reference child issue",
			);
		});

		it("creates an issue with an assignee", async () => {
			const issue = await localBackend.createIssue(
				{ title: "Assigned", assignee: "dev" },
				makeConfig(),
			);
			assert.strictEqual(issue.assignee, "dev");
		});
	});

	describe("getIssue", () => {
		it("returns an issue with comments when requested", async () => {
			const created = await localBackend.createIssue(
				{ title: "Test", body: "Body" },
				makeConfig(),
			);
			await localBackend.commentIssue(
				{ issue_number: created.number, body: "First comment" },
				makeConfig(),
			);

			const issue = await localBackend.getIssue(
				{ issue_number: created.number, include_comments: true },
				makeConfig(),
			);
			assert.strictEqual(issue.number, created.number);
			assert.strictEqual(issue.title, "Test");
			assert.strictEqual(issue.body, "Body");
			assert.ok(issue.comments);
			assert.strictEqual(issue.comments?.length, 1);
			assert.strictEqual(issue.comments?.[0]?.body, "First comment");
		});

		it("returns an issue without comments by default", async () => {
			const created = await localBackend.createIssue(
				{ title: "Test" },
				makeConfig(),
			);
			await localBackend.commentIssue(
				{ issue_number: created.number, body: "Comment" },
				makeConfig(),
			);

			const issue = await localBackend.getIssue(
				{ issue_number: created.number, include_comments: false },
				makeConfig(),
			);
			assert.strictEqual(issue.comments, undefined);
		});

		it("throws when issue number does not exist", async () => {
			await assert.rejects(
				() => localBackend.getIssue({ issue_number: 999 }, makeConfig()),
				/Issue #999 not found/,
			);
		});
	});

	describe("updateIssue", () => {
		it("updates title and body", async () => {
			const created = await localBackend.createIssue(
				{ title: "Old title" },
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{ issue_number: created.number, title: "New title", body: "New body" },
				makeConfig(),
			);
			assert.strictEqual(updated.title, "New title");
			assert.strictEqual(updated.body, "New body");
		});

		it("closes an issue", async () => {
			const created = await localBackend.createIssue(
				{ title: "Open issue" },
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{ issue_number: created.number, state: "closed" },
				makeConfig(),
			);
			assert.strictEqual(updated.state, "closed");
		});

		it("replaces labels by default", async () => {
			const created = await localBackend.createIssue(
				{
					title: "Labeled",
					labels: [{ name: "bug" }, { name: "enhancement" }],
				},
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{
					issue_number: created.number,
					labels: [{ name: "documentation" }],
				},
				makeConfig(),
			);
			assert.strictEqual(updated.labels.length, 1);
			assert.deepStrictEqual(updated.labels[0], { name: "documentation" });
		});

		it("adds labels in add mode", async () => {
			const created = await localBackend.createIssue(
				{
					title: "Labeled",
					labels: [{ name: "bug" }],
				},
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{
					issue_number: created.number,
					labels: [{ name: "enhancement" }],
					label_mode: "add",
				},
				makeConfig(),
			);
			assert.strictEqual(updated.labels.length, 2);
		});

		it("removes labels in remove mode", async () => {
			const created = await localBackend.createIssue(
				{
					title: "Labeled",
					labels: [{ name: "bug" }, { name: "enhancement" }],
				},
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{
					issue_number: created.number,
					labels: [{ name: "bug" }],
					label_mode: "remove",
				},
				makeConfig(),
			);
			assert.strictEqual(updated.labels.length, 1);
			assert.deepStrictEqual(updated.labels[0], { name: "enhancement" });
		});

		it("updates assignee", async () => {
			const created = await localBackend.createIssue(
				{ title: "Unassigned", assignee: "olduser" },
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{ issue_number: created.number, assignee: "newuser" },
				makeConfig(),
			);
			assert.strictEqual(updated.assignee, "newuser");
		});

		it("clears assignee with null", async () => {
			const created = await localBackend.createIssue(
				{ title: "Assigned", assignee: "dev" },
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{ issue_number: created.number, assignee: null },
				makeConfig(),
			);
			assert.strictEqual(updated.assignee, null);
		});

		it("updates blocked_by", async () => {
			const created = await localBackend.createIssue(
				{ title: "Blocked" },
				makeConfig(),
			);
			const updated = await localBackend.updateIssue(
				{ issue_number: created.number, blocked_by: [1, 2] },
				makeConfig(),
			);
			assert.deepStrictEqual(updated.blocked_by, [1, 2]);
		});
	});

	describe("listIssues", () => {
		it("returns empty array when no issues exist", async () => {
			const issues = await localBackend.listIssues({}, makeConfig());
			assert.deepStrictEqual(issues, []);
		});

		it("lists all issues", async () => {
			await localBackend.createIssue({ title: "First" }, makeConfig());
			await localBackend.createIssue({ title: "Second" }, makeConfig());
			const issues = await localBackend.listIssues({}, makeConfig());
			assert.strictEqual(issues.length, 2);
		});

		it("filters by state", async () => {
			const first = await localBackend.createIssue(
				{ title: "Open" },
				makeConfig(),
			);
			await localBackend.updateIssue(
				{ issue_number: first.number, state: "closed" },
				makeConfig(),
			);
			await localBackend.createIssue({ title: "Open 2" }, makeConfig());
			const open = await localBackend.listIssues(
				{ state: "open" },
				makeConfig(),
			);
			assert.strictEqual(open.length, 1);
			const closed = await localBackend.listIssues(
				{ state: "closed" },
				makeConfig(),
			);
			assert.strictEqual(closed.length, 1);
		});

		it("filters by parent", async () => {
			const parent = await localBackend.createIssue(
				{ title: "Parent" },
				makeConfig(),
			);
			await localBackend.createIssue(
				{ title: "Child 1", parent: parent.number },
				makeConfig(),
			);
			await localBackend.createIssue(
				{ title: "Child 2", parent: parent.number },
				makeConfig(),
			);
			await localBackend.createIssue({ title: "Unrelated" }, makeConfig());

			const children = await localBackend.listIssues(
				{ parent: parent.number },
				makeConfig(),
			);
			assert.strictEqual(children.length, 2);
		});

		it("filters unblocked issues", async () => {
			await localBackend.createIssue({ title: "Blocked" }, makeConfig());
			const blocked = await localBackend.createIssue(
				{ title: "Blocked 2" },
				makeConfig(),
			);
			await localBackend.updateIssue(
				{ issue_number: blocked.number, blocked_by: [1] },
				makeConfig(),
			);
			const unblocked = await localBackend.listIssues(
				{ unblocked: true },
				makeConfig(),
			);
			assert.strictEqual(unblocked.length, 1);
		});

		it("strips body from list results", async () => {
			await localBackend.createIssue(
				{ title: "Test", body: "Should be stripped" },
				makeConfig(),
			);
			const issues = await localBackend.listIssues({}, makeConfig());
			assert.strictEqual(issues[0]?.body, "");
		});
	});

	describe("labels", () => {
		it("creates and lists labels", async () => {
			await localBackend.createLabel(
				{ name: "bug", color: "#d73a4a", description: "Something is broken" },
				makeConfig(),
			);
			const labels = await localBackend.listLabels({}, makeConfig());
			assert.strictEqual(labels.length, 1);
			assert.strictEqual(labels[0]?.name, "bug");
			assert.strictEqual(labels[0]?.color, "#d73a4a");
		});

		it("creates scoped labels", async () => {
			await localBackend.createLabel(
				{ name: "low", scope: "priority", exclusive: true },
				makeConfig(),
			);
			const labels = await localBackend.listLabels({}, makeConfig());
			assert.strictEqual(labels.length, 1);
			assert.strictEqual(labels[0]?.name, "low");
			assert.strictEqual(labels[0]?.scope, "priority");
			assert.strictEqual(labels[0]?.exclusive, true);
		});

		it("filters labels by scope", async () => {
			await localBackend.createLabel(
				{ name: "low", scope: "priority" },
				makeConfig(),
			);
			await localBackend.createLabel(
				{ name: "map", scope: "wayfinder" },
				makeConfig(),
			);
			const priorityLabels = await localBackend.listLabels(
				{ scope: "priority" },
				makeConfig(),
			);
			assert.strictEqual(priorityLabels.length, 1);
			assert.strictEqual(priorityLabels[0]?.scope, "priority");
		});

		it("updates a label", async () => {
			await localBackend.createLabel(
				{ name: "bug", color: "#d73a4a" },
				makeConfig(),
			);
			const updated = await localBackend.updateLabel(
				{ name: "bug", color: "#ff0000" },
				makeConfig(),
			);
			assert.strictEqual(updated.color, "#ff0000");
		});

		it("deletes a label", async () => {
			await localBackend.createLabel({ name: "bug" }, makeConfig());
			await localBackend.deleteLabel({ name: "bug" }, makeConfig());
			const labels = await localBackend.listLabels({}, makeConfig());
			assert.strictEqual(labels.length, 0);
		});
	});
});
