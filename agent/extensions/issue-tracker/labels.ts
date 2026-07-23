import type { BackendType, Label } from "./types.ts";

/** Separator character for each backend's scoped labels. */
const SCOPE_SEPARATORS: Record<BackendType, string> = {
	github: ":",
	forgejo: "/",
	gitlab: "::",
	local: ":",
};

/**
 * Format a structured Label into a forge-specific string.
 * e.g. {name: "low", scope: "priority"} → "priority:low" (github) or "priority/low" (forgejo)
 */
export function formatLabel(label: Label, backend: BackendType): string {
	if (label.scope) {
		const sep = SCOPE_SEPARATORS[backend];
		return `${label.scope}${sep}${label.name}`;
	}
	return label.name;
}

/**
 * Parse a raw label string from a forge API into a structured Label.
 * e.g. "priority:low" → {name: "low", scope: "priority"} (github)
 */
export function parseLabel(raw: string, backend: BackendType): Label {
	const sep = SCOPE_SEPARATORS[backend];
	const index = raw.indexOf(sep);
	if (index !== -1) {
		return {
			scope: raw.slice(0, index),
			name: raw.slice(index + sep.length),
		};
	}
	return { name: raw };
}

/**
 * Convert a #-prefixed color (LLM-facing) to the API format.
 * GitHub API wants unprefixed colors, Forgejo wants #-prefixed.
 */
export function toApiColor(color: string, backend: BackendType): string {
	if (backend === "github" && color.startsWith("#")) {
		return color.slice(1);
	}
	return color;
}

/**
 * Convert an API color to the normalized #-prefixed format (LLM-facing).
 * GitHub and Forgejo APIs return unprefixed colors (e.g. "d73a4a").
 */
export function fromApiColor(
	color: string | undefined,
	backend: BackendType,
): string | undefined {
	if (color === undefined) return undefined;
	if (color === "") return "";
	if (
		(backend === "github" || backend === "forgejo" || backend === "gitlab") &&
		!color.startsWith("#")
	) {
		return `#${color}`;
	}
	return color;
}
