import assert from "node:assert";
import { describe, it } from "node:test";
import { convertHtmlToMarkdown, extractMetadata } from "./content-extractor.ts";

describe("convertHtmlToMarkdown", () => {
	it("converts a heading", () => {
		const markdown = convertHtmlToMarkdown("<h1>Hello World</h1>");
		assert.match(markdown, /# Hello World/);
	});

	it("converts a paragraph", () => {
		const markdown = convertHtmlToMarkdown("<p>This is a paragraph.</p>");
		assert.match(markdown, /This is a paragraph/);
	});

	it("converts a link", () => {
		const markdown = convertHtmlToMarkdown(
			'<a href="https://example.com">Example</a>',
		);
		assert.match(markdown, /\[Example\]\(https:\/\/example\.com\)/);
	});

	it("converts an unordered list", () => {
		const markdown = convertHtmlToMarkdown(
			"<ul><li>Item 1</li><li>Item 2</li></ul>",
		);
		assert.match(markdown, /Item 1/);
		assert.match(markdown, /Item 2/);
	});

	it("converts inline code", () => {
		const markdown = convertHtmlToMarkdown(
			"Use <code>const x = 1;</code> for assignment.",
		);
		assert.match(markdown, /`const x = 1;`/);
	});

	it("converts a pre/code block", () => {
		const markdown = convertHtmlToMarkdown(
			"<pre><code>const x = 1;\nconst y = 2;</code></pre>",
		);
		assert.match(markdown, /```/);
		assert.match(markdown, /const x = 1/);
		assert.match(markdown, /const y = 2/);
	});

	it("handles empty input", () => {
		const markdown = convertHtmlToMarkdown("");
		assert.strictEqual(markdown.trim(), "");
	});

	it("strips script tags", () => {
		const markdown = convertHtmlToMarkdown(
			"Hello<script>alert('xss')</script> World",
		);
		assert.doesNotMatch(markdown, /alert/);
		assert.match(markdown, /Hello/);
		assert.match(markdown, /World/);
	});

	it("strips style tags", () => {
		const markdown = convertHtmlToMarkdown(
			"Hello<style>.x { color: red; }</style> World",
		);
		assert.doesNotMatch(markdown, /color: red/);
		assert.match(markdown, /Hello/);
		assert.match(markdown, /World/);
	});
});

describe("extractMetadata", () => {
	it("extracts title from <title> tag", () => {
		const html =
			"<html><head><title>My Page</title></head><body></body></html>";
		const meta = extractMetadata(html, "https://example.com");
		assert.strictEqual(meta.title, "My Page");
	});

	it("extracts description from meta tag", () => {
		const html =
			'<html><head><meta name="description" content="A great page."></head><body></body></html>';
		const meta = extractMetadata(html, "https://example.com");
		assert.strictEqual(meta.description, "A great page.");
	});

	it("uses URL as fallback title when title is missing", () => {
		const html = "<html><head></head><body></body></html>";
		const meta = extractMetadata(html, "https://example.com/page");
		assert.strictEqual(meta.title, "https://example.com/page");
	});

	it("returns empty description when meta tag is missing", () => {
		const html = "<html><head><title>X</title></head><body></body></html>";
		const meta = extractMetadata(html, "https://example.com");
		assert.strictEqual(meta.description, "");
	});

	it("strips HTML tags from title content", () => {
		const html =
			"<html><head><title><b>Bold</b> Title</title></head><body></body></html>";
		const meta = extractMetadata(html, "https://example.com");
		assert.strictEqual(meta.title, "Bold Title");
	});
});
