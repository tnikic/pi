export interface SearchOptions {
  category?: "general" | "news" | "images" | "academic" | "videos";
  timeRange?: "day" | "week" | "month" | "year";
}

export function buildSearchParams(
  query: string,
  options?: SearchOptions,
): URLSearchParams {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories: options?.category ?? "general",
  });

  if (options?.timeRange) {
    params.set("time_range", options.timeRange);
  }

  return params;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export async function searchSearxNG(
  query: string,
  options: SearchOptions,
  baseUrl: string,
  fetcher: (url: string) => Promise<Response> = fetch as (url: string) => Promise<Response>,
): Promise<SearchResponse> {
  const params = buildSearchParams(query, options);
  const url = `${baseUrl}/search?${params.toString()}`;
  const response = await fetcher(url);

  if (!response.ok) {
    throw new Error(
      `SearXNG request failed with status ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Failed to parse SearXNG response as JSON");
  }

  const data = body as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
    }>;
    number_of_results?: number;
  };

  const results: SearchResult[] = (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    engine: r.engine ?? "unknown",
  }));

  return { results };
}
