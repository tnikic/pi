import assert from "node:assert";
import { describe, it } from "node:test";
import type { BackendConfig } from "../types.ts";
import { createGitHubBackend } from "./github.ts";

// Helper: create a mock fetch that returns a Response
function mockFetcher(
	handler: (
		url: string,
		init?: RequestInit,
	) => { body?: unknown; status: number },
) {
	return async (url: string, init?: RequestInit): Promise<Response> => {
		const { body, status } = handler(url, init);
		const initOptions: ResponseInit = { status };
		if (body !== undefined && status !== 204) {
			return new Response(JSON.stringify(body), initOptions);
		}
		return new Response(null, { status });
	};
}

const config: BackendConfig = {
	type: "github",
	owner: "testowner",
	repo: "testrepo",
	instanceUrl: "https://api.github.com",
};

const token = { token: "ghp_test", instanceUrl: "https://api.github.com" };

describe("GitHubBackend", () => {
	describe("createIssue", () => {
		it("creates a basic issue", async () => {
			const fetch = mockFetcher((url, init) => {
				assert.strictEqual(
					url,
					"https://api.github.com/repos/testowner/testrepo/issues",
				);
				const body = JSON.parse(init?.body as string);
				assert.strictEqual(body.title, "Test issue");
				return {
					status: 201,
					body: {
						number: 42,
						title: "Test issue",
						body: "Description",
						state: "open",
						labels: [],
						assignee: null,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-01T00:00:00Z",
						html_url: "https://github.com/testowner/testrepo/issues/42",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const issue = await backend.createIssue(
				{ title: "Test issue", body: "Description" },
				config,
				token,
			);
			assert.strictEqual(issue.number, 42);
			assert.strictEqual(issue.title, "Test issue");
			assert.strictEqual(issue.body, "Description");
			assert.strictEqual(issue.state, "open");
		});

		it("creates an issue with labels", async () => {
			const fetch = mockFetcher((_url, init) => {
				const body = JSON.parse(init?.body as string);
				assert.deepStrictEqual(body.labels, ["bug", "priority:low"]);
				return {
					status: 201,
					body: {
						number: 1,
						title: "Labeled",
						body: "",
						state: "open",
						labels: [
							{ name: "bug", color: "d73a4a" },
							{ name: "priority:low", color: "0e8a16" },
						],
						assignee: null,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-01T00:00:00Z",
						html_url: "https://github.com/testowner/testrepo/issues/1",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const issue = await backend.createIssue(
				{
					title: "Labeled",
					labels: [{ name: "bug" }, { name: "low", scope: "priority" }],
				},
				config,
				token,
			);
			assert.strictEqual(issue.labels.length, 2);
			assert.deepStrictEqual(issue.labels[0], {
				name: "bug",
				color: "#d73a4a",
			});
			assert.deepStrictEqual(issue.labels[1], {
				name: "low",
				scope: "priority",
				color: "#0e8a16",
			});
		});

		it("creates an issue with a parent (sub-issue)", async () => {
			const calls: string[] = [];
			const fetch = mockFetcher((url, init) => {
				calls.push(url);
				if (url.includes("/sub_issues")) {
					assert.strictEqual(
						url,
						"https://api.github.com/repos/testowner/testrepo/issues/5/sub_issues",
					);
					const body = JSON.parse(init?.body as string);
					assert.strictEqual(body.sub_issue_id, 42);
					return { status: 201, body: {} };
				}
				if (url.includes("/issues") && !url.includes("/issues/")) {
					return {
						status: 201,
						body: {
							number: 42,
							title: "Child",
							body: "> Sub-issue of #5",
							state: "open",
							labels: [],
							assignee: null,
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							html_url: "https://github.com/testowner/testrepo/issues/42",
						},
					};
				}
				return { status: 500, body: {} };
			});

			const backend = createGitHubBackend(fetch);
			const issue = await backend.createIssue(
				{ title: "Child", parent: 5 },
				config,
				token,
			);
			assert.strictEqual(issue.number, 42);
			assert.strictEqual(issue.parent, 5);
		});
	});

	describe("listIssues", () => {
		it("lists issues with filters", async () => {
			const fetch = mockFetcher((url) => {
				assert.ok(url.includes("state=open"));
				assert.ok(url.includes("labels=bug"));
				return {
					status: 200,
					body: [
						{
							number: 1,
							title: "Bug one",
							body: "Something broken",
							state: "open",
							labels: [{ name: "bug", color: "d73a4a" }],
							assignee: null,
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-01T00:00:00Z",
							html_url: "https://github.com/testowner/testrepo/issues/1",
							pull_request: undefined,
						},
					],
				};
			});

			const backend = createGitHubBackend(fetch);
			const issues = await backend.listIssues(
				{ state: "open", labels: [{ name: "bug" }] },
				config,
				token,
			);
			assert.strictEqual(issues.length, 1);
			assert.strictEqual(issues[0]?.title, "Bug one");
			assert.strictEqual(issues[0]?.body, ""); // stripped for list
		});

		it("returns empty body for list results", async () => {
			const fetch = mockFetcher(() => ({
				status: 200,
				body: [
					{
						number: 1,
						title: "Test",
						body: "Full body text",
						state: "open",
						labels: [],
						assignee: null,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-01T00:00:00Z",
						html_url: "https://github.com/testowner/testrepo/issues/1",
					},
				],
			}));

			const backend = createGitHubBackend(fetch);
			const issues = await backend.listIssues({}, config, token);
			assert.strictEqual(issues[0]?.body, "");
		});
	});

	describe("getIssue", () => {
		it("returns issue with comments", async () => {
			let _urlCount = 0;
			const fetch = mockFetcher((url) => {
				_urlCount++;
				if (url.endsWith("/comments")) {
					return {
						status: 200,
						body: [
							{
								id: 123,
								user: { login: "dev" },
								body: "Nice work",
								created_at: "2025-01-02T00:00:00Z",
							},
						],
					};
				}
				return {
					status: 200,
					body: {
						number: 1,
						title: "Test",
						body: "Body",
						state: "open",
						labels: [],
						assignee: null,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-01T00:00:00Z",
						html_url: "https://github.com/testowner/testrepo/issues/1",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const issue = await backend.getIssue(
				{ issue_number: 1, include_comments: true },
				config,
				token,
			);
			assert.strictEqual(issue.comments?.length, 1);
			assert.strictEqual(issue.comments?.[0]?.body, "Nice work");
		});
	});

	describe("updateIssue", () => {
		it("updates title and body", async () => {
			const fetch = mockFetcher((_url, init) => {
				const body = JSON.parse(init?.body as string);
				assert.strictEqual(body.title, "New title");
				return {
					status: 200,
					body: {
						number: 1,
						title: "New title",
						body: "New body",
						state: "open",
						labels: [],
						assignee: null,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-02T00:00:00Z",
						html_url: "https://github.com/testowner/testrepo/issues/1",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const issue = await backend.updateIssue(
				{ issue_number: 1, title: "New title", body: "New body" },
				config,
				token,
			);
			assert.strictEqual(issue.title, "New title");
			assert.strictEqual(issue.body, "New body");
		});
	});

	describe("commentIssue", () => {
		it("adds a comment", async () => {
			const fetch = mockFetcher((_url, init) => {
				const body = JSON.parse(init?.body as string);
				assert.strictEqual(body.body, "My comment");
				return {
					status: 201,
					body: {
						id: 456,
						user: { login: "dev" },
						body: "My comment",
						created_at: "2025-01-01T00:00:00Z",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const comment = await backend.commentIssue(
				{ issue_number: 1, body: "My comment" },
				config,
				token,
			);
			assert.strictEqual(comment.body, "My comment");
			assert.strictEqual(comment.author, "dev");
		});
	});

	describe("label operations", () => {
		it("lists labels", async () => {
			const fetch = mockFetcher(() => ({
				status: 200,
				body: [
					{ name: "bug", color: "d73a4a", description: "Something broken" },
					{ name: "priority:low", color: "0e8a16", description: "" },
				],
			}));

			const backend = createGitHubBackend(fetch);
			const labels = await backend.listLabels({}, config, token);
			assert.strictEqual(labels.length, 2);
			assert.strictEqual(labels[1]?.name, "low");
			assert.strictEqual(labels[1]?.scope, "priority");
		});

		it("creates a label", async () => {
			const fetch = mockFetcher((_url, init) => {
				const body = JSON.parse(init?.body as string);
				assert.strictEqual(body.name, "enhancement");
				assert.strictEqual(body.color, "a2eeef");
				return {
					status: 201,
					body: {
						name: "enhancement",
						color: "a2eeef",
						description: "New feature",
					},
				};
			});

			const backend = createGitHubBackend(fetch);
			const label = await backend.createLabel(
				{ name: "enhancement", color: "#a2eeef", description: "New feature" },
				config,
				token,
			);
			assert.strictEqual(label.name, "enhancement");
			assert.strictEqual(label.color, "#a2eeef");
		});

		it("deletes a label", async () => {
			let called = false;
			const fetch = mockFetcher((_url, init) => {
				called = true;
				assert.strictEqual(init?.method, "DELETE");
				return { status: 204 };
			});

			const backend = createGitHubBackend(fetch);
			await backend.deleteLabel({ name: "bug" }, config, token);
			assert.strictEqual(called, true);
		});
	});
});
