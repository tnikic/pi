/**
 * Pure orchestration helpers extracted from index.ts.
 *
 * These functions were previously inline in the execute() closure
 * and reimplemented by tests. Now they are importable directly.
 */

/**
 * Validate that exactly one execution mode is specified.
 * Returns an error message or null if valid.
 */
export function validateModes(
	hasChain: boolean,
	hasTasks: boolean,
	hasSingle: boolean,
): string | null {
	const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
	return modeCount !== 1
		? "Invalid parameters. Provide exactly one mode."
		: null;
}
