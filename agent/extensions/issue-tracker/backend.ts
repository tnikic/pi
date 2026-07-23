import { execSync } from "node:child_process";
import { join } from "node:path";
import { forgejoRegistration } from "./backends/forgejo.ts";
import { githubRegistration } from "./backends/github.ts";
import { GITLAB_HOSTS, gitlabRegistration } from "./backends/gitlab.ts";
import { localRegistration } from "./backends/local.ts";
import type {
	AuthConfig,
	Backend,
	BackendConfig,
	BackendRegistration,
	BackendType,
	TokenInfo,
} from "./types.ts";

// ─── Registry ───────────────────────────────────────────────────

const registrations: BackendRegistration[] = [
	githubRegistration,
	gitlabRegistration,
	forgejoRegistration,
	localRegistration,
];

/** Look up a registration by backend type. */
export function getRegistration(type: BackendType): BackendRegistration {
	const reg = registrations.find((r) => r.type === type);
	if (!reg) throw new Error(`Unknown backend type: ${type}`);
	return reg;
}

// ─── Git remote parsing ─────────────────────────────────────────

function getOriginUrl(cwd: string): string | null {
	try {
		return execSync("git remote get-url origin", {
			cwd,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

interface ParsedUrl {
	host: string;
	owner: string;
	repo: string;
}

function parseGitUrl(url: string): ParsedUrl | null {
	// SSH format: git@host:owner/repo.git
	const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/);
	const [, sshHost, sshPath] = sshMatch ?? [];
	if (sshHost && sshPath) {
		const { owner, repo } = splitPath(sshPath);
		return { host: sshHost, owner, repo };
	}

	// HTTPS / git:// format: https://host/owner/repo.git
	const httpsMatch = url.match(
		/^(?:https?|git):\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
	);
	const [, httpsHost, httpsPath] = httpsMatch ?? [];
	if (httpsHost && httpsPath) {
		const { owner, repo } = splitPath(httpsPath);
		return { host: httpsHost, owner, repo };
	}

	return null;
}

function splitPath(path: string): { owner: string; repo: string } {
	const parts = path.split("/");
	if (parts.length < 2) {
		return { owner: "", repo: parts[0] ?? "" };
	}
	const repo = parts.pop() ?? "";
	const owner = parts.join("/");
	return { owner, repo };
}

// ─── Detection ──────────────────────────────────────────────────

export interface DetectedBackend {
	config: BackendConfig;
	backend: Backend;
	registration: BackendRegistration;
}

function localFallback(cwd: string): DetectedBackend {
	return {
		config: {
			type: "local",
			issuesPath: join(cwd, "docs", "issues"),
			owner: "",
			repo: "",
			instanceUrl: "",
		},
		backend: localRegistration.backend,
		registration: localRegistration,
	};
}

function instanceUrl(type: BackendType, host: string): string {
	if (type === "github") return "https://api.github.com";
	if (type === "gitlab") return `https://${host}`;
	return `https://${host}`;
}

/** Cache of probed backend types so we don't hit the API on every call. */
const probeCache = new Map<string, "gitlab" | "forgejo">();

/**
 * Probe a host to distinguish GitLab from Forgejo.
 * Tries GitLab's /api/v4/version endpoint — if it responds with a
 * version object, it's GitLab; otherwise Forgejo.
 */
async function probeBackendType(host: string): Promise<"gitlab" | "forgejo"> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		const res = await fetch(`https://${host}/api/v4/version`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (res.ok) {
			const data = (await res.json()) as Record<string, unknown>;
			if (data.version) return "gitlab";
		}
	} catch (err) {
		console.warn(
			`Backend probe for ${host} failed (assuming Forgejo): ${(err as Error).message}`,
		);
	}
	return "forgejo";
}

/**
 * Detect the backend for the current repository.
 *
 * For hosts that aren't known GitHub or GitLab SaaS instances, this
 * probes the host's API to distinguish self-hosted GitLab from Forgejo.
 * Results are cached in-memory for the session.
 *
 * Returns the BackendConfig, the Backend implementation, and the registration
 * record so callers don't need to look anything up separately.
 */
export async function detectBackend(
	cwd: string,
	remoteUrl?: string,
): Promise<DetectedBackend> {
	const url = remoteUrl ?? getOriginUrl(cwd);
	if (!url) return localFallback(cwd);

	const parsed = parseGitUrl(url);
	if (!parsed) return localFallback(cwd);

	// Walk registrations in order — first match wins.
	for (const reg of registrations) {
		if (reg.detect(parsed.host)) {
			// When forgejo's catch-all fires, probe to distinguish self-hosted
			// GitLab from actual Forgejo instances.  Skip probing when the
			// remote URL was passed explicitly (e.g. in tests).
			let type = reg.type;
			if (
				type === "forgejo" &&
				!remoteUrl &&
				!GITLAB_HOSTS.has(parsed.host) &&
				parsed.host !== "github.com" &&
				parsed.host !== "www.github.com"
			) {
				const cached = probeCache.get(parsed.host);
				type = cached ?? (await probeBackendType(parsed.host));
				probeCache.set(parsed.host, type);
			}

			// Resolve the correct registration for the probed type
			const resolvedReg = type === reg.type ? reg : getRegistration(type);

			return {
				config: {
					type: resolvedReg.type,
					owner: parsed.owner,
					repo: parsed.repo,
					instanceUrl: instanceUrl(resolvedReg.type, parsed.host),
					issuesPath:
						resolvedReg.type === "local"
							? join(cwd, "docs", "issues")
							: undefined,
				},
				backend: resolvedReg.backend,
				registration: resolvedReg,
			};
		}
	}

	return localFallback(cwd);
}

// ─── Auth resolution (delegates to registrations) ───────────────

export function resolveToken(
	auth: AuthConfig,
	config: BackendConfig,
): TokenInfo | null {
	const reg = getRegistration(config.type);
	return reg.resolveToken(auth, config);
}
