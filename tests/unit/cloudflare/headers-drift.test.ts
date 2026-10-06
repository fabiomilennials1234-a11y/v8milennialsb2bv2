// @vitest-environment node
/**
 * Enquanto o nginx continuar servindo produção, cloudflare/headers.json tem de
 * dizer exatamente o que o Dockerfile diz. Mudou a CSP de um lado só? Este
 * teste quebra — e a paridade não precisa ser rodada para descobrir.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../cloudflare/headers.json";
import { MAX_HEADER_LINE, renderAssetsIgnore, renderHeadersFile } from "../../../scripts/cloudflare/prepare-assets.mjs";

const dockerfile = fs.readFileSync(path.resolve(__dirname, "../../../Dockerfile"), "utf8");

/** Os `add_header Nome "valor" always;` de um trecho do Dockerfile, na ordem. */
function addHeaders(fragment: string): [string, string][] {
  return [...fragment.matchAll(/add_header ([A-Za-z-]+) \\?"(.*?)\\?" always;/g)].map((m) => [m[1]!, m[2]!]);
}

function between(start: string, end: string): string {
  const from = dockerfile.indexOf(start);
  const to = dockerfile.indexOf(end, from);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return dockerfile.slice(from, to);
}

describe("headers.json == Dockerfile", () => {
  it("perfil app = security-headers.conf (7 headers, na ordem)", () => {
    const fragment = between("'add_header X-Content-Type-Options", "> /etc/nginx/security-headers.conf");
    const expected = addHeaders(fragment);
    expect(expected).toHaveLength(7);
    expect(Object.entries(config.profiles.app)).toEqual(expected);
  });

  it("perfil lp = lp-headers.conf (6 headers, sem X-XSS-Protection)", () => {
    const fragment = between("> /etc/nginx/security-headers.conf", "> /etc/nginx/lp-headers.conf");
    const expected = addHeaders(fragment);
    expect(expected).toHaveLength(6);
    expect(Object.entries(config.profiles.lp)).toEqual(expected);
    expect(config.profiles.lp).not.toHaveProperty("X-XSS-Protection");
  });

  it("políticas de cache = os Cache-Control de cada location", () => {
    const cacheOf = (location: string) => {
      const block = between(location, "  }'");
      const values = addHeaders(block).filter(([name]) => name === "Cache-Control").map(([, value]) => value);
      expect(values, location).toHaveLength(1);
      return values[0];
    };
    expect(cacheOf("location ~* ^/assets/")).toBe(config.cache.immutable);
    expect(cacheOf("location ^~ /lp/")).toBe(config.cache.landing);
    for (const exact of ["location = /sobre", "location = /privacidade", "location = / ", "location = /index.html", "location = /sw.js", "  location / {"]) {
      expect(cacheOf(exact)).toBe(config.cache.noStore);
    }
  });
});

describe("_headers gerado", () => {
  const rendered: string = renderHeadersFile(config);
  const lines = rendered.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));

  it("tem uma regra só, /assets/*", () => {
    const rules = lines.filter((line) => !line.startsWith(" "));
    expect(rules).toEqual(["/assets/*"]);
  });

  it("cada header aparece uma vez: app inteiro + cache imutável", () => {
    const headers = lines.filter((line) => line.startsWith("  ")).map((line) => line.trim().split(": ")[0]);
    expect(headers).toEqual([...Object.keys(config.profiles.app), "Cache-Control"]);
    expect(rendered).toContain(`  Content-Security-Policy: ${config.profiles.app["Content-Security-Policy"]}\n`);
    expect(rendered).toContain(`  Cache-Control: ${config.cache.immutable}\n`);
    expect(rendered).not.toContain(config.profiles.lp["Content-Security-Policy"]);
  });

  it("toda linha abaixo do limite de 2000 caracteres", () => {
    expect(MAX_HEADER_LINE).toBe(2000);
    for (const line of rendered.split("\n")) expect(line.length).toBeLessThan(MAX_HEADER_LINE);
  });

  it("recusa linha longa demais em vez de gerar um _headers que a Cloudflare trunca", () => {
    const huge = structuredClone(config);
    huge.profiles.app["Content-Security-Policy"] = "x".repeat(2000);
    expect(() => renderHeadersFile(huge)).toThrow(/limite 2000/);
  });

  it(".assetsignore deixa source map e dotfile fora do upload, menos .well-known", () => {
    const ignore: string = renderAssetsIgnore();
    const patterns = ignore.split("\n").filter((line) => line && !line.startsWith("#"));
    expect(patterns).toEqual(["*.map", ".*", "!/.well-known"]);
  });
});
