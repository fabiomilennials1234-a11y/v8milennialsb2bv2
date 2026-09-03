import { describe, expect, it } from "vitest";
import { Gauge } from "lucide-react";

import {
  filterByGate,
  filterByMaster,
  filterByOutbound,
  filterByPermission,
  isRouteActive,
  makeCanViewRoute,
  pruneChildren,
} from "./navigation-filters";
import {
  FUNIS_PATHS,
  NAV_VIEW_PERMISSIONS,
  PITSTOP_GROUPS,
  SIDEBAR_PRIMARY,
  TURBO_PATHS,
  type NavNode,
} from "./navigation-model";

const node = (path: string, extra: Partial<NavNode> = {}): NavNode => ({
  label: path,
  icon: Gauge,
  path,
  ...extra,
});

describe("filterByOutbound", () => {
  it("devolve tudo quando o usuário não é membro de org outbound", () => {
    const items = [node("/comissoes"), node("/produtos")];
    expect(filterByOutbound(items, false)).toEqual(items);
  });

  it("corta rotas fora do recorte permitido", () => {
    const items = [node("/dashboard"), node("/comissoes")];
    expect(filterByOutbound(items, true).map((i) => i.path)).toEqual(["/dashboard"]);
  });

  it("mantém o pai quando só os filhos estão liberados", () => {
    const funis = node("/funis", { children: [node("/funil/whatsapp")] });
    // /funis está no recorte, mas o que importa aqui é o pai sobreviver
    // mesmo quando a própria rota não estivesse — por isso o pai de teste
    // usa uma rota fora da lista.
    const grupo = node("/inexistente", { children: [node("/funil/propostas")] });
    expect(filterByOutbound([funis, grupo], true).map((i) => i.path)).toEqual([
      "/funis",
      "/inexistente",
    ]);
  });

  it("corta o pai quando nem ele nem os filhos estão liberados", () => {
    const grupo = node("/turbo", { children: [node("/copilot"), node("/automacoes")] });
    expect(filterByOutbound([grupo], true)).toEqual([]);
  });
});

describe("filterByMaster", () => {
  it("esconde item masterOnly de quem não é master", () => {
    const items = [node("/dashboard"), node("/master-only", { masterOnly: true })];
    expect(filterByMaster(items, false).map((i) => i.path)).toEqual(["/dashboard"]);
    expect(filterByMaster(items, true)).toHaveLength(2);
  });
});

describe("filterByGate", () => {
  const gates = { metaPagesConnected: false, metricsStudioEnabled: false };

  it("respeita o gate de páginas Meta conectadas", () => {
    const items = [node("/dashboard"), node("/atendimento/meta", { gate: "meta_pages_connected" })];
    expect(filterByGate(items, gates).map((i) => i.path)).toEqual(["/dashboard"]);
    expect(filterByGate(items, { ...gates, metaPagesConnected: true })).toHaveLength(2);
  });

  it("esconde Métricas enquanto a org não está no rollout", () => {
    const items = [node("/performance"), node("/metricas", { gate: "metrics_studio_enabled" })];
    expect(filterByGate(items, gates).map((i) => i.path)).toEqual(["/performance"]);
    expect(filterByGate(items, { ...gates, metricsStudioEnabled: true })).toHaveLength(2);
  });

  it("os dois gates são independentes", () => {
    const items = [
      node("/atendimento/meta", { gate: "meta_pages_connected" }),
      node("/metricas", { gate: "metrics_studio_enabled" }),
    ];
    const soMetrics = filterByGate(items, { metaPagesConnected: false, metricsStudioEnabled: true });
    expect(soMetrics.map((i) => i.path)).toEqual(["/metricas"]);
  });
});

/**
 * Guarda de inventário. Esta branch nasceu da navegação da main, onde Carteira
 * é módulo próprio e Leads se chama "Combustível" e vive no menu "Mais". Aqui
 * as três decisões são outras, e um merge limpo apagaria as três em silêncio —
 * sem conflito, sem teste vermelho. Estes casos existem para não deixar.
 */
describe("inventário da navegação", () => {
  const caminhosLaterais = SIDEBAR_PRIMARY.map((item) => item.path);
  const itensPitstop = PITSTOP_GROUPS.flatMap((group) => group.items);

  it("Leads é porta própria da lateral", () => {
    expect(caminhosLaterais).toContain("/leads");
    expect(SIDEBAR_PRIMARY.find((item) => item.path === "/leads")?.label).toBe("Leads");
  });

  it("Carteira não voltou ao primeiro nível", () => {
    expect(caminhosLaterais).not.toContain("/upsell");
  });

  it("o rótulo Combustível não existe mais", () => {
    const rotulos = [...SIDEBAR_PRIMARY, ...itensPitstop].map((item) => item.label);
    expect(rotulos).not.toContain("Combustível");
  });

  it("Métricas é porta da lateral, entre Comando e Chat, e mantém o gate", () => {
    const metricas = SIDEBAR_PRIMARY.find((item) => item.path === "/metricas");
    expect(metricas).toBeDefined();
    expect(metricas?.gate).toBe("metrics_studio_enabled");
    // A posição é o pedido, não detalhe: entre Comando e Chat.
    expect(caminhosLaterais.indexOf("/metricas")).toBe(caminhosLaterais.indexOf("/dashboard") + 1);
    expect(caminhosLaterais.indexOf("/chat-whatsapp")).toBe(caminhosLaterais.indexOf("/metricas") + 1);
  });

  it("Métricas saiu do Pitstop e não ficou duplicada", () => {
    expect(itensPitstop.some((item) => item.path === "/metricas")).toBe(false);
  });

  it("a lateral tem sete portas", () => {
    expect(SIDEBAR_PRIMARY).toHaveLength(7);
  });

  // SCRUM-430. As duas travas de Métricas são independentes e ambas precisam
  // existir: o gate de ROLLOUT (a org entrou na feature) e o de PERMISSÃO (este
  // membro pode ver). Perder qualquer uma passa despercebido na tela de quem
  // testa — admin e master recebem `true` antes de qualquer camada.
  it("Métricas exige metrics.view, além do gate de rollout", () => {
    expect(NAV_VIEW_PERMISSIONS["/metricas"]).toBe("metrics.view");
  });

  // A chave do corte por pessoa NÃO é a mesma da tela: closer/SDR seguem em
  // `performance.view`, a mesma trava do Ranking. Se um dia alguém "unificar",
  // que seja por decisão, não por descuido.
  it("Métricas e Ranking não compartilham a mesma chave", () => {
    expect(NAV_VIEW_PERMISSIONS["/metricas"]).not.toBe(NAV_VIEW_PERMISSIONS["/performance"]);
  });
});

describe("makeCanViewRoute", () => {
  it("libera tudo para master e para admin", () => {
    const perms = { "leads.view": false };
    expect(makeCanViewRoute({ isMaster: true, isAdmin: false, featurePerms: perms })("/leads")).toBe(true);
    expect(makeCanViewRoute({ isMaster: false, isAdmin: true, featurePerms: perms })("/leads")).toBe(true);
  });

  it("nega apenas quando a permissão é explicitamente false", () => {
    const can = makeCanViewRoute({
      isMaster: false,
      isAdmin: false,
      featurePerms: { "leads.view": false },
    });
    expect(can("/leads")).toBe(false);
    // chave ausente na matriz = rota liberada
    expect(can("/performance")).toBe(true);
  });

  it("libera rota sem permissão declarada — Disparos é porta canônica", () => {
    const can = makeCanViewRoute({ isMaster: false, isAdmin: false, featurePerms: {} });
    expect(can("/disparos")).toBe(true);
  });

  it("trata matriz ainda não carregada como liberada", () => {
    const can = makeCanViewRoute({ isMaster: false, isAdmin: false, featurePerms: undefined });
    expect(can("/leads")).toBe(true);
  });

  it("/funil/<slug> herda a permissão do prefixo /funil (flip da 637)", () => {
    const can = makeCanViewRoute({
      isMaster: false,
      isAdmin: false,
      featurePerms: { "pipeline.view": false },
    });
    expect(can("/funil/whatsapp")).toBe(false);
    expect(can("/funil/pos-venda")).toBe(false);
    // negação some → liberado (chave ausente é liberada)
    const canSem = makeCanViewRoute({ isMaster: false, isAdmin: false, featurePerms: {} });
    expect(canSem("/funil/whatsapp")).toBe(true);
  });
});

describe("filterByPermission", () => {
  const negaFunis = (path: string) => path !== "/funis";

  it("mantém o pai negado quando ao menos um filho é visível", () => {
    const funis = node("/funis", { children: [node("/funil/whatsapp")] });
    expect(filterByPermission([funis], negaFunis).map((i) => i.path)).toEqual(["/funis"]);
  });

  it("corta o pai quando ele e todos os filhos estão negados", () => {
    const funis = node("/funis", { children: [node("/funil/whatsapp")] });
    expect(filterByPermission([funis], () => false)).toEqual([]);
  });

  it("um pai sem filhos depende só da própria rota", () => {
    expect(filterByPermission([node("/funis")], negaFunis)).toEqual([]);
  });
});

describe("pruneChildren", () => {
  it("remove os filhos negados sem derrubar o pai", () => {
    const funis = node("/funis", { children: [node("/funil/whatsapp"), node("/funil/propostas")] });
    const [result] = pruneChildren([funis], (path) => path !== "/funil/propostas");
    expect(result.children?.map((c) => c.path)).toEqual(["/funil/whatsapp"]);
  });
});

describe("isRouteActive", () => {
  it("casa a raiz com o Comando", () => {
    expect(isRouteActive("/", "/dashboard")).toBe(true);
    expect(isRouteActive("/dashboard", "/dashboard")).toBe(true);
    expect(isRouteActive("/leads", "/dashboard")).toBe(false);
  });

  it("casa por prefixo", () => {
    expect(isRouteActive("/leads/123", "/leads")).toBe(true);
  });

  it("ativa Funis a partir da rota única /funil/:slug (SCRUM-632)", () => {
    expect(isRouteActive("/funil/prospeccao-cnae", "/funis", FUNIS_PATHS)).toBe(true);
    expect(isRouteActive("/funil/whatsapp", "/funis", FUNIS_PATHS)).toBe(true);
  });

  it("ativa Turbo a partir de Copilot e Automações", () => {
    expect(isRouteActive("/copilot", "/turbo", TURBO_PATHS)).toBe(true);
    expect(isRouteActive("/automacoes/novo", "/turbo", TURBO_PATHS)).toBe(true);
    expect(isRouteActive("/leads", "/turbo", TURBO_PATHS)).toBe(false);
  });
});
