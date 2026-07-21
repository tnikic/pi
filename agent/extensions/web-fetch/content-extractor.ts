import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  bulletListMarker: "-",
});

export function convertHtmlToMarkdown(html: string): string {
  if (!html) return "";
  // Strip non-content elements before converting
  const cleaned = stripNonContent(html);
  return turndown.turndown(cleaned);
}

export interface PageMetadata {
  title: string;
  description: string;
}

export function extractMetadata(html: string, url: string): PageMetadata {
  const title = extractTitle(html, url);
  const description = extractDescription(html);
  return { title, description };
}

function extractTitle(html: string, fallbackUrl: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return fallbackUrl;
  return stripTags(match[1]).trim() || fallbackUrl;
}

function extractDescription(html: string): string {
  const match = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  );
  if (!match) return "";
  return match[1].trim();
}

function stripNonContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
