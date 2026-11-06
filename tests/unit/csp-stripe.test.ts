// @vitest-environment node
/**
 * A CSP mora em 3 lugares (meta do index.html, nginx do Dockerfile, headers.json da
 * Cloudflare). Faltando a Stripe em um só, o sintoma é o cartão que não carrega depois do
 * deploy, e a requisição nem sai do navegador.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import headers from "../../cloudflare/headers.json";

const root = resolve(__dirname, "../..");
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");

const metaCsp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(indexHtml)![1]!;
const dockerCsp = /add_header Content-Security-Policy \\"(default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'[^"]+)\\" always/.exec(dockerfile)![1]!;
const cloudflareCsp = headers.profiles.app["Content-Security-Policy"];

function directive(csp: string, name: string): string[] {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`, "i").exec(csp);
  return m ? m[1]!.trim().split(/\s+/) : [];
}

describe.each([
  ["index.html", metaCsp],
  ["Dockerfile", dockerCsp],
  ["cloudflare/headers.json", cloudflareCsp],
])("%s", (_nome, csp) => {
  it("script-src libera o Stripe.js", () => {
    expect(directive(csp, "script-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com"]));
  });
  it("frame-src libera Elements e o 3DS", () => {
    expect(directive(csp, "frame-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"]));
  });
  it("connect-src libera a API da Stripe", () => {
    expect(directive(csp, "connect-src")).toContain("https://api.stripe.com");
  });
  it("nada de curinga aberto na Stripe", () => {
    expect(csp).not.toMatch(/https:\/\/\*\.stripe\.com/);
  });
});

describe("Permissions-Policy", () => {
  it("segue payment=() : wallets desligadas no Element", () => {
    expect(headers.profiles.app["Permissions-Policy"]).toContain("payment=()");
  });
});
