import assert from "node:assert";
import { describe, it } from "node:test";
import { createGitLabBackend } from "./gitlab.ts";

function mockFetcher(
	handler: (
		url: string,
		init?: RequestInit,
	) => { body?: unknown; status: number },
) {
	return async (url: string, init?: RequestInit): Promise<Response> => {
		const { body, status } = handler(url, init);
		if (body !== undefined && status !== 204) {
			return new Response(JSON.stringify(body), { status });
		}
		return new Response(null, { status });
	};
}

describe("GitLabBackend", () => {
	const config = {
		type: "gitlab" as const,
		owner: "team",
		repo: "project",
		instanceUrl: "https://gitlab.com",
	};
	const token = { token: "gl_token", instanceUrl: "https://gitlab.com" };

	it("creates a basic issue", async () => {
		const fetch = mockFetcher((_url, init) => {
			const body = JSON.parse(init?.body as string);
			assert.strictEqual(body.title, "Test");
			return {
				status: 201,
				body: {
					iid: 1,
					title: "Test",
					description: "Description",
					state: "opened",
					labels: [],
					assignees: [],
					assignee: null,
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					web_url: "https://gitlab.com/team/project/-/issues/1",
				},
			};
		});
		const backend = createGitLabBackend(fetch);
		const issue = await backend.createIssue(
			{ title: "Test", body: "Description" },
			config,
			token,
		);
		assert.strictEqual(issue.number, 1);
		assert.strictEqual(issue.title, "Test");
	});

	it("creates an issue with scoped labels using double-colon separator", async () => {
		let labelsBody: string | undefined;
		const fetch = mockFetcher((_url, init) => {
			labelsBody = JSON.parse(init?.body as string).labels;
			return {
				status: 201,
				body: {
					iid: 1,
					title: "Labeled",
					description: "",
					state: "opened",
					labels: ["priority::high"],
					assignees: [],
					assignee: null,
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					web_url: "https://gitlab.com/team/project/-/issues/1",
				},
			};
		});
		const backend = createGitLabBackend(fetch);
		const issue = await backend.createIssue(
			{
				title: "Labeled",
				labels: [{ name: "high", scope: "priority" }],
			},
			config,
			token,
		);
		assert.strictEqual(labelsBody, "priority::high");
		assert.strictEqual(issue.labels[0].name, "high");
		assert.strictEqual(issue.labels[0].scope, "priority");
	});

	it("lists labels with gitlab color format", async () => {
		const fetch = mockFetcher(() => ({
			status: 200,
			body: [
				{
					name: "bug",
					color: "#d73a4a",
					description: "Broken",
				},
			],
		}));
		const backend = createGitLabBackend(fetch);
		const labels = await backend.listLabels({}, config, token);
		assert.strictEqual(labels.length, 1);
		assert.strictEqual(labels[0].color, "#d73a4a");
	});

	it("creates a label", async () => {
		const fetch = mockFetcher((_url, init) => {
			const body = JSON.parse(init?.body as string);
			assert.strictEqual(body.name, "enhancement");
			assert.strictEqual(body.color, "#a2eeef");
			return {
				status: 201,
				body: {
					id: 5,
					name: "enhancement",
					color: "#a2eeef",
					description: "New",
				},
			};
		});
		const backend = createGitLabBackend(fetch);
		const label = await backend.createLabel(
			{
				name: "enhancement",
				color: "#a2eeef",
				description: "New",
			},
			config,
			token,
		);
		assert.strictEqual(label.name, "enhancement");
		assert.strictEqual(label.color, "#a2eeef");
	});

	it("adds a comment (note)", async () => {
		const fetch = mockFetcher(() => ({
			status: 201,
			body: {
				id: 10,
				author: { username: "contributor" },
				body: "Nice!",
				created_at: "2025-01-01T00:00:00Z",
				system: false,
			},
		}));
		const backend = createGitLabBackend(fetch);
		const comment = await backend.commentIssue(
			{ issue_number: 1, body: "Nice!" },
			config,
			token,
		);
		assert.strictEqual(comment.author, "contributor");
		assert.strictEqual(comment.body, "Nice!");
	});

	it("maps assignee from assignees array", async () => {
		const fetch = mockFetcher(() => ({
			status: 200,
			body: [
				{
					iid: 1,
					title: "Assigned",
					description: "",
					state: "opened",
					labels: [],
					assignees: [{ username: "dev1" }],
					assignee: { username: "dev1" },
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					web_url: "https://gitlab.com/team/project/-/issues/1",
				},
			],
		}));
		const backend = createGitLabBackend(fetch);
		const issues = await backend.listIssues({}, config, token);
		assert.strictEqual(issues[0].assignee, "dev1");
	});

	it("maps state opened/closed correctly", async () => {
		const fetch = mockFetcher(() => ({
			status: 200,
			body: {
				iid: 42,
				title: "Closed",
				description: "",
				state: "closed",
				labels: [],
				assignees: [],
				assignee: null,
				created_at: "2025-01-01T00:00:00Z",
				updated_at: "2025-01-01T00:00:00Z",
				web_url: "https://gitlab.com/team/project/-/issues/42",
			},
		}));
		const backend = createGitLabBackend(fetch);
		const issue = await backend.getIssue({ issue_number: 42 }, config, token);
		assert.strictEqual(issue.state, "closed");
	});

	it("backend throws without token", async () => {
		const backend = createGitLabBackend(fetch);
		await assert.rejects(async () => {
			await backend.listIssues({ state: "open" }, config, {
				token: "",
			});
		}, /GitLab token is required/);
	});
});
