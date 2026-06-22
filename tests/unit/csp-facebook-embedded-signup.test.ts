import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard — Meta WhatsApp Embedded Signup needs the Facebook JS SDK
 * (connect.facebook.net) allowed by CSP. The CSP is duplicated in TWO places:
 *   1. index.html  <meta http-equiv="Content-Security-Policy">
 *   2. Dockerfile  nginx add_header Content-Security-Policy
 * Both are enforced by the browser (most restrictive wins per directive), so
 * fixing only one silently leaves the SDK blocked ("Falha ao carregar o SDK do
 * Facebook"). This test fails if either source drops the required FB origins.
 */

const ROOT = resolve(__dirname, "..", "..");
const indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf8");
const dockerfile = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");

// Required origins for Embedded Signup, per directive.
const REQUIRED: Record<string, string[]> = {
  "script-src": ["https://connect.facebook.net"],
  "frame-src": [
    "https://www.facebook.com",
    "https://staticxx.facebook.com",
    "https://connect.facebook.net",
  ],
  "connect-src": ["https://graph.facebook.com", "https://www.facebook.com"],
};

/** Extracts a directive's value from a CSP string (single-line or multi-line). */
function directive(csp: string, name: string): string {
  const m = csp.match(new RegExp(`${name}([^;]*)`, "i"));
  return m ? m[1] : "";
}

function metaCsp(): string {
  const m = indexHtml.match(/Content-Security-Policy"\s+content="([\s\S]*?)"/i);
  expect(m, "index.html must contain a meta CSP").toBeTruthy();
  return m![1];
}

function nginxCsp(): string {
  // The Dockerfile embeds the CSP inside an escaped add_header string.
  const m = dockerfile.match(/Content-Security-Policy \\"([\s\S]*?)\\"/i);
  expect(m, "Dockerfile must contain an nginx CSP").toBeTruthy();
  return m![1];
}

describe("CSP allows Facebook Embedded Signup origins", () => {
  for (const [source, getCsp] of [
    ["index.html meta", metaCsp],
    ["Dockerfile nginx", nginxCsp],
  ] as const) {
    describe(source, () => {
      for (const [dir, origins] of Object.entries(REQUIRED)) {
        for (const origin of origins) {
          it(`${dir} allows ${origin}`, () => {
            expect(directive(getCsp(), dir)).toContain(origin);
          });
        }
      }
    });
  }
});
