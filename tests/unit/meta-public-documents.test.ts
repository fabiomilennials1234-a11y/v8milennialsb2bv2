// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveRoute } from "../../cloudflare/src/routing";

describe("public Meta verification documents", () => {
  for (const slug of ["termos", "exclusao-de-dados"]) {
    it(`serves /${slug} as HTML on Worker and nginx, without SPA/auth`, () => {
      expect(resolveRoute(new URL(`https://torquecrm.com.br/${slug}`), "GET")).toEqual({ kind: "page", asset: `/${slug}.html` });
      expect(resolveRoute(new URL(`https://torquecrm.com.br/${slug}`), "HEAD")).toEqual({ kind: "page", asset: `/${slug}.html` });
      expect(resolveRoute(new URL(`https://torquecrm.com.br/${slug}/`), "GET")).toEqual({ kind: "page", asset: `/${slug}.html` });
      const docker = readFileSync("Dockerfile", "utf8");
      expect(docker).toContain(`location = /${slug} {`);
      expect(docker).toContain(`try_files /${slug}.html =404;`);
      expect(docker).toContain(`location = /${slug}/ {`);
      const doc = readFileSync(`public/${slug}.html`, "utf8");
      expect(doc).toContain('lang="pt-BR"');
      expect(doc).toContain("54.384.269/0001-48");
      expect(doc).toContain("Gabriel Aurelio Gipp");
      expect(doc).toContain("mailto:acesso@torquecrm.com.br");
      expect(doc).not.toContain("<script");
    });
  }
  it("identifies the same owner in all crawler-visible documents", () => {
    for (const slug of ["sobre", "privacidade", "termos", "exclusao-de-dados"]) {
      const doc = readFileSync(`public/${slug}.html`, "utf8");
      expect(doc).toContain("54.384.269/0001-48");
      expect(doc).toContain("Gabriel Aurelio Gipp");
      expect(doc).toContain("mailto:acesso@torquecrm.com.br");
      expect(doc).not.toContain("58.510.211/0001-54");
      expect(doc).not.toContain("MILENNIALS DIGITAL LTDA");
    }
  });
});
