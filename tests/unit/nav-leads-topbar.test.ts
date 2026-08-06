/**
 * Leads na barra principal; Combustível e Carteira fora do menu (`inv:H1-03`,
 * SCRUM-47, commit dd264db6).
 *
 * Três regressões concretas que este arquivo tranca:
 *
 *   1. **"Combustível" e "Leads" eram a mesma rota com dois nomes.** O item
 *      voltar a existir duplicado (um na barra, outro no "Mais") é o estado
 *      anterior, e ele confunde: duas portas para `/leads`, nomes diferentes.
 *   2. **Carteira deixou de ser módulo.** Os números dela viraram o cluster
 *      "Dados" da lista de leads (`inv:H1-02`). Reabrir a porta no menu
 *      reintroduz um módulo que não existe mais como módulo — e ele reaparece
 *      fácil, porque `/upsell` continua sendo uma feature registrada com
 *      `sidebarPath`.
 *   3. **Nada foi apagado.** `/upsell` segue viva e acessível por link direto —
 *      as ~30 orgs com carteira em ERP continuam com a tela. Um teste que só
 *      verificasse "Carteira sumiu" passaria também se alguém tivesse deletado
 *      a rota, que é o defeito oposto e pior.
 *
 * ── POR QUE ESTE TESTE LÊ O CÓDIGO-FONTE ─────────────────────────────────────
 * Os menus (`primaryNavItems` / `moreNavItems` / `allNavItems`) são dados —
 * arrays literais — mas constantes de módulo NÃO exportadas dentro de
 * `TopNavigation.tsx`. Importar esse arquivo num teste arrasta o grafo inteiro
 * do app: medido aqui, 40s só de transform, e ele nem resolve (`qrcode.react`,
 * puxado por `VoicePairingDialog` via o barril de communication, não instala
 * neste ambiente). Renderizar o componente exigiria mockar dezenas de hooks e
 * provaria menos do que ler o dado.
 *
 * Ler a fonte e afirmar contrato sobre ela é técnica já usada e sancionada
 * neste repositório — `tests/unit/route-feature-map.test.ts` faz exatamente
 * isso com o `App.tsx`. A limitação é honesta e vale registrar: isto prova o
 * DADO de navegação, não o que o React pinta na tela. Se alguém reformatar os
 * arrays, o teste falha alto (não em silêncio), e os `expect` de existência
 * abaixo existem justamente para essa falha chegar com nome.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURES,
  ROUTE_FEATURE_MAP,
} from "../../src/modules/platform/lib/feature-registry";

const NAV_PATH = "../../src/modules/platform/components/layout/TopNavigation.tsx";
const fonteNav = readFileSync(resolve(__dirname, NAV_PATH), "utf-8");
const fonteApp = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf-8");

/** Remove linhas comentadas — item comentado não é item de menu. */
function semComentarios(bloco: string): string {
  return bloco
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

interface ItemDeMenu {
  label: string;
  path: string;
}

function itensDoMenu(nome: string): ItemDeMenu[] {
  const inicio = fonteNav.indexOf(`const ${nome}`);
  if (inicio < 0) {
    throw new Error(
      `A constante \`${nome}\` não existe mais em TopNavigation.tsx. ` +
        `Se o menu foi reestruturado, este teste precisa ser reescrito junto — ` +
        `não apagado.`,
    );
  }
  const fim = fonteNav.indexOf("\n];", inicio);
  const bloco = semComentarios(fonteNav.slice(inicio, fim));
  const itens: ItemDeMenu[] = [];
  const re = /\{\s*label:\s*"([^"]+)"[^}]*?path:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloco)) !== null) itens.push({ label: m[1], path: m[2] });
  return itens;
}

const barraPrincipal = itensDoMenu("primaryNavItems");
const menuMais = itensDoMenu("moreNavItems");
const menuMobile = itensDoMenu("allNavItems");
const todosOsMenus = [
  ["barra principal", barraPrincipal],
  ['menu "Mais"', menuMais],
  ["menu mobile", menuMobile],
] as const;

describe("os menus foram lidos", () => {
  it("os três arrays de navegação existem e têm itens", () => {
    // Guarda contra o teste virar vácuo silencioso se o regex parar de casar.
    expect(barraPrincipal.length).toBeGreaterThan(5);
    expect(menuMais.length).toBeGreaterThan(2);
    expect(menuMobile.length).toBeGreaterThan(5);
  });
});

describe("Leads na barra principal", () => {
  it("a barra principal tem Leads apontando para /leads", () => {
    expect(barraPrincipal).toContainEqual({ label: "Leads", path: "/leads" });
  });

  it("o menu mobile também leva a Leads", () => {
    expect(menuMobile).toContainEqual({ label: "Leads", path: "/leads" });
  });

  it("Leads não está também no menu Mais — uma rota, uma porta", () => {
    expect(menuMais.filter((i) => i.path === "/leads")).toEqual([]);
  });

  it.each(todosOsMenus)("%s não tem duas portas para /leads", (_nome, itens) => {
    // O estado anterior tinha "Combustível" e "Leads" na mesma rota.
    expect(itens.filter((i) => i.path === "/leads").length).toBeLessThanOrEqual(1);
  });
});

describe('"Combustível" não é mais um item de menu', () => {
  it.each(todosOsMenus)("%s não oferece Combustível", (_nome, itens) => {
    expect(itens.map((i) => i.label)).not.toContain("Combustível");
  });

  it("o registry de features chama /leads de Leads, não de Combustível", () => {
    const leads = FEATURES.find((f) => f.key === "leads");
    expect(leads).toBeDefined();
    // As telas de plano e de permissão leem daqui: rótulo divergente faz o
    // admin procurar por "Combustível" uma aba que se chama "Leads".
    expect(leads!.label).toBe("Leads");
    expect(leads!.sidebarPath).toBe("/leads");
  });
});

describe("Carteira saiu da navegação", () => {
  it.each(todosOsMenus)("%s não tem item rotulado Carteira", (_nome, itens) => {
    expect(itens.map((i) => i.label)).not.toContain("Carteira");
  });

  it.each(todosOsMenus)("%s não tem nenhuma porta para /upsell", (_nome, itens) => {
    expect(itens.filter((i) => i.path === "/upsell")).toEqual([]);
  });

  it("o dropdown de Funis também não recebe a Carteira de volta pelo display config", () => {
    // Os funis do dropdown vêm de `usePipelineDisplayConfig`, que ainda entrega
    // o pipe `upsell`. O filtro é o que impede a porta de reaparecer sozinha
    // para quem tem a Carteira configurada.
    expect(fonteNav).toMatch(/\.filter\(\(c\) => c\.pipe_type !== "upsell"\)/);
  });
});

describe("/upsell continua viva — perdeu a porta, não a rota", () => {
  it("a rota /upsell existe em App.tsx", () => {
    expect(fonteApp).toMatch(/path="\/upsell"/);
  });

  it("a rota /upsell segue guardada pela feature carteira", () => {
    expect(ROUTE_FEATURE_MAP["/upsell"]).toBe("carteira");
    expect(ROUTE_FEATURE_MAP["/carteira/:clientId"]).toBe("carteira");
  });

  it("a feature carteira continua no registry — sair do menu não é revogar plano", () => {
    const carteira = FEATURES.find((f) => f.key === "carteira");
    expect(carteira).toBeDefined();
    expect(carteira!.label).toBe("Carteira");
  });
});
