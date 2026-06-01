/**
 * site-scraper.ts
 *
 * The Copilot Builder's site grounding. Fetches a company URL and extracts
 * readable text, flagging thin/empty results (typical of JS-rendered SPAs)
 * so the Builder can fall back to asking the user for text or an upload.
 *
 * No external dependency — plain fetch + tag stripping. fetch is injectable
 * for testing.
 *
 * See PRD #544 / Slice #550.
 */

export interface ScrapeResult {
  markdown: string;
  thin: boolean;
}

type FetchLike = (url: string) => Promise<Response>;

/** Below this many characters of readable text, treat the page as thin/SPA. */
const THIN_THRESHOLD = 200;

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function scrapeSite(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<ScrapeResult> {
  let text = "";
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { markdown: "", thin: true };
    text = extractText(await res.text());
  } catch {
    // Network/parse failure → treat as thin so the Builder falls back to
    // asking the user for text or an upload, instead of crashing the turn.
    return { markdown: "", thin: true };
  }
  return { markdown: text, thin: text.length < THIN_THRESHOLD };
}
