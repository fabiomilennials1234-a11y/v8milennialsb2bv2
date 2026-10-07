/**
 * funnel-gate — a IA só atende lead num funil em que foi ligada (active_pipes).
 *
 * Regressão: Loofting 2026-10-07 — Loo (active_pipes=["whatsapp"]) respondeu
 * lead que vivia só em `representantes`.
 */

import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: () => undefined, toObject: () => ({}) },
  serve: () => {},
});

const { decideFunnelGate, checkFunnelGate } = await import(
  "../../supabase/functions/agent-message/funnel-gate.ts"
);

const OPORTUNIDADES = { id: "pipe-op", slug: "whatsapp" };
const REPRESENTANTES = { id: "pipe-rep", slug: "representantes" };

describe("decideFunnelGate", () => {
  it("bloqueia lead só em funil que a IA não atende (caso Loofting)", () => {
    const r = decideFunnelGate([{ active_pipes: ["whatsapp"] }], [REPRESENTANTES]);
    expect(r).toEqual({ blocked: true, allowed: ["whatsapp"], currentFunnels: ["representantes"] });
  });

  it("libera lead no funil ligado", () => {
    expect(decideFunnelGate([{ active_pipes: ["whatsapp"] }], [OPORTUNIDADES]).blocked).toBe(false);
  });

  it("libera lead em dois funis se um deles é ligado", () => {
    expect(
      decideFunnelGate([{ active_pipes: ["whatsapp"] }], [REPRESENTANTES, OPORTUNIDADES]).blocked,
    ).toBe(false);
  });

  it("aceita o funil por id (NatuPlast guarda uuid)", () => {
    expect(decideFunnelGate([{ active_pipes: ["pipe-rep"] }], [REPRESENTANTES]).blocked).toBe(false);
  });

  it("compara sem diferenciar caixa", () => {
    expect(decideFunnelGate([{ active_pipes: ["WhatsApp"] }], [OPORTUNIDADES]).blocked).toBe(false);
  });

  it("agente sem active_pipes = sem restrição", () => {
    expect(decideFunnelGate([{ active_pipes: [] }], [REPRESENTANTES]).blocked).toBe(false);
    expect(decideFunnelGate([{ active_pipes: null }], [REPRESENTANTES]).blocked).toBe(false);
  });

  it("um agente irrestrito entre vários libera a org", () => {
    const agents = [{ active_pipes: ["whatsapp"] }, { active_pipes: [] }];
    expect(decideFunnelGate(agents, [REPRESENTANTES]).blocked).toBe(false);
  });

  it("união dos funis de vários agentes restritos", () => {
    const agents = [{ active_pipes: ["whatsapp"] }, { active_pipes: ["representantes"] }];
    expect(decideFunnelGate(agents, [REPRESENTANTES]).blocked).toBe(false);
  });

  it("só eixos não-funil (campanha/upsell) = sem restrição", () => {
    expect(decideFunnelGate([{ active_pipes: ["campanha", "upsell_base"] }], [REPRESENTANTES]).blocked).toBe(false);
  });

  it("lead sem entrada aberta (novo) passa", () => {
    expect(decideFunnelGate([{ active_pipes: ["whatsapp"] }], []).blocked).toBe(false);
  });

  it("org sem agente ativo não bloqueia (outro gate cuida)", () => {
    expect(decideFunnelGate([], [REPRESENTANTES]).blocked).toBe(false);
  });
});

function makeSupabase(tables: Record<string, { data: unknown; error?: unknown }>) {
  const builder = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        resolve(tables[table] ?? { data: null, error: { message: "sem tabela" } }),
    };
    return chain;
  };
  return { from: builder } as any;
}

describe("checkFunnelGate", () => {
  const agents = { data: [{ active_pipes: ["whatsapp"] }] };

  it("bloqueia lead aberto só em representantes", async () => {
    const supabase = makeSupabase({
      copilot_agents: agents,
      pipeline_entries: { data: [{ pipeline_id: "pipe-rep" }] },
      pipelines: { data: [REPRESENTANTES] },
    });
    const r = await checkFunnelGate(supabase, "org", "lead");
    expect(r.blocked).toBe(true);
  });

  it("libera lead em Oportunidades", async () => {
    const supabase = makeSupabase({
      copilot_agents: agents,
      pipeline_entries: { data: [{ pipeline_id: "pipe-op" }] },
      pipelines: { data: [OPORTUNIDADES] },
    });
    expect((await checkFunnelGate(supabase, "org", "lead")).blocked).toBe(false);
  });

  it("fail-open se a leitura das entradas falha", async () => {
    const supabase = makeSupabase({
      copilot_agents: agents,
      pipeline_entries: { data: null, error: { message: "boom" } },
    });
    expect((await checkFunnelGate(supabase, "org", "lead")).blocked).toBe(false);
  });

  it("fail-open se a leitura dos agentes falha", async () => {
    const supabase = makeSupabase({ copilot_agents: { data: null, error: { message: "boom" } } });
    expect((await checkFunnelGate(supabase, "org", "lead")).blocked).toBe(false);
  });
});
