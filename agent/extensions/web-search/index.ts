import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSearxngConfig } from "../shared/config.ts";
import { type SearchOptions, searchSearxNG } from "./search-api.ts";

const DEFAULT_COUNT = 10;
const MAX_COUNT = 50;

function getBaseUrl(): string {
	return `http://localhost:${getSearxngConfig().port}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for pages matching a query. " +
			"Returns titles, URLs, and snippets from a self-hosted SearXNG metasearch engine. " +
			"Results are aggregated from multiple engines (Google, Bing, DuckDuckGo, etc.).",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			category: Type.Optional(
				Type.Union([
					Type.Literal("general"),
					Type.Literal("news"),
					Type.Literal("images"),
					Type.Literal("academic"),
					Type.Literal("videos"),
				]),
			),
			timeRange: Type.Optional(
				Type.Union([
					Type.Literal("day"),
					Type.Literal("week"),
					Type.Literal("month"),
					Type.Literal("year"),
				]),
			),
			count: Type.Optional(
				Type.Number({
					description: `Number of results to return (default ${DEFAULT_COUNT}, max ${MAX_COUNT})`,
					minimum: 1,
					maximum: MAX_COUNT,
					default: DEFAULT_COUNT,
				}),
			),
		}),
		promptSnippet: "Search the web using self-hosted SearXNG",
		async execute(_toolCallId, params, _signal, _onUpdate) {
			const baseUrl = getBaseUrl();

			// Check reachability
			try {
				const healthResponse = await fetch(`${baseUrl}/healthz`);
				if (!healthResponse.ok) {
					return {
						content: [
							{
								type: "text",
								text:
									`SearXNG instance at ${baseUrl} is unhealthy. ` +
									`Check that the container "pi-searxng" is running correctly.`,
							},
						],
						isError: true,
					};
				}
			} catch {
				return {
					content: [
						{
							type: "text",
							text:
								`SearXNG instance is not reachable at ${baseUrl}. ` +
								`Run "setup.sh" or check your Podman container "pi-searxng".`,
						},
					],
					isError: true,
				};
			}

			// Execute search
			try {
				const options: SearchOptions = {
					category: params.category,
					timeRange: params.timeRange,
				};

				const response = await searchSearxNG(params.query, options, baseUrl);

				// Apply client-side result count limit
				const limit = (params.count as number) ?? DEFAULT_COUNT;
				const results = response.results.slice(0, limit);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ results }, null, 2),
						},
					],
					details: { results },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Search failed: ${(error as Error).message}`,
						},
					],
					isError: true,
				};
			}
		},
	});
}
