import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SearxngConfig {
	port: number;
	secretKey: string;
}

function defaultConfigPath(): string {
	return join(homedir(), ".pi", "config.json");
}

export function getSearxngConfig(configPath?: string): SearxngConfig {
	const path = configPath ?? defaultConfigPath();

	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		throw new Error(
			`config.json not found at ${path}. Run setup.sh to create it.`,
		);
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		throw new Error(
			`config.json at ${path} contains malformed JSON. Please fix the file.`,
		);
	}

	const searxng = parsed.searxng as Record<string, unknown> | undefined;
	if (!searxng) {
		throw new Error(
			`config.json at ${path} is missing the "searxng" section. Run setup.sh.`,
		);
	}

	const port = searxng.port;
	if (typeof port !== "number" || !Number.isFinite(port)) {
		throw new Error(
			`config.json at ${path} is missing a valid "searxng.port". Run setup.sh.`,
		);
	}

	const secretKey = searxng.secretKey;
	if (typeof secretKey !== "string" || secretKey.length === 0) {
		throw new Error(
			`config.json at ${path} is missing a valid "searxng.secretKey". Run setup.sh.`,
		);
	}

	return { port, secretKey };
}
