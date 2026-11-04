// @vitest-environment node
/**
 * O SW não pode assumir requisição de outra origem nem de landing page: o `fetch` dentro dele obedece à CSP do
 * app e derruba com 503 o que a CSP da página permite (agenda do Cal.com e Meta Pixel nas LPs).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAppOwnedRequest, isLandingPath } from "@/shared/pwa/runtime-routes";

const ROOT = path.resolve(__dirname, "../..");
const ORIGIN = "https://torquecrm.com.br";
const owned = (url: string) => isAppOwnedRequest(new URL(url), ORIGIN);

describe("isAppOwnedRequest", () => {
  it.each([
    "https://app.cal.com/embed/embed.js",
    "https://connect.facebook.net/en_US/fbevents.js",
    "https://www.facebook.com/tr?id=1&ev=PageView",
    "https://fonts.googleapis.com/css2?family=Inter",
    "https://fonts.gstatic.com/s/x.woff2",
    "https://jsjsmuncfkbsbzqzqhfq.supabase.co/storage/v1/object/public/a.png",
    "https://www.torquecrm.com.br/assets/index.js",
    "http://torquecrm.com.br/assets/index.js",
  ])("outra origem fica de fora: %s", (url) => {
    expect(owned(url)).toBe(false);
  });

  it.each([
    "/lp",
    "/lp/",
    "/lp/gestao-comercial/",
    "/lp/_shared/lp.js?v=1",
    "/lp/_shared/torque-lp-v5.css",
    "/lp/crm-b2b/assets/TORQUE_Logo_Icone.png",
  ])("landing page fica de fora: %s", (pathname) => {
    expect(owned(ORIGIN + pathname)).toBe(false);
  });

  it.each(["/assets/index-abc.js", "/assets/x.css", "/pwa-192x192.png", "/lpx/a.js", "/lp-antiga.png", "/assets/lp/a.js"])(
    "o que é do app continua: %s",
    (pathname) => {
      expect(owned(ORIGIN + pathname)).toBe(true);
    },
  );

  it("isLandingPath não casa prefixo parecido", () => {
    expect(isLandingPath("/lpx")).toBe(false);
    expect(isLandingPath("/lp/x")).toBe(true);
  });
});

describe("configuração", () => {
  const sw = fs.readFileSync(path.join(ROOT, "src/sw.ts"), "utf8");
  const vite = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");

  it("toda rota por destination passa pela guarda; as de Supabase seguem por URL", () => {
    const destino = [...sw.matchAll(/registerRoute\(\s*\(\{([^}]*)\}\)\s*=>([\s\S]*?),\s*new /g)];
    const estaticas = destino.filter((m) => m[2]!.includes("request.destination"));
    expect(estaticas).toHaveLength(2);
    for (const rota of estaticas) expect(rota[2]).toContain("isAppOwnedRequest(url, self.location.origin)");
    for (const p of ["rest\\/v1", "auth", "functions"]) expect(sw).toContain(`/\\.supabase\\.co\\/${p}\\//.test(url.href)`);
  });

  it("lp/** fica fora do manifesto, junto com o que já era ignorado", () => {
    const linha = vite.match(/globIgnores:\s*\[([^\]]*)\]/)?.[1] ?? "";
    for (const padrao of ["'**/*.html'", "'**/noto-color-emoji-*'", "'lp/**'"]) expect(linha).toContain(padrao);
  });

  it("o SW continua com precache, atualização por prompt e push", () => {
    expect(sw).toContain("precacheAndRoute(precacheManifest)");
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'");
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("addEventListener('notificationclick'");
  });
});
