/**
 * site-scraper.test.ts
 *
 * TDD for PRD #544 / Slice #550 — the Builder's site grounding. scrapeSite
 * fetches a company URL and extracts readable text, flagging thin/empty
 * (SPA shell) results so the Builder can fall back to asking for text/upload.
 * No external dependency — fetch + tag stripping.
 */

import { describe, it, expect } from "vitest";
import { scrapeSite } from "../../supabase/functions/_shared/site-scraper.ts";

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

const RICH_HTML = `
<!doctype html><html><head><title>Natuplast</title>
<style>.x{color:red}</style><script>var a=1;</script></head>
<body>
  <nav>Home Sobre Contato</nav>
  <main>
    <h1>Natuplast — Industria de Embalagens Plasticas</h1>
    <p>Fabricamos embalagens plasticas sob medida para industrias de alimentos,
    cosmeticos e quimicos desde 1998. Atendemos todo o Brasil com producao propria,
    controle de qualidade rigoroso e prazos competitivos.</p>
  </main>
</body></html>`;

describe("scrapeSite", () => {
  it("extracts readable text from rich HTML and marks it not thin", async () => {
    const result = await scrapeSite("https://natuplast.com.br", async () =>
      htmlResponse(RICH_HTML),
    );

    expect(result.thin).toBe(false);
    expect(result.markdown).toContain("Embalagens Plasticas");
    expect(result.markdown).toContain("sob medida");
    // Stripped noise
    expect(result.markdown).not.toContain("var a=1");
    expect(result.markdown).not.toContain("color:red");
  });

  it("flags a JS-rendered SPA shell as thin", async () => {
    const SPA = `<!doctype html><html><body><div id="root"></div><script>renderApp();</script></body></html>`;

    const result = await scrapeSite("https://spa.example", async () => htmlResponse(SPA));

    expect(result.thin).toBe(true);
  });

  it("returns thin without throwing when the fetch fails", async () => {
    const result = await scrapeSite("https://down.example", async () => {
      throw new Error("network down");
    });

    expect(result.thin).toBe(true);
    expect(result.markdown).toBe("");
  });

  it("treats a non-200 response as thin even with a long error body", async () => {
    const longError =
      "<html><body><h1>404 Not Found</h1><p>" +
      "Pagina inexistente. ".repeat(40) +
      "</p></body></html>";

    const result = await scrapeSite("https://nf.example", async () =>
      new Response(longError, { status: 404, headers: { "content-type": "text/html" } }),
    );

    expect(result.thin).toBe(true);
  });
});
