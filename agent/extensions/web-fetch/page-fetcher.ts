import { extractMetadata } from "./content-extractor.ts";

export interface FetchedPage {
	html: string;
	title: string;
	description: string;
}

interface Page {
	goto(
		url: string,
		options?: { timeout?: number },
	): Promise<{
		ok(): boolean;
		status(): number;
	} | null>;
	content(): Promise<string>;
	close(): Promise<void>;
}

interface Browser {
	newPage(): Promise<Page>;
}

export async function fetchPageContent(
	url: string,
	browser: Browser,
	timeoutMs: number = 15000,
): Promise<FetchedPage> {
	const page = await browser.newPage();
	try {
		const response = await page.goto(url, { timeout: timeoutMs });

		if (!response) {
			throw new Error(`Navigation aborted for ${url}`);
		}

		if (!response.ok()) {
			throw new Error(
				`Failed to load page: HTTP ${response.status()} for ${url}`,
			);
		}

		const html = await page.content();
		const meta = extractMetadata(html, url);

		return {
			html,
			title: meta.title,
			description: meta.description,
		};
	} finally {
		await page.close();
	}
}
