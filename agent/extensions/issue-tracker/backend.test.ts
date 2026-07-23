import assert from "node:assert";
import { describe, it } from "node:test";
import { detectBackend } from "./backend.ts";

describe("detectBackend", () => {
	it("detects github from HTTPS remote", async () => {
		const { config, backend } = await detectBackend(
			"/fake/cwd",
			"https://github.com/user/repo.git",
		);
		assert.strictEqual(config.type, "github");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
		assert.strictEqual(config.instanceUrl, "https://api.github.com");
		assert.ok(backend);
	});

	it("detects github from SSH remote", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"git@github.com:user/repo.git",
		);
		assert.strictEqual(config.type, "github");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});

	it("detects github from git:// remote", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"git://github.com/user/repo.git",
		);
		assert.strictEqual(config.type, "github");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});

	it("detects forgejo from HTTPS remote on codeberg.org", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"https://codeberg.org/owner/project.git",
		);
		assert.strictEqual(config.type, "forgejo");
		assert.strictEqual(config.owner, "owner");
		assert.strictEqual(config.repo, "project");
		assert.strictEqual(config.instanceUrl, "https://codeberg.org");
	});

	it("detects forgejo from SSH remote on custom domain", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"git@git.mycompany.com:team/project.git",
		);
		assert.strictEqual(config.type, "forgejo");
		assert.strictEqual(config.owner, "team");
		assert.strictEqual(config.repo, "project");
		assert.strictEqual(config.instanceUrl, "https://git.mycompany.com");
	});

	it("detects forgejo from HTTPS remote with nested path", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"https://git.example.com/org/subgroup/repo.git",
		);
		assert.strictEqual(config.type, "forgejo");
		assert.strictEqual(config.owner, "org/subgroup");
		assert.strictEqual(config.repo, "repo");
		assert.strictEqual(config.instanceUrl, "https://git.example.com");
	});

	it("falls back to local when remoteUrl is undefined", async () => {
		const { config } = await detectBackend("/fake/cwd", undefined);
		assert.strictEqual(config.type, "local");
		assert.strictEqual(config.issuesPath, "/fake/cwd/docs/issues");
	});

	it("detects gitlab from SSH remote", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"git@gitlab.com:user/repo.git",
		);
		assert.strictEqual(config.type, "gitlab");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});

	it("detects gitlab from HTTPS remote", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"https://gitlab.com/user/repo.git",
		);
		assert.strictEqual(config.type, "gitlab");
		assert.strictEqual(config.instanceUrl, "https://gitlab.com");
	});

	it("handles HTTPS remote without .git suffix", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"https://github.com/user/repo",
		);
		assert.strictEqual(config.type, "github");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});

	it("handles SSH remote without .git suffix", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"git@codeberg.org:user/repo",
		);
		assert.strictEqual(config.type, "forgejo");
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});

	it("strips trailing slash from HTTPS remote", async () => {
		const { config } = await detectBackend(
			"/fake/cwd",
			"https://github.com/user/repo.git/",
		);
		assert.strictEqual(config.owner, "user");
		assert.strictEqual(config.repo, "repo");
	});
});
