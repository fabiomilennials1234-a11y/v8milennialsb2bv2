// @vitest-environment node
/**
 * Carteira em rota própria (CTO 2026-10-16) — guarda de contrato por texto.
 *
 * A Carteira era a aba Clientes de /leads. Saiu para `/carteira`. Este teste
 * cruza as pontas que nenhum teste de componente vê junto: a rota em App.tsx
 * tem as MESMAS guardas de /leads (não fica mais aberta que a aba era), a
 * página de Leads não carrega mais a carteira, e as portas secundárias
 * (paleta, recentes, atalho) apontam para a rota nova.
 *
 * Mesma técnica sancionada de `route-feature-map.test.ts` e
 * `nav-leads-topbar.test.ts`: ler a fonte e afirmar o contrato.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTE_FEATURE_MAP, SIDEBAR_FEATURE_MAP } from "../../src/modules/platform/lib/feature-registry";
import { NAV_VIEW_PERMISSIONS } from "../../src/modules/platform/lib/navigation-model";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const app = read("src/App.tsx");
const leadsPage = read("src/modules/leads/pages/Leads.tsx");

/** O trecho `<Route ... path="X" ... />` de App.tsx, até o próximo `<Route`. */
function routeChunk(path: string): string {
  const part = app.split(/<Route\s/).find((p) => p.match(/path="([^"]+)"/)?.[1] === path);
  if (!part) throw new Error(`rota ${path} não declarada em App.tsx`);
  return part;
}

describe("/carteira em App.tsx herda as guardas de /leads", () => {
  const carteira = routeChunk("/carteira");
  const leads = routeChunk("/leads");

  it("controle: as duas rotas foram lidas", () => {
    expect(leads).toMatch(/<Leads \/>/);
    expect(carteira).toMatch(/<Carteira \/>/);
  });

  it.each([
    ["ProtectedRoute", /<ProtectedRoute>/],
    ["LayoutWrapper", /<LayoutWrapper>/],
    ["permissão leads.view", /PermissionProtectedRoute featureKey="leads\.view"/],
    ["feature leads", /FeatureRoute feature="leads"/],
  ])("tem %s, como /leads", (_nome, re) => {
    expect(leads).toMatch(re);
    expect(carteira).toMatch(re);
  });

  it("NÃO usa a feature `carteira` (a do /upsell legado)", () => {
    expect(carteira).not.toMatch(/feature="carteira"/);
    expect(ROUTE_FEATURE_MAP["/carteira"]).toBe("leads");
    expect(SIDEBAR_FEATURE_MAP["/carteira"]).toBe("leads");
    expect(NAV_VIEW_PERMISSIONS["/carteira"]).toBe("leads.view");
  });

  it("o Cliente 360 legado (/carteira/:clientId) segue declarado e intocado", () => {
    expect(routeChunk("/carteira/:clientId")).toMatch(/<ClienteDetail \/>/);
    expect(ROUTE_FEATURE_MAP["/carteira/:clientId"]).toBe("carteira");
  });
});

describe("/leads não carrega mais a carteira", () => {
  it("sem ClientPortfolioSection, sem ramo de portfolio, sem rótulo Clientes", () => {
    expect(leadsPage).not.toMatch(/ClientPortfolioSection/);
    expect(leadsPage).not.toMatch(/portfolioActive/);
    expect(leadsPage).not.toMatch(/cliente: "Clientes"/);
  });

  it("as abas vêm de leadsPageTabOptions e o `cliente` antigo passa pelo redirect", () => {
    expect(leadsPage).toMatch(/leadsPageTabOptions\(usaLeiDoErp, usaCadastroErpCafeJurere, podeVerListaFria\)/);
    expect(leadsPage).toMatch(/useRedirecionaAbaClientes\(filterClassificacao, filterState, setFilterState\)/);
  });
});

describe("portas secundárias apontam para /carteira", () => {
  it("paleta de comandos e recentes", () => {
    expect(read("src/modules/platform/components/command/groups/CommandGroupNavigation.tsx")).toMatch(
      /id: "nav-carteira",\s+label: "Carteira",\s+path: "\/carteira"/,
    );
    expect(read("src/modules/platform/components/command/groups/CommandGroupRecents.tsx")).toMatch(
      /"nav-carteira":\s+\{ label: "Carteira".*payload: "\/carteira"/,
    );
  });

  it("atalho `g r` (e `g c` segue sendo Chat no MainLayout)", () => {
    expect(read("src/modules/platform/hooks/useGlobalShortcuts.ts")).toMatch(
      /key: "g r", label: "Carteira".*navigate\("\/carteira"\)/,
    );
    expect(read("src/modules/platform/hooks/useKeyboardShortcuts.ts")).toMatch(/keys: "g c"/);
  });
});
