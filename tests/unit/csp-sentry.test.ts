/**
 * A CSP tem que deixar o Sentry sair do navegador (ADR-0038, S6).
 *
 * São duas CSPs e o navegador aplica AS DUAS: a meta tag do `index.html` e o
 * header do nginx (`Dockerfile`). Até a S6, o nginx liberava `*.sentry.io` e a
 * meta não — o envio seria barrado antes de sair, sem erro visível em lugar
 * nenhum, e o painel do Sentry ficaria vazio parecendo "sem defeitos". Mesmo
 * sintoma enganoso do `csp-torquecalls-voice.test.ts`.
 *
 * `worker-src blob:` é o worker de compressão do replay, criado a partir de um
 * blob. Sem ele o replay cai para compressão na thread principal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");

function directive(csp: string, name: string): string {
  const m = csp.match(new RegExp(`${name}([^;]*)`, "i"));
  return m ? m[1] : "";
}

/** Fonte como token da diretiva, não substring — ver csp-torquecalls-voice. */
function hasSource(csp: string, name: string, source: string): boolean {
  return directive(csp, name).trim().split(/\s+/).includes(source);
}

function metaCsp(): string {
  const m = indexHtml.match(/Content-Security-Policy"\s+content="([\s\S]*?)"/i);
  expect(m, "index.html precisa ter a meta CSP").toBeTruthy();
  return m![1];
}

function nginxCsp(): string {
  const m = dockerfile.match(/Content-Security-Policy\s+\\"([\s\S]*?)\\"\s+always/i);
  expect(m, "Dockerfile precisa ter o header CSP do nginx").toBeTruthy();
  return m![1];
}

describe.each([
  ["meta do index.html", metaCsp],
  ["header do nginx", nginxCsp],
])("CSP do Sentry — %s", (_label, csp) => {
  it("connect-src libera o ingest do Sentry", () => {
    expect(hasSource(csp(), "connect-src", "https://*.sentry.io")).toBe(true);
  });

  it("worker-src libera o worker do replay (blob:) e mantém o service worker ('self')", () => {
    expect(hasSource(csp(), "worker-src", "blob:")).toBe(true);
    expect(hasSource(csp(), "worker-src", "'self'")).toBe(true);
  });
});
