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
import { FUNIS_PATHS, TURBO_PATHS, type NavNode } from "./navigation-model";

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
    const funis = node("/funis", { children: [node("/pipe-whatsapp")] });
    // /funis está no recorte, mas o que importa aqui é o pai sobreviver
    // mesmo quando a própria rota não estivesse — por isso o pai de teste
    // usa uma rota fora da lista.
    const grupo = node("/inexistente", { children: [node("/pipe-propostas")] });
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
  it("respeita o gate de páginas Meta conectadas", () => {
    const items = [node("/dashboard"), node("/atendimento/meta", { gate: "meta_pages_connected" })];
    expect(filterByGate(items, { metaPagesConnected: false }).map((i) => i.path)).toEqual([
      "/dashboard",
    ]);
    expect(filterByGate(items, { metaPagesConnected: true })).toHaveLength(2);
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
});

describe("filterByPermission", () => {
  const negaFunis = (path: string) => path !== "/funis";

  it("mantém o pai negado quando ao menos um filho é visível", () => {
    const funis = node("/funis", { children: [node("/pipe-whatsapp")] });
    expect(filterByPermission([funis], negaFunis).map((i) => i.path)).toEqual(["/funis"]);
  });

  it("corta o pai quando ele e todos os filhos estão negados", () => {
    const funis = node("/funis", { children: [node("/pipe-whatsapp")] });
    expect(filterByPermission([funis], () => false)).toEqual([]);
  });

  it("um pai sem filhos depende só da própria rota", () => {
    expect(filterByPermission([node("/funis")], negaFunis)).toEqual([]);
  });
});

describe("pruneChildren", () => {
  it("remove os filhos negados sem derrubar o pai", () => {
    const funis = node("/funis", { children: [node("/pipe-whatsapp"), node("/pipe-propostas")] });
    const [result] = pruneChildren([funis], (path) => path !== "/pipe-propostas");
    expect(result.children?.map((c) => c.path)).toEqual(["/pipe-whatsapp"]);
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

  it("ativa Funis a partir das rotas de pipe", () => {
    expect(isRouteActive("/pipe-whatsapp", "/funis", FUNIS_PATHS)).toBe(true);
    expect(isRouteActive("/pipe-propostas/abc", "/funis", FUNIS_PATHS)).toBe(true);
  });

  it("ativa Turbo a partir de Copilot e Automações", () => {
    expect(isRouteActive("/copilot", "/turbo", TURBO_PATHS)).toBe(true);
    expect(isRouteActive("/automacoes/novo", "/turbo", TURBO_PATHS)).toBe(true);
    expect(isRouteActive("/leads", "/turbo", TURBO_PATHS)).toBe(false);
  });
});
