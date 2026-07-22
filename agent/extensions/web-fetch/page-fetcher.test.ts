import assert from "node:assert";
import { describe, it } from "node:test";
import { fetchPageContent } from "./page-fetcher.ts";

// Minimal mock of Playwright's Browser and Page — only what fetchPageContent uses
function mockBrowser(htmlContent: string, status = 200) {
	return {
		newPage: async () => ({
			goto: async (_url: string) => ({
				ok: () => status >= 200 && status < 300,
				status: () => status,
			}),
			content: async () => htmlContent,
			close: async () => {},
		}),
	};
}

describe("fetchPageContent", () => {
	it("returns HTML content from a page", async () => {
		const html =
			"<html><head><title>Test Page</title></head><body><p>Hello.</p></body></html>";
		const browser = mockBrowser(html);

		const result = await fetchPageContent("https://example.com", browser);

		assert.match(result.html, /Test Page/);
		assert.match(result.html, /<p>Hello\.<\/p>/);
	});

	it("extracts title from the HTML", async () => {
		const html =
			'<html><head><title>My Title</title><meta name="description" content="desc"></head><body></body></html>';
		const browser = mockBrowser(html);

		const result = await fetchPageContent("https://example.com", browser);

		assert.strictEqual(result.title, "My Title");
	});

	it("extracts meta description", async () => {
		const html =
			'<html><head><title>T</title><meta name="description" content="A summary."></head><body></body></html>';
		const browser = mockBrowser(html);

		const result = await fetchPageContent("https://example.com", browser);

		assert.strictEqual(result.description, "A summary.");
	});

	it("throws on non-OK response", async () => {
		const browser = mockBrowser("<html></html>", 404);

		await assert.rejects(
			() => fetchPageContent("https://example.com", browser, 5000),
			/Failed to load page.*404/,
		);
	});

	it("throws on aborted navigation (null response)", async () => {
		const browser = {
			newPage: async () => ({
				goto: async (_url: string) => null,
				content: async () => "<html></html>",
				close: async () => {},
			}),
		};

		await assert.rejects(
			() => fetchPageContent("https://example.com", browser),
			/Navigation aborted/,
		);
	});
});
