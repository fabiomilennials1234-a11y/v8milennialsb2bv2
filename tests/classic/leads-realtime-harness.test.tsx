/**
 * Interface CLÁSSICA — cópia de `tests/unit/leads-realtime-harness.test.tsx` com `@` → `classic/src`
 * (`vitest.classic.config.ts`). Port de 2026-10-05: tela de Leads sob tráfego realtime: idas ao banco, patch com fetch em voo (B1), aba Clientes, toggle de IA; volta 2 (2026-10-06): páginas ociosas, duas listas ativas, Café.
 * Mantenha as duas cópias iguais abaixo deste bloco.
 */
/**
 * Harness da tela de Leads sob tráfego realtime — conta IDAS AO BANCO.
 *
 * Em 2026-10-05 a tela de Leads era 60% do tempo do banco de prod: cada aba
 * aberta refazia a lista + 6 `count: exact` a cada evento da org (leads,
 * deals, pipeline_entries, sale_events), e ~40 usuários já saturavam 2 vCPU.
 *
 * Este arquivo monta os MESMOS hooks com os MESMOS parâmetros de `Leads.tsx`
 * (lista + total + 4 abas + 2 cards), com o Supabase dublado e relógio falso,
 * e conta quantas consultas cada cenário dispara. Não importa nada que só
 * exista no código novo — roda também contra o antigo, e lá fica vermelho
 * (controle positivo).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const ORG = vi.hoisted(() => "org-1");

// ── Supabase dublado: cada `await` num builder de `from()` é uma ida ao banco ──

type Op = [string, ...unknown[]];
type Kind = "list" | "count" | "stats" | "relation" | "other";
interface Call {
  table: string;
  ops: Op[];
  kind: Kind;
  at: number;
  /** count: aba (all/lead/cliente/perdido); stats: mes/dono. */
  label: string;
}

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, ...unknown[]]>; kind: string; at: number; label: string }>,
  rows: [] as Array<Record<string, unknown>>,
  matching: 1500,
  /** > 0: a resposta sai depois disso — o retrato é tirado na CHAMADA, como no banco. */
  delayMs: 0,
}));

function classify(ops: Op[]): { kind: Kind; label: string } {
  const select = ops.find((o) => o[0] === "select");
  const sel = String(select?.[1] ?? "");
  if (sel.includes("responsible:team_members")) return { kind: "list", label: "list" };
  if (sel.startsWith("id, ")) return { kind: "relation", label: "relation" };
  const stats = ops.some((o) => o[0] === "is" && o[1] === "deleted_at");
  if (stats) {
    const dono = ops.some((o) => o[0] === "not" && o[1] === "responsible_id");
    return { kind: "stats", label: dono ? "dono" : "mes" };
  }
  if (sel === "id" || sel === "*") {
    const aba = ops.find((o) => o[0] === "eq" && o[1] === "relacao_negocios");
    return { kind: "count", label: aba ? String(aba[2]) : "all" };
  }
  return { kind: "other", label: "other" };
}

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const ops: Array<[string, ...unknown[]]> = [];
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
              const { kind, label } = classify(ops);
              db.calls.push({ table, ops, kind, at: Date.now(), label });
              const limit = ops.find((o) => o[0] === "limit")?.[1] as number | undefined;
              const range = ops.find((o) => o[0] === "range") as [string, number, number] | undefined;
              let result: unknown;
              if (kind === "list") {
                const start = range?.[1] ?? 0;
                const end = range?.[2] ?? 49;
                result = { data: db.rows.slice(start, end + 1), error: null };
              } else if (kind === "count" || kind === "stats") {
                const n = limit ? Math.min(limit, db.matching) : db.matching;
                result = { data: Array.from({ length: n }, (_, i) => ({ id: `c-${i}` })), count: db.matching, error: null };
              } else {
                result = { data: [], error: null };
              }
              if (db.delayMs > 0) {
                return new Promise((r) => setTimeout(() => r(result), db.delayMs)).then(resolve, reject);
              }
              return Promise.resolve(result).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            ops.push([prop, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return {
    supabase: {
      from,
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
      removeChannel: vi.fn(),
    },
  };
});

// ── Realtime: captura os canais que os hooks abrem ──────────────────────────

const channels = vi.hoisted(() => new Map<(p: unknown) => void, { table: string; filter?: string; enabled?: boolean }>());

vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { table: string; filter?: string; onEvent: (p: unknown) => void; enabled?: boolean }) => {
    channels.set(opts.onEvent, { table: opts.table, filter: opts.filter, enabled: opts.enabled });
    return { state: "joined", diagnostics: [] };
  },
}));
vi.mock("@/shared/realtime/realtime-org-context", () => ({ useRealtimeOrgId: () => ORG }));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/identity/org-team/hooks/useOrganization")>();
  const org = { organizationId: ORG, isReady: true, timezone: "America/Sao_Paulo" };
  return { ...real, useOrganization: () => org, useRequiredOrganization: () => ({ ...org, teamMemberId: "tm-1" }) };
});

vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({ isMaster: false, isReady: true, organizationId: ORG, teamMemberId: "tm-1", userId: "u-1" }),
}));

import { useLeads, useLeadsCount, useToggleLeadAI } from "@/modules/leads/hooks/useLeads";
import { useCopilotToggleMutation } from "@/modules/copilot/hooks/useCopilotToggle";
import { useLeadsStats } from "@/modules/leads/hooks/useLeadsStats";
import { leadsKeys } from "@/modules/leads/lib/leads-query-keys";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE = Date.UTC(2026, 9, 5, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "+00:00");
const pg = (ms: number) => iso(ms).replace("T", " ").replace("+00:00", "+00");

function row(i: number) {
  const created = iso(BASE - i * 60_000);
  return {
    id: `lead-${i}`,
    organization_id: ORG,
    name: `Lead ${i}`,
    company: null,
    email: null,
    phone: null,
    normalized_phone: null,
    origin: "outro",
    uf: null,
    qualification_tier: null,
    classificacao: null,
    relacao_negocios: i === 0 ? "cliente" : "lead",
    is_shadow: false,
    deleted_at: null,
    erp_code: null,
    cafe_jurere_erp_elegivel: false,
    notes: "antes",
    custom_fields: { a: 1, b: [1, 2] },
    ai_disabled: false,
    created_at: created,
    updated_at: created,
    responsible_id: "tm-1",
    sdr_id: null,
    closer_id: null,
    pre_sale_responsible_id: null,
    sale_responsible_id: null,
    responsible: { id: "tm-1", name: "Ana" },
    sdr: null,
    closer: null,
    pre_sale_responsible: null,
    sale_responsible: null,
    lead_tags: [{ tag: { id: "t1", name: "VIP", color: "#fff" } }],
  };
}

/** O que o realtime manda num UPDATE/INSERT: colunas cruas, timestamptz em texto do PG. */
function realtimeNew(r: ReturnType<typeof row>, over: Record<string, unknown> = {}) {
  const { responsible: _1, sdr: _2, closer: _3, pre_sale_responsible: _4, sale_responsible: _5, lead_tags: _6, ...cols } = r;
  return {
    ...cols,
    created_at: String(r.created_at).replace("T", " ").replace("+00:00", "+00"),
    updated_at: String(r.updated_at).replace("T", " ").replace("+00:00", "+00"),
    custom_fields: { b: [1, 2], a: 1 },
    ...over,
  };
}

// ── O que Leads.tsx monta (mesmos parâmetros, linhas 418-429 e 569-572) ──────

/** `listEnabled: false` = a aba Clientes (`Leads.tsx` desliga a lista com `portfolioActive`). */
function useLeadsScreen(listEnabled = true) {
  const filterState = { searchQuery: "", filterOrigin: "all", filterQualification: "all", filterResponsible: "all" };
  const filterClassificacao = "all";
  const usaLeiDoErp = false;
  const usaCadastroErpCafeJurere = false;
  const page = 0;
  const sort = { key: "created_at", direction: "desc" } as const;
  const common = {
    searchQuery: filterState.searchQuery,
    filterOrigin: filterState.filterOrigin,
    filterQualification: filterState.filterQualification,
    usaLeiDoErp,
    usaCadastroErpCafeJurere,
    filterUf: undefined,
    createdFrom: undefined,
    createdTo: undefined,
    filterAssignment: "all" as const,
    filterResponsible: filterState.filterResponsible,
  };
  const list = useLeads({ page, ...common, filterClassificacao, sort }, { enabled: listEnabled });
  const total = useLeadsCount({ ...common, filterClassificacao });
  const all = useLeadsCount({ ...common, filterClassificacao: "all" });
  const lead = useLeadsCount({ ...common, filterClassificacao: "lead" });
  const cliente = useLeadsCount({ ...common, filterClassificacao: "cliente" });
  const perdido = useLeadsCount({ ...common, filterClassificacao: "perdido" });
  const stats = useLeadsStats({
    searchQuery: common.searchQuery, filterOrigin: common.filterOrigin, filterQualification: common.filterQualification,
    filterClassificacao, usaLeiDoErp, usaCadastroErpCafeJurere, filterResponsible: common.filterResponsible,
    filterUf: undefined, createdFrom: undefined, createdTo: undefined,
  });
  return { list, total, all, lead, cliente, perdido, stats };
}

// ── Utilidades do relógio e dos eventos ────────────────────────────────────

let qc: QueryClient;
let t0 = 0;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Entrega o evento a TODO canal aberto na tabela (como o servidor faz). */
function emit(table: string, payload: Record<string, unknown>) {
  let delivered = 0;
  for (const [onEvent, meta] of channels) {
    if (meta.table === table && meta.enabled !== false) {
      onEvent({ schema: "public", table, commit_timestamp: new Date().toISOString(), errors: null, ...payload });
      delivered++;
    }
  }
  return delivered;
}

let insertSeq = 0;
/** Um lead novo, criado agora — entra no topo da página 1 (ordem desc). */
function freshInsert() {
  insertSeq++;
  const r = row(-insertSeq);
  return { eventType: "INSERT", new: realtimeNew({ ...r, created_at: iso(BASE + insertSeq * 1000), updated_at: iso(BASE + insertSeq * 1000) }), old: {} };
}

/** Evento que o código ANTIGO também considerava (funil/venda mudou). */
function pipelineEvent() {
  return { eventType: "UPDATE", new: { id: `pe-${insertSeq}`, organization_id: ORG, lead_id: "lead-3" }, old: {} };
}

const since = (from: number, until = Number.POSITIVE_INFINITY) =>
  db.calls.filter((c) => c.at >= from && c.at < until);
const countOf = (calls: Call[], kind: Kind, label?: string) =>
  calls.filter((c) => c.kind === kind && (label === undefined || c.label === label)).length;

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children);

async function mountScreen({ listEnabled = true } = {}) {
  const hook = renderHook(() => useLeadsScreen(listEnabled), { wrapper });
  await advance(50);
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 3_600_000));
  setVisibility("visible");
  db.calls.length = 0;
  db.rows = Array.from({ length: 120 }, (_, i) => row(i));
  db.matching = 1500;
  db.delayMs = 0;
  channels.clear();
  insertSeq = 0;
  qc = newClient();
});

/** Os defaults de App.tsx (retry desligado só para não poluir a contagem). */
function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true, retry: false },
    },
  });
}

afterEach(() => {
  qc.clear();
  setVisibility("visible");
  vi.useRealTimers();
});

describe("montagem", () => {
  it("abre uma vez: 1 lista, 4 contagens distintas (o total É a aba ativa), 2 cards", async () => {
    await mountScreen();
    expect(countOf(db.calls, "list")).toBe(1);
    expect(countOf(db.calls, "count")).toBe(4);
    expect(countOf(db.calls, "stats")).toBe(2);
  });
});

describe("critério 1 — rajada, fluxo contínuo e aba oculta", () => {
  it("rajada de 20 eventos relevantes em 10 s → 1 fetch da lista, 0 de contagem/cards", async () => {
    await mountScreen();
    t0 = Date.now();
    // Tráfego real chega em cachos, não em metrônomo: 4 cachos de 5, com
    // folgas de ~2,3 s entre eles.
    const offsets = [0, 300, 600, 900, 1200, 3500, 3800, 4100, 4400, 4700, 7000, 7300, 7600, 7900, 8200, 9000, 9300, 9600, 9800, 10000];
    let last = 0;
    for (const at of offsets) {
      await advance(at - last);
      last = at;
      emit("leads", freshInsert());
      emit("pipeline_entries", pipelineEvent());
    }
    await advance(40_000 - last);

    const window = since(t0, t0 + 40_000);
    expect(countOf(window, "list")).toBe(1);
    expect(countOf(window, "count")).toBe(0);
    expect(countOf(window, "stats")).toBe(0);
  });

  it("2 min de eventos contínuos → ≤4 fetches da lista; ≤1 por contagem a cada 60 s (intervalo ≥60 s)", async () => {
    await mountScreen();
    t0 = Date.now();
    for (let s = 0; s < 120; s += 3) {
      emit("leads", freshInsert());
      emit("pipeline_entries", pipelineEvent());
      await advance(3000);
    }
    const twoMinutes = since(t0, t0 + 120_000);
    expect(countOf(twoMinutes, "list")).toBeLessThanOrEqual(4);
    // E não por silêncio: a lista acompanha (~a cada 30 s) e as contagens
    // atualizam pelo menos uma vez — throttle, não descarte.
    expect(countOf(twoMinutes, "list")).toBeGreaterThanOrEqual(3);

    // `minAgeMs: 60_000` é a régua: em QUALQUER janela de 60 s cabe no máximo
    // uma busca de cada contagem — o que equivale a intervalo ≥60 s entre
    // buscas consecutivas, contando a da montagem. Em 2 min isso dá no máximo
    // duas (aos ~60 s e aos ~120 s), contra 40 do código antigo.
    for (const [kind, label] of [
      ["count", "all"], ["count", "lead"], ["count", "cliente"], ["count", "perdido"], ["stats", "mes"], ["stats", "dono"],
    ] as const) {
      const at = db.calls.filter((c) => c.kind === kind && c.label === label).map((c) => c.at);
      expect(countOf(twoMinutes, kind, label), label).toBeLessThanOrEqual(2);
      expect(countOf(twoMinutes, kind, label), label).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], label).toBeGreaterThanOrEqual(60_000);
    }
  });

  it("aba oculta → 0 consultas; ao voltar → exatamente 1 da lista; contagens velhas (≥60 s) uma vez", async () => {
    await mountScreen();
    t0 = Date.now();
    setVisibility("hidden");
    for (let s = 0; s < 90; s += 3) {
      emit("leads", freshInsert());
      emit("pipeline_entries", pipelineEvent());
      await advance(3000);
    }
    expect(since(t0)).toHaveLength(0);

    const back = Date.now();
    await act(async () => setVisibility("visible"));
    await advance(1000);
    const onReturn = since(back);
    expect(countOf(onReturn, "list")).toBe(1);
    for (const label of ["all", "lead", "cliente", "perdido"]) expect(countOf(onReturn, "count", label), label).toBe(1);

    // E para por aí: sem evento novo, nada mais.
    await advance(120_000);
    expect(countOf(since(back), "list")).toBe(1);
  });

  it("volta com contagens jovens (<60 s) → lista agora, contagens só quando completam 60 s", async () => {
    await mountScreen();
    const mountAt = Date.now();
    setVisibility("hidden");
    emit("leads", freshInsert());
    await advance(20_000);
    await act(async () => setVisibility("visible"));
    await advance(1000);
    expect(countOf(since(mountAt + 1), "list")).toBe(1);
    expect(countOf(since(mountAt + 1), "count")).toBe(0);

    await advance(mountAt + 60_000 - Date.now());
    expect(countOf(since(mountAt + 1), "count")).toBe(4);
  });
});

describe("critério 2 — o que não muda a tela não vai ao banco", () => {
  it("UPDATE de coluna fora de recorte num lead da tela → 0 fetch; linha atualizada; joins, relação e datas íntegros", async () => {
    const { result } = await mountScreen();
    t0 = Date.now();
    const target = db.rows[0] as ReturnType<typeof row>;
    emit("leads", {
      eventType: "UPDATE",
      new: realtimeNew(target, { notes: "depois", updated_at: "2026-10-05 12:00:00.123+00" }),
      old: { id: target.id },
    });
    await advance(120_000);

    expect(since(t0)).toHaveLength(0);
    const shown = (result.current.list.data ?? []).find((l) => l.id === target.id) as Record<string, unknown>;
    expect(shown.notes).toBe("depois");
    expect(shown.updated_at).toBe("2026-10-05T12:00:00.123+00:00");
    expect(new Date(String(shown.updated_at)).getTime()).toBe(Date.UTC(2026, 9, 5, 12, 0, 0, 123));
    expect(new Date(String(shown.created_at)).getTime()).toBe(BASE);
    expect(shown.responsible).toEqual({ id: "tm-1", name: "Ana" });
    expect(shown.lead_tags).toEqual(target.lead_tags);
    expect(shown.relacao_negocios).toBe("cliente");
  });

  it("UPDATE de lead fora da tela, além da página → 0 fetch da lista", async () => {
    await mountScreen();
    t0 = Date.now();
    const far = db.rows[110] as ReturnType<typeof row>;
    emit("leads", { eventType: "UPDATE", new: realtimeNew(far, { qualification_tier: "ouro" }), old: { id: far.id } });
    await advance(120_000);

    expect(countOf(since(t0), "list")).toBe(0);
    expect(countOf(since(t0), "relation")).toBe(0);
  });

  it("DELETE de id desconhecido (não filtrável: pode ser de outra org) → 0 fetch", async () => {
    await mountScreen();
    t0 = Date.now();
    emit("leads", { eventType: "DELETE", new: {}, old: { id: "lead-de-outra-org" } });
    await advance(120_000);

    expect(since(t0)).toHaveLength(0);
  });
});

describe("critério 3 — nenhuma contagem exata em leads", () => {
  it("lista, total, abas e cards: nenhum `count: exact`; contagem com teto", async () => {
    await mountScreen();
    const leadsCalls = db.calls.filter((c) => c.table === "leads");
    expect(leadsCalls.length).toBeGreaterThan(0);
    for (const c of leadsCalls) {
      const selects = c.ops.filter((o) => o[0] === "select");
      for (const s of selects) {
        expect(JSON.stringify(s), c.kind).not.toContain('"count":"exact"');
      }
    }
    for (const c of leadsCalls.filter((x) => x.kind === "count" || x.kind === "stats")) {
      expect(c.ops.find((o) => o[0] === "limit")?.[1], c.label).toBe(1000);
      expect(c.ops.some((o) => o[0] === "order"), c.label).toBe(false);
    }
  });

  it("acima do teto a contagem diz que passou dele, sem inventar o total", async () => {
    const first = await mountScreen();
    expect(first.result.current.total.data).toEqual({ value: 1000, capped: true });
    expect(first.result.current.stats.data?.withOwner).toEqual({ value: 1000, capped: true });
    first.unmount();

    db.matching = 37;
    qc = newClient();
    const again = await mountScreen();
    expect(again.result.current.total.data).toEqual({ value: 37, capped: false });
  });
});

describe("B1 — patch com a lista buscando", () => {
  it("fetch da lista em voo (retrato de antes do UPDATE) não apaga o patch para sempre: a lista é refeita depois e a linha fica certa", async () => {
    const { result } = await mountScreen();
    const target = db.rows[0] as ReturnType<typeof row>;
    db.delayMs = 5_000;
    t0 = Date.now();

    // Um refetch da lista começa (mutação, outra aba…): o retrato é "antes".
    await act(async () => {
      void qc.invalidateQueries({ queryKey: ["leads", "list"] });
    });
    // O UPDATE chega com esse fetch em voo; o banco já tem "depois".
    db.rows[0] = { ...target, notes: "depois" };
    emit("leads", { eventType: "UPDATE", new: realtimeNew(target, { notes: "depois" }), old: { id: target.id } });
    await advance(10 * 60_000);

    const shown = (result.current.list.data ?? []).find((l) => l.id === target.id) as Record<string, unknown>;
    expect(shown.notes).toBe("depois");
    // O fetch em voo + pelo menos um refeito depois dele.
    expect(countOf(since(t0), "list")).toBeGreaterThanOrEqual(2);
    // E as contagens não pagam por isso: o patch não muda recorte.
    expect(countOf(since(t0), "count")).toBe(0);
  });

  it("sem fetch em voo o patch continua de graça: 0 consultas", async () => {
    await mountScreen();
    t0 = Date.now();
    const target = db.rows[1] as ReturnType<typeof row>;
    emit("leads", { eventType: "UPDATE", new: realtimeNew(target, { notes: "depois" }), old: { id: target.id } });
    await advance(10 * 60_000);
    expect(since(t0)).toHaveLength(0);
  });
});

describe("aba Clientes — lista desligada, contagens na tela", () => {
  it("o canal de leads fica aberto; evento → contagens e cards refazem quando completam 60 s; lista 0", async () => {
    await mountScreen({ listEnabled: false });
    const mountAt = Date.now();
    expect(countOf(db.calls, "list")).toBe(0);
    expect([...channels.values()].some((m) => m.table === "leads" && m.enabled !== false)).toBe(true);

    expect(emit("leads", freshInsert())).toBeGreaterThan(0);
    await advance(40_000);
    // Disparou aos 30 s, mas as contagens têm 40 s: esperam a idade.
    expect(countOf(since(mountAt + 1), "count")).toBe(0);

    await advance(mountAt + 65_000 - Date.now());
    for (const label of ["all", "lead", "cliente", "perdido"]) {
      expect(countOf(since(mountAt + 1), "count", label), label).toBe(1);
    }
    expect(countOf(since(mountAt + 1), "stats")).toBe(2);
    expect(countOf(db.calls, "list")).toBe(0);
  });
});

describe("toggle de IA não refaz a tela de Leads", () => {
  it("useCopilotToggleMutation + useToggleLeadAI: 0 fetch de lista/contagem/cards; nada de leads cancelado", async () => {
    await mountScreen();
    const cancel = vi.spyOn(qc, "cancelQueries");
    const { result } = renderHook(() => ({ copilot: useCopilotToggleMutation(), lead: useToggleLeadAI() }), { wrapper });
    t0 = Date.now();

    await act(async () => {
      await result.current.copilot.mutateAsync({ disabled: true, leadId: "lead-0", phone: "5511999990000" });
      await result.current.lead.mutateAsync({ leadId: "lead-0", disabled: false });
    });
    await advance(10 * 60_000);

    const window = since(t0);
    expect(countOf(window, "list")).toBe(0);
    expect(countOf(window, "count")).toBe(0);
    expect(countOf(window, "stats")).toBe(0);
    const leadsCancels = cancel.mock.calls.filter(([f]) => (f as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "leads");
    expect(leadsCancels).toHaveLength(0);
  });
});

// ── Páginas em cache que a tela não está mostrando ──────────────────────────
//
// O cache tem mais páginas do que a tela: a página 2 largada, o recorte de
// antes, a lista de outra instância (picker, PriorityLeads). Um evento de patch
// não pode (1) mexer em página que não tem o lead, (2) apagar a marca de velha
// nem renovar a idade de página ociosa, (3) deixar fetch em voo devolver o
// retrato de antes para sempre, nem (4) esconder o evento do dono de outra
// lista ativa.

/** Os mesmos filtros e a mesma ordem que `useLeadsScreen` passa para `useLeads`. */
const SCREEN_FILTERS = {
  searchQuery: "", filterOrigin: "all", filterQualification: "all", filterClassificacao: "all",
  usaLeiDoErp: false, usaCadastroErpCafeJurere: false, filterUf: undefined, createdFrom: undefined,
  createdTo: undefined, filterAssignment: "all" as const, filterResponsible: "all",
};
const SCREEN_SORT = { key: "created_at", direction: "desc" } as const;
const pageKey = (page: number, over: Partial<typeof SCREEN_FILTERS> = {}) =>
  leadsKeys.list(ORG, page, { ...SCREEN_FILTERS, ...over }, SCREEN_SORT);
const pageParams = (page: number, over: Partial<typeof SCREEN_FILTERS> = {}) => ({ page, ...SCREEN_FILTERS, ...over, sort: SCREEN_SORT });

type Lead = Record<string, unknown> & { id?: unknown };
const ids = (data: unknown) => ((data as Lead[] | undefined) ?? []).map((l) => l.id);
const notesOf = (data: unknown, id: string) => ((data as Lead[] | undefined) ?? []).find((l) => l.id === id)?.notes;

/** UPDATE de coluna fora de recorte — o banco já tem o valor novo. */
function updateNotes(index: number, notes = "depois") {
  const target = db.rows[index] as ReturnType<typeof row>;
  db.rows[index] = { ...target, notes };
  emit("leads", { eventType: "UPDATE", new: realtimeNew(target, { notes }), old: { id: target.id } });
  return target.id;
}

describe("B2 — o patch não apaga a marca de velha das páginas ociosas", () => {
  it("página SEM o lead, marcada pelo INSERT: o patch em outro lead não a toca (nenhum dispatch); voltar a ela busca", async () => {
    await mountScreen();
    // Página 2 visitada antes e largada: em cache, sem observer.
    const page2 = pageKey(1);
    qc.setQueryData(page2, db.rows.slice(50, 100));
    emit("leads", freshInsert()); // "refetch": marca as ociosas
    const marked = qc.getQueryState(page2)!;
    expect(marked.isInvalidated).toBe(true);

    updateNotes(0); // lead da página 1
    const after = qc.getQueryState(page2)!;
    expect(after.isInvalidated).toBe(true);
    expect(after.dataUpdatedAt).toBe(marked.dataUpdatedAt);
    expect(after.dataUpdateCount).toBe(marked.dataUpdateCount);

    await advance(120_000);
    t0 = Date.now();
    renderHook(() => useLeads(pageParams(1)), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
  });

  it("(i) página COM o lead, marcada: recebe o patch sem perder a marca nem a idade; voltar a ela busca", async () => {
    await mountScreen();
    // Outro recorte, mesmos leads no topo — largado em cache.
    const other = pageKey(0, { filterQualification: "ouro" });
    qc.setQueryData(other, db.rows.slice(0, 50));
    emit("leads", freshInsert());
    const marked = qc.getQueryState(other)!;
    expect(marked.isInvalidated).toBe(true);
    await advance(1_000);

    const id = updateNotes(0);
    const after = qc.getQueryState(other)!;
    expect(notesOf(after.data, id)).toBe("depois");
    expect(after.isInvalidated).toBe(true);
    expect(after.dataUpdatedAt).toBe(marked.dataUpdatedAt);

    await advance(120_000);
    t0 = Date.now();
    renderHook(() => useLeads(pageParams(0, { filterQualification: "ouro" })), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
  });

  it("(i) página COM o lead, sem marca: recebe o patch sem renovar a idade — fica velha no prazo de antes", async () => {
    await mountScreen();
    const other = pageKey(0, { filterQualification: "ouro" });
    qc.setQueryData(other, db.rows.slice(0, 50));
    const before = qc.getQueryState(other)!;
    await advance(4 * 60_000);

    const id = updateNotes(0);
    const after = qc.getQueryState(other)!;
    expect(notesOf(after.data, id)).toBe("depois");
    expect(after.isInvalidated).toBe(false);
    expect(after.dataUpdatedAt).toBe(before.dataUpdatedAt);

    // 6 min de idade > staleTime de 5 min: voltar busca. Com a idade renovada
    // pelo patch (2 min), não buscaria.
    await advance(2 * 60_000);
    t0 = Date.now();
    renderHook(() => useLeads(pageParams(0, { filterQualification: "ouro" })), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
  });

  it("(ii) página ociosa BUSCANDO: marcada quando o retrato de antes chega, e continua marcada depois de outro patch", async () => {
    await mountScreen();
    const ouro = pageParams(0, { filterQualification: "ouro" });
    const key = pageKey(0, { filterQualification: "ouro" });
    const visited = renderHook(() => useLeads(ouro), { wrapper });
    await advance(50);
    visited.unmount(); // largada: em cache, sem observer, com queryFn

    // Um fetch dela começa (prefetch, outra aba…) e o UPDATE chega no meio.
    db.delayMs = 5_000;
    await act(async () => {
      void qc.refetchQueries({ queryKey: key, type: "inactive" });
    });
    expect(qc.getQueryState(key)?.fetchStatus).toBe("fetching");
    const first = updateNotes(0);
    await advance(6_000);
    expect(qc.getQueryState(key)?.fetchStatus).toBe("idle");
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);

    updateNotes(1);
    expect(qc.getQueryState(key)?.isInvalidated).toBe(true);

    db.delayMs = 0;
    t0 = Date.now();
    const back = renderHook(() => useLeads(ouro), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
    expect(notesOf(back.result.current.data, first)).toBe("depois");
  });
});

describe("remove e counts marcam as páginas ociosas — mesmo as que não têm o lead", () => {
  it("DELETE de lead da tela (remove): a página 2 ociosa, sem o lead, fica velha — voltar a ela busca e mostra o banco", async () => {
    await mountScreen();
    // Página 2 visitada antes e largada. O DELETE na página 1 desloca a 2.
    const page2 = pageKey(1);
    qc.setQueryData(page2, db.rows.slice(50, 100));
    const victim = db.rows[3];
    db.rows = db.rows.filter((r) => r !== victim);
    emit("leads", { eventType: "DELETE", new: {}, old: { id: victim.id } });
    expect(qc.getQueryState(page2)?.isInvalidated).toBe(true);

    await advance(60_000);
    t0 = Date.now();
    const back = renderHook(() => useLeads(pageParams(1)), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
    expect(ids(back.result.current.data)).toEqual(db.rows.slice(50, 100).map((r) => r.id));
  });

  it("UPDATE de lead fora da tela, depois da última linha (counts): a página ociosa que o tem fica velha — voltar a ela busca", async () => {
    await mountScreen();
    const page3 = pageKey(2);
    qc.setQueryData(page3, db.rows.slice(100, 150));
    const far = db.rows[110] as ReturnType<typeof row>;
    db.rows[110] = { ...far, notes: "depois" };
    emit("leads", { eventType: "UPDATE", new: realtimeNew(far, { notes: "depois" }), old: { id: far.id } });
    expect(qc.getQueryState(page3)?.isInvalidated).toBe(true);

    await advance(60_000);
    t0 = Date.now();
    const back = renderHook(() => useLeads(pageParams(2)), { wrapper });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
    expect(notesOf(back.result.current.data, far.id)).toBe("depois");
  });
});

describe("B1 — a linha da tela buscando não pisca", () => {
  it("UPDATE com a lista em voo: fica no valor de antes até o refetch, nunca novo → antigo → novo", async () => {
    await mountScreen();
    const own = pageKey(0);
    db.delayMs = 5_000;
    await act(async () => {
      void qc.invalidateQueries({ queryKey: ["leads", "list"] });
    });
    const id = updateNotes(0);

    const seen: unknown[] = [];
    for (let s = 0; s < 45; s++) {
      const now = notesOf(qc.getQueryData(own), id);
      if (seen[seen.length - 1] !== now) seen.push(now);
      await advance(1_000);
    }
    expect(seen).toEqual(["antes", "depois"]);
  });
});

describe("duas listas ATIVAS — cada dono decide a própria página", () => {
  it("DELETE de lead que está nas duas: as duas tiram já e completam a página", async () => {
    const { result } = await mountScreen();
    const picker = renderHook(() => useLeads(), { wrapper });
    await advance(50);

    const victim = db.rows[3];
    db.rows = db.rows.filter((r) => r !== victim);
    emit("leads", { eventType: "DELETE", new: {}, old: { id: victim.id } });
    await advance(0);
    expect(ids(result.current.list.data)).not.toContain(victim.id);
    expect(ids(picker.result.current.data)).not.toContain(victim.id);

    await advance(31_000);
    const expected = db.rows.slice(0, 50).map((r) => r.id);
    expect(ids(result.current.list.data)).toEqual(expected);
    expect(ids(picker.result.current.data)).toEqual(expected);
  });

  it("DELETE com a 2ª buscando: o retrato de antes não devolve o lead para sempre", async () => {
    const { result } = await mountScreen();
    const picker = renderHook(() => useLeads(), { wrapper });
    await advance(50);
    const victim = db.rows[3];
    // Ler `data` aqui também é o que faz o observer re-renderizar com ela
    // (o TanStack só notifica as props lidas).
    expect(ids(picker.result.current.data)).toContain(victim.id);

    db.delayMs = 3_000;
    await act(async () => {
      void picker.result.current.refetch();
    });
    db.rows = db.rows.filter((r) => r !== victim);
    emit("leads", { eventType: "DELETE", new: {}, old: { id: victim.id } });
    await advance(10 * 60_000);

    const expected = db.rows.slice(0, 50).map((r) => r.id);
    expect(ids(result.current.list.data)).toEqual(expected);
    expect(ids(picker.result.current.data)).toEqual(expected);
  });
});

describe("Café Jurerê — entradas de funil mudam a gaveta", () => {
  it("evento de pipeline_entries marca as páginas ociosas e refaz a lista da tela", async () => {
    const cafe = { usaCadastroErpCafeJurere: true };
    renderHook(() => useLeads(pageParams(0, cafe)), { wrapper });
    await advance(50);
    const page2 = pageKey(1, cafe);
    qc.setQueryData(page2, db.rows.slice(50, 100));
    t0 = Date.now();

    expect(emit("pipeline_entries", pipelineEvent())).toBeGreaterThan(0);
    expect(qc.getQueryState(page2)?.isInvalidated).toBe(true);
    await advance(31_000);
    expect(countOf(since(t0), "list")).toBe(1);
  });
});
