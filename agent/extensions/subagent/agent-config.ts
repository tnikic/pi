/**
 * Pure agent configuration model — no I/O, no runtime dependencies.
 * Testable without the pi runtime.
 */

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	timeout?: number;
	maxTurns?: number;
	toolTimeout?: number;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface ParsedFrontmatter {
	frontmatter: Record<string, string>;
	body: string;
}

/**
 * Build an AgentConfig from already-parsed frontmatter.
 * Returns null if required fields (name, description) are missing.
 */
export function buildAgentConfig(
	parsed: ParsedFrontmatter,
	source: "user" | "project",
	filePath: string,
): AgentConfig | null {
	const { frontmatter, body } = parsed;

	if (!frontmatter.name || !frontmatter.description) {
		return null;
	}

	const tools = frontmatter.tools
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);

	const timeout = frontmatter.timeout ? Number(frontmatter.timeout) : undefined;
	const maxTurns = frontmatter.maxTurns
		? Number(frontmatter.maxTurns)
		: undefined;
	const toolTimeout = frontmatter.toolTimeout
		? Number(frontmatter.toolTimeout)
		: undefined;

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: tools && tools.length > 0 ? tools : undefined,
		model: frontmatter.model || undefined,
		timeout: Number.isFinite(timeout) ? timeout : undefined,
		maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
		toolTimeout: Number.isFinite(toolTimeout) ? toolTimeout : undefined,
		systemPrompt: body,
		source,
		filePath,
	};
}
