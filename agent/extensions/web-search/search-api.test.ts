import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSearchParams, searchSearxNG } from "./search-api.ts";

describe("buildSearchParams", () => {
  it("always includes format=json", () => {
    const params = buildSearchParams("anything");
    assert.strictEqual(params.get("format"), "json");
  });

  it("maps query to q parameter", () => {
    const params = buildSearchParams("typescript async");
    assert.strictEqual(params.get("q"), "typescript async");
  });

  it("defaults category to general", () => {
    const params = buildSearchParams("typescript");
    assert.strictEqual(params.get("categories"), "general");
  });

  it("overrides category when specified", () => {
    const params = buildSearchParams("typescript", { category: "news" });
    assert.strictEqual(params.get("categories"), "news");
  });

  it("omits time_range when not specified", () => {
    const params = buildSearchParams("typescript");
    assert.strictEqual(params.has("time_range"), false);
  });

  it("includes time_range when specified", () => {
    const params = buildSearchParams("typescript", { timeRange: "week" });
    assert.strictEqual(params.get("time_range"), "week");
  });

  it("combines category and timeRange", () => {
    const params = buildSearchParams("typescript", {
      category: "news",
      timeRange: "day",
    });
    assert.strictEqual(params.get("categories"), "news");
    assert.strictEqual(params.get("time_range"), "day");
  });

  it("handles empty options object", () => {
    const params = buildSearchParams("typescript", {});
    assert.strictEqual(params.get("q"), "typescript");
    assert.strictEqual(params.get("format"), "json");
    assert.strictEqual(params.get("categories"), "general");
  });
});

// Helper: create a mock fetch returning a Response
function mockFetcher(body: unknown, status = 200): (url: string) => Promise<Response> {
  return async (_url: string) => {
    return new Response(JSON.stringify(body), { status });
  };
}

describe("searchSearxNG", () => {
  const baseUrl = "http://localhost:59999";

  it("parses a valid SearXNG response", async () => {
    const rawResults = {
      results: [
        {
          title: "TypeScript Docs",
          url: "https://www.typescriptlang.org",
          content: "TypeScript is JavaScript with syntax for types.",
          engine: "google",
        },
        {
          title: "Wikipedia: TypeScript",
          url: "https://en.wikipedia.org/wiki/TypeScript",
          content: "TypeScript is a free and open-source programming language.",
          engine: "wikipedia",
        },
      ],
      number_of_results: 2500,
    };

    const response = await searchSearxNG(
      "typescript",
      { category: "general" },
      baseUrl,
      mockFetcher(rawResults),
    );

    assert.strictEqual(response.results.length, 2);

    const first = response.results[0];
    assert.strictEqual(first.title, "TypeScript Docs");
    assert.strictEqual(first.url, "https://www.typescriptlang.org");
    assert.strictEqual(first.snippet, "TypeScript is JavaScript with syntax for types.");
    assert.strictEqual(first.engine, "google");
  });

  it("maps snippet from content field", async () => {
    const raw = {
      results: [{ title: "X", url: "/x", content: "snippet text", engine: "brave" }],
      number_of_results: 1,
    };

    const response = await searchSearxNG("x", {}, baseUrl, mockFetcher(raw));
    assert.strictEqual(response.results[0].snippet, "snippet text");
  });

  it("handles empty results array", async () => {
    const raw = { results: [], number_of_results: 0 };
    const response = await searchSearxNG("noresults", {}, baseUrl, mockFetcher(raw));
    assert.strictEqual(response.results.length, 0);
  });

  it("throws on non-200 response", async () => {
    const badFetcher = mockFetcher({ error: "server error" }, 500);
    await assert.rejects(
      () => searchSearxNG("q", {}, baseUrl, badFetcher),
      /SearXNG request failed.*500/,
    );
  });

  it("throws on malformed JSON response", async () => {
    const brokenFetcher = async () => new Response("not json", { status: 200 });
    await assert.rejects(
      () => searchSearxNG("q", {}, baseUrl, brokenFetcher),
      /Failed to parse/,
    );
  });
});
