import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { clearMeCache, ensureAuth } from "./auth-prompts.ts";
import type { ToolContext } from "./tools.ts";
import {
	executeCreateIssue,
	executeCreateLabel,
	executeDeleteLabel,
	executeListIssues,
	executeListLabels,
	executeUpdateIssue,
} from "./tools.ts";

const testDir = join(tmpdir(), `pi-test-tools-${Date.now()}`);
const authPath = join(testDir, "issue-tracker-auth.json");

function createMockContext(
	cwd: string,
	ui?: {
		inputs?: Record<string, string>;
		confirms?: boolean[];
		calls?: string[];
	},
): ToolContext {
	const state = ui ?? {};
	return {
		cwd,
		hasUI: !!ui,
		authPath,
		ui: {
			confirm: async (title: string, _message: string) => {
				state.calls?.push(`confirm:${title}`);
				return state.confirms?.shift() ?? false;
			},
			input: async (title: string, _placeholder?: string) => {
				state.calls?.push(`input:${title}`);
				return state.inputs?.[title];
			},
			notify: (_message: string, _type: string) => {},
		},
	};
}

describe("tools integration", () => {
	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(testDir, { recursive: true });
		clearMeCache();
	});

	after(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	it("create_issue creates a local issue and prompts for username", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "dev" },
		});

		const result = await executeCreateIssue(ctx, {
			title: "Test issue",
			body: "Test body",
		});

		assert.ok(result.content[0].text.includes("Test issue"));
		assert.ok(result.content[0].text.includes('"number": 1'));
		assert.ok(result.content[0].text.includes("Created issue #1"));

		const files = readFileSync(
			join(testDir, "docs", "issues", "001-test-issue.md"),
			"utf8",
		);
		assert.ok(files.includes("Test body"));
	});

	it("create_issue auto-creates missing labels", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "dev" },
		});

		const result = await executeCreateIssue(ctx, {
			title: "Labeled issue",
			labels: [{ name: "bug", color: "#d73a4a" }],
		});

		assert.ok(result.content[0].text.includes("created labels: bug"));

		const labelsPath = join(testDir, "docs", "issues", "labels.md");
		assert.ok(existsSync(labelsPath));
		const labelsContent = readFileSync(labelsPath, "utf8");
		assert.ok(labelsContent.includes("bug"));
		assert.ok(labelsContent.includes("#d73a4a"));
	});

	it("list_issues returns created issues", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "dev" },
		});

		await executeCreateIssue(ctx, { title: "Issue one" });
		await executeCreateIssue(ctx, { title: "Issue two" });

		const result = await executeListIssues(ctx, {});

		assert.ok(result.content[0].text.includes("Issue one"));
		assert.ok(result.content[0].text.includes("Issue two"));
	});

	it("update_issue updates labels and creates missing ones", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "dev" },
		});

		const created = await executeCreateIssue(ctx, { title: "Update me" });
		const issue = created.details.issue as { number: number };

		const result = await executeUpdateIssue(ctx, {
			issue_number: issue.number,
			labels: [{ name: "enhancement" }],
		});

		assert.ok(result.content[0].text.includes("enhancement"));
		assert.strictEqual(result.details.issue.labels.length, 1);
	});

	it("delete_label removes a label", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "dev" },
		});

		await executeCreateLabel(ctx, { name: "bug" });
		const result = await executeDeleteLabel(ctx, { name: "bug" });

		assert.ok(result.content[0].text.includes("Deleted label bug"));

		const labels = await executeListLabels(ctx, {});
		assert.strictEqual(labels.details.labels.length, 0);
	});

	it("throws when auth is missing and no UI available", async () => {
		const ctx = createMockContext(testDir);
		await assert.rejects(
			() => executeCreateIssue(ctx, { title: "No auth" }),
			/No local auth configured/,
		);
	});

	it("ensureAuth stores username for local backend", async () => {
		const ctx = createMockContext(testDir, {
			inputs: { "Local tracker username:": "alice" },
		});

		const auth = await ensureAuth(
			{ type: "local", owner: "", repo: "", instanceUrl: "" },
			ctx,
		);

		assert.strictEqual(auth.username, "alice");
	});
});
