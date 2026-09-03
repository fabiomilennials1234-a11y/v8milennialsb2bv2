/**
 * Leads tem porta própria na navegação — e Combustível/Carteira não voltam.
 *
 * HISTÓRICO: este teste lia `TopNavigation.tsx` (a top bar). A top bar morreu
 * — `Sidebar` + `SidebarMobileDrawer` consomem `useNavigationModel`, e o
 * arquivo foi deletado na SCRUM-637 (estava sem NENHUM import desde a troca).
 * As decisões de produto que ele guardava seguem valendo; o que mudou é a
 * fonte: `navigation-model.ts` (dados) + `useNavigationModel.ts` (derivação).
 *
 * Ler a fonte e afirmar contrato sobre ela é técnica já usada e sancionada
 * neste repositório — `tests/unit/route-feature-map.test.ts` faz exatamente
 * isso com o `App.tsx`. Isto prova o DADO de navegação, não o que o React
 * pinta na tela; a renderização é coberta por `Sidebar.test.tsx`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURES,
  ROUTE_FEATURE_MAP,
} from "../../src/modules/platform/lib/feature-registry";
import {
  SIDEBAR_PRIMARY,
  PITSTOP_GROUPS,
} from "../../src/modules/platform/lib/navigation-model";
import { funisDeSistemaNavegaveis } from "../../src/contracts/pipe/nome-do-funil";

const fonteModel = readFileSync(
  resolve(__dirname, "../../src/modules/platform/hooks/useNavigationModel.ts"),
  "utf-8",
);
const fonteApp = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf-8");
// Os outros dois consumidores da mesma regra de navegação.
const fonteHub = readFileSync(
  resolve(__dirname, "../../src/modules/pipelines/pages/FunisHub.tsx"),
  "utf-8",
);
const fonteSeletor = readFileSync(
  resolve(__dirname, "../../src/modules/pipelines/lib/funnel-nav.ts"),
  "utf-8",
);

interface ItemDeMenu {
  label: string;
  path: string;
}

const barraPrincipal: ItemDeMenu[] = SIDEBAR_PRIMARY.map((n) => ({
  label: n.label,
  path: n.path,
}));
const pitstop: ItemDeMenu[] = PITSTOP_GROUPS.flatMap((g) =>
  g.items.map((n) => ({ label: n.label, path: n.path })),
);
const todosOsMenus = [
  ["lateral (primária)", barraPrincipal],
  ["Pitstop", pitstop],
] as const;

describe("os menus foram lidos", () => {
  it("as duas fontes de navegação existem e têm itens", () => {
    // Guarda contra o teste virar vácuo silencioso se as constantes mudarem de nome.
    expect(barraPrincipal.length).toBeGreaterThan(3);
    expect(pitstop.length).toBeGreaterThan(2);
  });
});

describe("Leads na navegação", () => {
  it("a lateral tem Leads apontando para /leads", () => {
    expect(barraPrincipal).toContainEqual({ label: "Leads", path: "/leads" });
  });

  it("Leads não está também no Pitstop — uma rota, uma porta", () => {
    expect(pitstop.filter((i) => i.path === "/leads")).toEqual([]);
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
    // Os funis da navegação vêm de `usePipelineDisplayConfig`, que ainda
    // entrega o pipe `upsell`. É esta regra que impede a porta de reaparecer
    // sozinha para quem tem a Carteira configurada.
    //
    // Antes isto era um `toMatch` no filtro escrito à mão dentro de
    // `useNavigationModel`. Provava a lateral e só ela — e foi exatamente por
    // isso que o hub `/funis`, que tinha a SUA cópia do filtro sem o `upsell`,
    // pôde listar um card "Carteira" durante todo esse tempo sem nenhum teste
    // vermelho. A regra agora tem um dono; a asserção segue o dono.
    const configs = [
      { pipe_type: "upsell", display_name: "Carteira", is_visible: true, position: 4 },
      { pipe_type: "whatsapp", display_name: "Oportunidades", is_visible: true, position: 1 },
    ];
    const navegaveis = funisDeSistemaNavegaveis(configs, {
      mergeDeOportunidadesAtivo: false,
    });
    expect(navegaveis.map((c) => c.pipe_type)).toEqual(["whatsapp"]);
  });

  it("os TRÊS consumidores usam a regra única — ninguém refaz o filtro na mão", () => {
    // A lateral, o hub `/funis` e o seletor da faixa desenham a mesma lista.
    // Enquanto cada um carregava a própria cópia do filtro, bastava um esquecer
    // o `upsell` para a Carteira voltar só naquela tela.
    for (const fonte of [fonteModel, fonteHub, fonteSeletor]) {
      expect(fonte).toMatch(/funisDeSistemaNavegaveis\(/);
      expect(fonte).not.toMatch(/\.filter\(\(c\) => c\.pipe_type !== "upsell"\)/);
    }
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
