import { loadAuth, saveAuth } from "./auth.ts";
import { resolveToken } from "./backend.ts";
import type { BackendConfig, TokenInfo } from "./types.ts";

/** Minimal UI interface used for interactive auth prompts. */
export interface AuthUI {
	confirm(title: string, message: string): Promise<boolean>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
}

/** Context needed for auth resolution. */
export interface AuthPromptContext {
	hasUI: boolean;
	ui: AuthUI;
	authPath?: string;
}

// ─── @me username cache ─────────────────────────────────────────

const meCache = new Map<string, string>();

export function clearMeCache(): void {
	meCache.clear();
}

/** Resolve @me to the authenticated username. Cached per-session. */
export async function resolveMeUsername(
	backend: BackendConfig,
	token: TokenInfo,
	fetchFn: typeof fetch = fetch,
): Promise<string> {
	const cacheKey = `${backend.type}:${backend.instanceUrl}`;
	const cached = meCache.get(cacheKey);
	if (cached) return cached;

	if (backend.type === "local") {
		return token.username ?? "me";
	}

	const url =
		backend.type === "github"
			? "https://api.github.com/user"
			: backend.type === "gitlab"
				? `${backend.instanceUrl}/api/v4/user`
				: `${backend.instanceUrl}/api/v1/user`;

	const authHeader =
		backend.type === "github" || backend.type === "gitlab"
			? `Bearer ${token.token}`
			: `token ${token.token}`;

	const res = await fetchFn(url, {
		headers: { Authorization: authHeader },
	});
	if (!res.ok) {
		throw new Error(`Failed to resolve @me: ${res.status}`);
	}
	const data = (await res.json()) as Record<string, unknown>;
	const username = data.login as string;
	meCache.set(cacheKey, username);
	return username;
}

// ─── Interactive auth prompts ───────────────────────────────────

/**
 * Ensure auth credentials are available for the given backend.
 * Tries stored auth first; if missing and UI is available, prompts the user.
 */
export async function ensureAuth(
	backend: BackendConfig,
	ctx: AuthPromptContext,
): Promise<TokenInfo> {
	const auth = loadAuth(ctx.authPath);
	const resolved = resolveToken(auth, backend);
	if (resolved) return resolved;

	if (!ctx.hasUI) {
		throw new Error(
			`No ${backend.type} auth configured. Run pi in interactive mode to set it up.`,
		);
	}

	if (backend.type === "local") {
		return await promptLocal(ctx, auth);
	}

	if (backend.type === "github") {
		return await promptGitHub(ctx, auth);
	}

	const host = new URL(backend.instanceUrl).host;

	if (backend.type === "gitlab") {
		return await promptGitLab(ctx, auth, host, backend.instanceUrl);
	}

	return await promptForgejo(ctx, auth, host, backend.instanceUrl);
}

// ─── Per-backend prompt helpers ─────────────────────────────────

async function promptLocal(
	ctx: AuthPromptContext,
	auth: ReturnType<typeof loadAuth>,
): Promise<TokenInfo> {
	const username = await ctx.ui.input(
		"Local tracker username:",
		"Your name for local issue comments",
	);
	if (!username) throw new Error("Local username is required");
	auth.local = { username };
	saveAuth(auth, ctx.authPath);
	return { username };
}

async function promptGitHub(
	ctx: AuthPromptContext,
	auth: ReturnType<typeof loadAuth>,
): Promise<TokenInfo> {
	const ok = await ctx.ui.confirm(
		"GitHub auth required",
		"No GitHub token found. Set one up now?",
	);
	if (!ok) throw new Error("GitHub token is required");
	const token = await ctx.ui.input(
		"GitHub personal access token:",
		"ghp_xxxx...",
	);
	if (!token) throw new Error("GitHub token is required");
	auth.github = { token };
	saveAuth(auth, ctx.authPath);
	return { token, instanceUrl: "https://api.github.com" };
}

async function promptGitLab(
	ctx: AuthPromptContext,
	auth: ReturnType<typeof loadAuth>,
	host: string,
	instanceUrl: string,
): Promise<TokenInfo> {
	const ok = await ctx.ui.confirm(
		"GitLab auth required",
		`No token found for ${host}. Set one up now?`,
	);
	if (!ok) throw new Error("GitLab token is required");
	const token = await ctx.ui.input(
		`GitLab personal access token for ${host}:`,
		"glpat-xxxx...",
	);
	if (!token) throw new Error("GitLab token is required");
	auth.gitlab = auth.gitlab ?? {};
	auth.gitlab[host] = { token, instance_url: instanceUrl };
	saveAuth(auth, ctx.authPath);
	return { token, instanceUrl };
}

async function promptForgejo(
	ctx: AuthPromptContext,
	auth: ReturnType<typeof loadAuth>,
	host: string,
	instanceUrl: string,
): Promise<TokenInfo> {
	const ok = await ctx.ui.confirm(
		"Forgejo auth required",
		`No token found for ${host}. Set one up now?`,
	);
	if (!ok) throw new Error("Forgejo token is required");
	const token = await ctx.ui.input(
		`Forgejo token for ${host}:`,
		"Paste token here",
	);
	if (!token) throw new Error("Forgejo token is required");
	auth.forgejo = auth.forgejo ?? {};
	auth.forgejo[host] = { token, instance_url: instanceUrl };
	saveAuth(auth, ctx.authPath);
	return { token, instanceUrl };
}
