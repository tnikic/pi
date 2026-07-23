import assert from "node:assert";
import { describe, it } from "node:test";
import { createForgejoBackend } from "./forgejo.ts";

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

describe("ForgejoBackend", () => {
	const config = {
		type: "forgejo",
		owner: "team",
		repo: "project",
		instanceUrl: "https://codeberg.org",
	};
	const token = { token: "fj_token", instanceUrl: "https://codeberg.org" };

	it("creates a basic issue", async () => {
		const fetch = mockFetcher((_url, init) => {
			const body = JSON.parse(init.body);
			assert.strictEqual(body.title, "Test");
			return {
				status: 201,
				body: {
					number: 1,
					title: "Test",
					body: "Description",
					state: "open",
					labels: [],
					assignee: null,
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					html_url: "https://codeberg.org/team/project/issues/1",
				},
			};
		});
		const backend = createForgejoBackend(fetch);
		const issue = await backend.createIssue(
			{ title: "Test", body: "Description" },
			config,
			token,
		);
		assert.strictEqual(issue.number, 1);
		assert.strictEqual(issue.title, "Test");
	});

	it("creates an issue with scoped labels using slash separator", async () => {
		const fetch = mockFetcher((url, init) => {
			if (url.includes("/labels") && init?.method === undefined) {
				return {
					status: 200,
					body: [{ id: 5, name: "priority/low" }],
				};
			}
			const body = JSON.parse(init.body);
			assert.deepStrictEqual(body.labels, [5]);
			return {
				status: 201,
				body: {
					number: 1,
					title: "Labeled",
					body: "",
					state: "open",
					labels: [{ name: "priority/low", color: "0e8a16", description: "" }],
					assignee: null,
					created_at: "2025-01-01T00:00:00Z",
					updated_at: "2025-01-01T00:00:00Z",
					html_url: "https://codeberg.org/team/project/issues/1",
				},
			};
		});
		const backend = createForgejoBackend(fetch);
		const issue = await backend.createIssue(
			{ title: "Labeled", labels: [{ name: "low", scope: "priority" }] },
			config,
			token,
		);
		assert.strictEqual(issue.labels[0].name, "low");
		assert.strictEqual(issue.labels[0].scope, "priority");
		assert.strictEqual(issue.labels[0].color, "#0e8a16");
	});

	it("lists labels with forgejo color format", async () => {
		const fetch = mockFetcher(() => ({
			status: 200,
			body: [{ name: "bug", color: "#d73a4a", description: "Broken" }],
		}));
		const backend = createForgejoBackend(fetch);
		const labels = await backend.listLabels({}, config, token);
		assert.strictEqual(labels.length, 1);
		assert.strictEqual(labels[0].color, "#d73a4a");
	});

	it("creates a label", async () => {
		const fetch = mockFetcher((_url, init) => {
			const body = JSON.parse(init.body);
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
		const backend = createForgejoBackend(fetch);
		const label = await backend.createLabel(
			{ name: "enhancement", color: "#a2eeef", description: "New" },
			config,
			token,
		);
		assert.strictEqual(label.name, "enhancement");
		assert.strictEqual(label.color, "#a2eeef");
	});

	it("adds a comment", async () => {
		const fetch = mockFetcher(() => ({
			status: 201,
			body: {
				id: 10,
				user: { login: "contributor" },
				body: "Nice!",
				created_at: "2025-01-01T00:00:00Z",
			},
		}));
		const backend = createForgejoBackend(fetch);
		const comment = await backend.commentIssue(
			{ issue_number: 1, body: "Nice!" },
			config,
			token,
		);
		assert.strictEqual(comment.author, "contributor");
		assert.strictEqual(comment.body, "Nice!");
	});
});
