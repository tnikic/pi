/**
 * TOON result formatter — barrel re-export.
 *
 * Split into three focused modules (Candidate 3):
 *   - status.ts          — displayStatus, isFailedResult, formatUsageAggregate
 *   - toon-serialize.ts  — formatTokens, toonQuote, formatSingleToon,
 *                          formatErrorToon, formatParallelToon, formatChainToon,
 *                          formatAvailableAgents
 *   - display-helpers.ts — formatUsageStats, formatToolCall, getFinalOutput,
 *                          getDisplayItems
 *
 * Prefer importing directly from the specific module.
 */

export type { DisplayItem } from "./display-helpers.ts";
export {
	formatToolCall,
	formatUsageStats,
	getDisplayItems,
	getFinalOutput,
} from "./display-helpers.ts";
export type { UsageAggregate } from "./status.ts";
export {
	displayStatus,
	formatUsageAggregate,
	isFailedResult,
} from "./status.ts";
export type { SubagentResult, SubagentUsage } from "./toon-serialize.ts";
export {
	formatAvailableAgents,
	formatChainToon,
	formatErrorToon,
	formatParallelToon,
	formatSingleToon,
	formatTokens,
	toonQuote,
} from "./toon-serialize.ts";
