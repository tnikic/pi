import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthConfig } from "./types.ts";

/** Default path for the auth file. */
export const AUTH_FILE_PATH = join(
	homedir(),
	".pi",
	"agent",
	"issue-tracker-auth.json",
);

/**
 * Load the auth configuration from disk.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export function loadAuth(filePath: string = AUTH_FILE_PATH): AuthConfig {
	if (!existsSync(filePath)) {
		return {};
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		return JSON.parse(raw) as AuthConfig;
	} catch {
		return {};
	}
}

/**
 * Save the auth configuration to disk.
 * Creates parent directories if needed.
 */
export function saveAuth(
	config: AuthConfig,
	filePath: string = AUTH_FILE_PATH,
): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
}
