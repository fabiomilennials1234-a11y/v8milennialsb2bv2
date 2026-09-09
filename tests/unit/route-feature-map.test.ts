/**
 * Consistência nav-cadeado ↔ guard de rota (plan-tiers-cleanup, Task 12).
 *
 * Fonte única: feature-registry. Este teste lê App.tsx e garante que:
 *  1. Todo path de ROUTE_FEATURE_MAP existe como rota e está envolto em
 *     <FeatureRoute feature="<key>"> com a key certa.
 *  2. Todo path de SIDEBAR_FEATURE_MAP (cadeado na nav) ou é redirect
 *     conhecido ou tem entrada correspondente em ROUTE_FEATURE_MAP —
 *     cadeado na nav SEM guard na rota = divergência (contornável via URL).
 *  3. Nenhuma rota usa FeatureRoute com key fora do registry
 *     (guard sem key mapeada = mapa desatualizado).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROUTE_FEATURE_MAP,
  SIDEBAR_FEATURE_MAP,
} from "../../src/modules/platform/lib/feature-registry";

const appSource = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf-8");

// Paths da sidebar que são <Navigate> (redirect) — não têm elemento pra guardar;
// o destino (/dashboard) é core sem feature key.
//
// `/turbo` entra aqui por outro motivo, e mais forte: é rótulo de grupo, não
// tela, e o destino do redirect (`/automacoes`) JÁ carrega
// `FeatureRoute feature="automations"`. A key aqui só alimenta o UpgradeModal
// quando o grupo aparece com cadeado — não há URL a contornar.
const REDIRECT_ONLY_PATHS = new Set(["/marketing", "/analytics", "/chat", "/turbo"]);

/**
 * "/funil" é PREFIXO de navegação (SCRUM-637): os itens da sidebar vivem em
 * /funil/<slug> e o guard de rota correspondente é o da rota única.
 */
const PREFIX_ALIAS: Record<string, string> = { "/funil": "/funil/:slug" };

/** Divide o JSX de rotas em chunks: cada chunk começa em `<Route` e vai até o próximo. */
function routeChunks(): Map<string, string> {
  const chunks = new Map<string, string>();
  const parts = appSource.split(/<Route\s/).slice(1);
  for (const part of parts) {
    const pathMatch = part.match(/path="([^"]+)"/);
    if (!pathMatch) continue;
    // último chunk com o mesmo path vence (não há paths duplicados relevantes no mapa)
    chunks.set(pathMatch[1], part);
  }
  return chunks;
}

const chunks = routeChunks();

describe("ROUTE_FEATURE_MAP ↔ App.tsx", () => {
  it("todo path mapeado existe como rota em App.tsx", () => {
    const missing = Object.keys(ROUTE_FEATURE_MAP).filter((p) => !chunks.has(p));
    expect(missing).toEqual([]);
  });

  it("todo path mapeado está envolto em FeatureRoute com a key certa", () => {
    const unguarded: string[] = [];
    for (const [path, key] of Object.entries(ROUTE_FEATURE_MAP)) {
      const chunk = chunks.get(path);
      if (!chunk || !chunk.includes(`FeatureRoute feature="${key}"`)) {
        unguarded.push(`${path} → ${key}`);
      }
    }
    expect(unguarded).toEqual([]);
  });
});

describe("SIDEBAR_FEATURE_MAP ↔ ROUTE_FEATURE_MAP", () => {
  it("todo path com cadeado na nav tem guard de rota (ou é redirect conhecido)", () => {
    const gaps = Object.entries(SIDEBAR_FEATURE_MAP)
      .filter(([path]) => !REDIRECT_ONLY_PATHS.has(path))
      .filter(([path, key]) => ROUTE_FEATURE_MAP[PREFIX_ALIAS[path] ?? path] !== key)
      .map(([path, key]) => `${path} → ${key}`);
    expect(gaps).toEqual([]);
  });
});

describe("guards em App.tsx ↔ registry", () => {
  it("toda rota com FeatureRoute está em ROUTE_FEATURE_MAP com a mesma key", () => {
    const strays: string[] = [];
    for (const [path, chunk] of chunks) {
      const guardMatch = chunk.match(/FeatureRoute feature="([^"]+)"/);
      if (!guardMatch) continue;
      if (ROUTE_FEATURE_MAP[path] !== guardMatch[1]) {
        strays.push(`${path} guarda "${guardMatch[1]}" mas mapa diz "${ROUTE_FEATURE_MAP[path] ?? "∅"}"`);
      }
    }
    expect(strays).toEqual([]);
  });
});
