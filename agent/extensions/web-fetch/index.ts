import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { chromium } from "playwright";
import { fetchPageContent } from "./page-fetcher.ts";
import { convertHtmlToMarkdown } from "./content-extractor.ts";

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function ensureBrowser(): Promise<typeof browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export default function (pi: ExtensionAPI) {
  // Close browser on pi shutdown
  pi.on("session_shutdown", async () => {
    if (browser && browser.isConnected()) {
      await browser.close();
      browser = null;
    }
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and render a web page using a real browser (Chromium). " +
      "Returns the page content converted to Markdown for readability. " +
      "Handles JavaScript-rendered pages correctly. " +
      "Includes page title, meta description, and word count as metadata.",
    parameters: Type.Object({
      url: Type.String({ description: "URL of the web page to fetch" }),
    }),
    promptSnippet: "Fetch a web page, render JavaScript, and return markdown content",
    async execute(_toolCallId, params, _signal, _onUpdate) {
      try {
        const b = await ensureBrowser();
        const page = await fetchPageContent(params.url, b!);
        const markdown = convertHtmlToMarkdown(page.html);

        // Count words in the markdown output
        const wordCount = markdown.trim().split(/\s+/).length;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  title: page.title,
                  description: page.description,
                  url: params.url,
                  content: markdown,
                  wordCount,
                },
                null,
                2,
              ),
            },
          ],
          details: {
            title: page.title,
            description: page.description,
            url: params.url,
            content: markdown,
            wordCount,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Fetch failed: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
