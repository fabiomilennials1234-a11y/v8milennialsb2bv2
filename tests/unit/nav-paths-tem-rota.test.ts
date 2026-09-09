// @vitest-environment node
/**
 * Guarda de navegação: todo path que a navegação oferece precisa existir em App.tsx.
 *
 * Nasceu de um 404 em produção: `/turbo` era item pai da lateral com dois filhos
 * (Copilot, Automações) e NENHUMA rota. Como o pai "navega E expande no mesmo
 * clique" (SidebarNavItem), clicar no grupo tirava o usuário do layout inteiro —
 * junto com o submenu que ele tentava abrir.
 *
 * Os testes de navegação existentes montam a árvore com paths de mentira, então
 * nenhum deles cruzava a navegação real com as rotas reais. Este cruza: lê o
 * texto dos dois lados, sem renderizar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** `path="/x"` de App.tsx — as rotas declaradas. */
function declaredRoutes(): Set<string> {
  const src = read("src/App.tsx");
  return new Set(
    [...src.matchAll(/path="(\/[^"]*)"/g)]
      .map((m) => m[1])
      // rota curinga e paramétrica não servem de destino nominal
      .filter((p) => !p.includes("*") && !p.includes(":")),
  );
}

/** `path: "/x"` dos modelos de navegação — o que a UI oferece para clicar. */
function navPaths(file: string): string[] {
  return [...read(file).matchAll(/path:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

const NAV_SOURCES = [
  // TopNavigation.tsx morreu na SCRUM-637 (zero imports desde a lateral nova).
  "src/modules/platform/lib/navigation-model.ts",
];

describe("navegação → rotas", () => {
  it("App.tsx declara rota para todo path oferecido pela navegação", () => {
    const routes = declaredRoutes();
    const orphans = new Map<string, string[]>();

    for (const file of NAV_SOURCES) {
      for (const path of navPaths(file)) {
        if (routes.has(path)) continue;
        orphans.set(path, [...(orphans.get(path) ?? []), file]);
      }
    }

    expect(
      Object.fromEntries(orphans),
      "path na navegação sem rota em App.tsx → clicar dá 404",
    ).toEqual({});
  });

  it("/turbo tem destino — o grupo da lateral navega no clique do pai", () => {
    expect(declaredRoutes().has("/turbo")).toBe(true);
  });

  it("lê os dois lados de verdade (controle: paths e rotas foram extraídos)", () => {
    expect(declaredRoutes().size).toBeGreaterThan(30);
    expect(NAV_SOURCES.flatMap(navPaths).length).toBeGreaterThan(10);
  });
});
