import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

const AGENTS_DIR = path.resolve(import.meta.dirname, "..", "..", "agents");

interface AgentFrontmatter {
	name: string;
	description: string;
}

function parseSimpleFrontmatter(content: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content };

	const frontmatter: Record<string, string> = {};
	const lines = match[1].split("\n");
	for (const line of lines) {
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim();
		frontmatter[key] = value;
	}
	return { frontmatter, body: match[2] };
}

function loadAgentFile(filename: string): {
	name: string;
	description: string;
	body: string;
} | null {
	const filePath = path.join(AGENTS_DIR, filename);
	if (!fs.existsSync(filePath)) return null;

	const content = fs.readFileSync(filePath, "utf-8");
	const parsed = parseSimpleFrontmatter(content);

	if (!parsed.frontmatter.name || !parsed.frontmatter.description) {
		return null;
	}

	return {
		name: parsed.frontmatter.name,
		description: parsed.frontmatter.description,
		body: parsed.body,
	};
}

describe("built-in agent definitions", () => {
	const agentFiles = ["researcher.md", "auditor.md", "architect.md"];
	const agents = new Map<
		string,
		{ name: string; description: string; body: string }
	>();

	for (const filename of agentFiles) {
		const agent = loadAgentFile(filename);
		if (agent) agents.set(agent.name, agent);
	}

	it("all three agent files exist and parse", () => {
		assert.strictEqual(agents.size, 3, `expected 3 agents, got ${agents.size}`);
		assert.ok(agents.has("researcher"), "missing researcher");
		assert.ok(agents.has("auditor"), "missing auditor");
		assert.ok(agents.has("architect"), "missing architect");
	});

	it("each agent has a non-empty system prompt", () => {
		for (const [name, agent] of agents) {
			assert.ok(
				agent.body.length > 100,
				`${name} system prompt is too short (${agent.body.length} chars)`,
			);
		}
	});

	it("each agent has a meaningful description", () => {
		for (const [name, agent] of agents) {
			assert.ok(
				agent.description.length > 10,
				`${name} description is too short: "${agent.description}"`,
			);
		}
	});

	it("each agent filename matches its frontmatter name", () => {
		for (const [name] of agents) {
			const filename = `${name}.md`;
			assert.ok(
				agentFiles.includes(filename),
				`no file ${filename} found for agent ${name}`,
			);
		}
	});

	it("no agent frontmatter has a tools field (inherits all tools)", () => {
		for (const filename of agentFiles) {
			const content = fs.readFileSync(path.join(AGENTS_DIR, filename), "utf-8");
			const parsed = parseSimpleFrontmatter(content);
			assert.strictEqual(
				parsed.frontmatter.tools,
				undefined,
				`${filename} should not restrict tools`,
			);
		}
	});

	describe("researcher", () => {
		const agent = agents.get("researcher");
		it("exists", () => assert.ok(agent));
		it("has fact-finding identity in system prompt", () => {
			assert.ok(
				agent!.body.includes("research assistant"),
				"should identify as research assistant",
			);
			assert.ok(
				agent!.body.includes("primary sources"),
				"should reference primary sources",
			);
		});
		it("has no-evaluation constraint", () => {
			assert.ok(
				agent!.body.includes("do not evaluate"),
				"should prohibit evaluation",
			);
		});
		it("has four-section structure", () => {
			assert.ok(agent!.body.includes("# Identity"));
			assert.ok(agent!.body.includes("# Instructions"));
			assert.ok(agent!.body.includes("# Constraints"));
			assert.ok(agent!.body.includes("# Research Standards"));
		});
		it("has Completion section with report_done instruction", () => {
			assert.ok(agent!.body.includes("# Completion"));
			assert.ok(agent!.body.includes("report_done"));
		});
	});

	describe("auditor", () => {
		const agent = agents.get("auditor");
		it("exists", () => assert.ok(agent));
		it("has code auditing identity in system prompt", () => {
			assert.ok(
				agent!.body.includes("code auditor"),
				"should identify as code auditor",
			);
		});
		it("distinguishes hard violations from judgment calls", () => {
			assert.ok(
				agent!.body.includes("Hard violation"),
				"should define hard violations",
			);
			assert.ok(
				agent!.body.includes("Judgment call"),
				"should define judgment calls",
			);
		});
		it("includes the smell baseline", () => {
			assert.ok(
				agent!.body.includes("Mysterious Name"),
				"should include smell baseline",
			);
			assert.ok(
				agent!.body.includes("Primitive Obsession"),
				"should include Primitive Obsession",
			);
		});
		it("has four-section structure", () => {
			assert.ok(agent!.body.includes("# Identity"));
			assert.ok(agent!.body.includes("# Instructions"));
			assert.ok(agent!.body.includes("# Constraints"));
			assert.ok(agent!.body.includes("# Common Reference"));
		});
		it("has Completion section with report_done instruction", () => {
			assert.ok(agent!.body.includes("# Completion"));
			assert.ok(agent!.body.includes("report_done"));
		});
	});

	describe("architect", () => {
		const agent = agents.get("architect");
		it("exists", () => assert.ok(agent));
		it("has architecture vocabulary in system prompt", () => {
			assert.ok(
				agent!.body.includes("deep-module"),
				"should reference deep-module vocabulary",
			);
		});
		it("includes the deletion test", () => {
			assert.ok(
				agent!.body.includes("deletion test"),
				"should include deletion test",
			);
		});
		it("defines key vocabulary terms", () => {
			assert.ok(agent!.body.includes("**Module**"), "should define Module");
			assert.ok(
				agent!.body.includes("**Interface**"),
				"should define Interface",
			);
			assert.ok(agent!.body.includes("**Depth**"), "should define Depth");
			assert.ok(agent!.body.includes("**Seam**"), "should define Seam");
			assert.ok(agent!.body.includes("**Leverage**"), "should define Leverage");
			assert.ok(agent!.body.includes("**Locality**"), "should define Locality");
		});
		it("has four-section structure", () => {
			assert.ok(agent!.body.includes("# Identity"));
			assert.ok(agent!.body.includes("# Vocabulary"));
			assert.ok(agent!.body.includes("# Instructions"));
			assert.ok(agent!.body.includes("# Constraints"));
		});
		it("has Completion section with report_done instruction", () => {
			assert.ok(agent!.body.includes("# Completion"));
			assert.ok(agent!.body.includes("report_done"));
		});
	});
});
