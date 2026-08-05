import assert from "node:assert";
import { describe, it } from "node:test";
import { buildAgentConfig, type ParsedFrontmatter } from "./agent-config.ts";

// ── Test helpers ──────────────────────────────────────────────

function fm(frontmatter: Record<string, string>, body = ""): ParsedFrontmatter {
	return { frontmatter, body };
}

// ── buildAgentConfig ──────────────────────────────────────────

describe("buildAgentConfig", () => {
	it("builds config with all frontmatter fields", () => {
		const config = buildAgentConfig(
			fm(
				{
					name: "coder",
					description: "Writes code",
					tools: "bash, read, write",
					model: "claude-sonnet-4-20250514",
					timeout: "300",
					maxTurns: "20",
					toolTimeout: "60",
				},
				"You are a coding assistant.",
			),
			"user",
			"/agents/coder.md",
		);

		assert.ok(config);
		assert.strictEqual(config.name, "coder");
		assert.strictEqual(config.description, "Writes code");
		assert.deepStrictEqual(config.tools, ["bash", "read", "write"]);
		assert.strictEqual(config.model, "claude-sonnet-4-20250514");
		assert.strictEqual(config.timeout, 300);
		assert.strictEqual(config.maxTurns, 20);
		assert.strictEqual(config.toolTimeout, 60);
		assert.strictEqual(config.systemPrompt, "You are a coding assistant.");
		assert.strictEqual(config.source, "user");
		assert.strictEqual(config.filePath, "/agents/coder.md");
	});

	it("system prompt is the markdown body after frontmatter", () => {
		const body = "## Instructions\n\nBe thorough.\n\nCheck:\n- Style\n- Bugs";
		const config = buildAgentConfig(
			fm({ name: "reviewer", description: "Reviews code" }, body),
			"project",
			"/p/reviewer.md",
		);

		assert.ok(config);
		assert.strictEqual(config.systemPrompt, body);
	});

	it("returns null when name is missing", () => {
		const config = buildAgentConfig(
			fm({ description: "Has description but no name" }),
			"user",
			"/a.md",
		);
		assert.strictEqual(config, null);
	});

	it("returns null when description is missing", () => {
		const config = buildAgentConfig(fm({ name: "no-desc" }), "user", "/a.md");
		assert.strictEqual(config, null);
	});

	it("returns null when both name and description missing", () => {
		const config = buildAgentConfig(fm({ tools: "bash" }), "user", "/a.md");
		assert.strictEqual(config, null);
	});

	it("returns null when frontmatter is empty", () => {
		const config = buildAgentConfig(fm({}, "body text"), "user", "/a.md");
		assert.strictEqual(config, null);
	});

	it("returns null when name is empty string", () => {
		const config = buildAgentConfig(
			fm({ name: "", description: "desc" }),
			"user",
			"/a.md",
		);
		assert.strictEqual(config, null);
	});

	it("returns null when description is empty string", () => {
		const config = buildAgentConfig(
			fm({ name: "agent", description: "" }),
			"user",
			"/a.md",
		);
		assert.strictEqual(config, null);
	});

	it("parses tools as comma-separated list with trimming", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", tools: " bash , read ,  write  " }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.deepStrictEqual(config.tools, ["bash", "read", "write"]);
	});

	it("tools undefined when tools field is absent", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.tools, undefined);
	});

	it("tools undefined when tools field is empty string", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", tools: "" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.tools, undefined);
	});

	it("tools undefined when tools is only whitespace/commas", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", tools: " , , " }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.tools, undefined);
	});

	it("single tool without commas", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", tools: "bash" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.deepStrictEqual(config.tools, ["bash"]);
	});

	it("safety caps default to undefined when absent", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.timeout, undefined);
		assert.strictEqual(config.maxTurns, undefined);
		assert.strictEqual(config.toolTimeout, undefined);
	});

	it("safety caps are undefined when values are non-numeric", () => {
		const config = buildAgentConfig(
			fm({
				name: "a",
				description: "d",
				timeout: "not-a-number",
				maxTurns: "abc",
				toolTimeout: "",
			}),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.timeout, undefined);
		assert.strictEqual(config.maxTurns, undefined);
		assert.strictEqual(config.toolTimeout, undefined);
	});

	it("safety caps parse zero correctly", () => {
		const config = buildAgentConfig(
			fm({
				name: "a",
				description: "d",
				timeout: "0",
				maxTurns: "0",
				toolTimeout: "0",
			}),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.timeout, 0);
		assert.strictEqual(config.maxTurns, 0);
		assert.strictEqual(config.toolTimeout, 0);
	});

	it("safety caps parse negative values", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", maxTurns: "-1" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.maxTurns, -1);
	});

	it("model undefined when not specified", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.model, undefined);
	});

	it("model undefined when empty string", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d", model: "" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.model, undefined);
	});

	it("sets source to user", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.source, "user");
	});

	it("sets source to project", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"project",
			"/p/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.source, "project");
	});

	it("preserves filePath as-is", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }),
			"project",
			"/some/custom/path/agent.md",
		);
		assert.ok(config);
		assert.strictEqual(config.filePath, "/some/custom/path/agent.md");
	});

	it("handles body with YAML-like content (not confused with frontmatter)", () => {
		const body = "key: value\nanother: 123";
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }, body),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.systemPrompt, body);
	});

	it("handles empty body", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }, ""),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.systemPrompt, "");
	});

	it("handles whitespace-only body", () => {
		const config = buildAgentConfig(
			fm({ name: "a", description: "d" }, "  \n\t "),
			"user",
			"/a.md",
		);
		assert.ok(config);
		assert.strictEqual(config.systemPrompt, "  \n\t ");
	});
});
