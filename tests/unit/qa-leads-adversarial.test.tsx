/**
 * Tela de Leads sob realtime — bateria adversarial do QA (2026-10-06):
 * corretude sob concorrência, carga e contagem com teto.
 *
 * Mesmo dublê de `leads-realtime-harness`, estendido: o banco é uma tabela
 * multi-org com filtro de org e de responsável aplicados na LISTA, retrato
 * tirado na chamada (como o Postgres).
 *
 * "duas listas ATIVAS…" foi o repro do 1g/1h: o patch de uma instância
 * escrevia na lista de outra que estava buscando; o dono dessa lista via a
 * linha já patchada, não pedia refetch, e o fetch em voo devolvia o retrato de
 * antes para sempre. Hoje cada lista ativa é editada só pelo próprio dono
 * (`useLeadsRealtime` → `editIdleLists`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const H = vi.hoisted(() => ({
  org: { id: "org-1" },
}));

type Op = [string, ...unknown[]];
type Kind = "list" | "count" | "stats" | "relation" | "other";
interface Call { table: string; ops: Op[]; kind: Kind; at: number; label: string; org: string | null }
type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, ...unknown[]]>; kind: string; at: number; label: string; org: string | null }>,
  rows: [] as Array<Record<string, unknown> & { id: string }>,
  matching: 1500,
  delayMs: 0,
}));

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function classify(ops: Op[]): { kind: Kind; label: string } {
  const sel = String(ops.find((o) => o[0] === "select")?.[1] ?? "");
  if (sel.includes("responsible:team_members")) return { kind: "list", label: "list" };
  if (sel.startsWith("id, ")) return { kind: "relation", label: "relation" };
  if (ops.some((o) => o[0] === "is" && o[1] === "deleted_at")) {
    return { kind: "stats", label: ops.some((o) => o[0] === "not" && o[1] === "responsible_id") ? "dono" : "mes" };
  }
  if (sel === "id" || sel === "*") {
    const aba = ops.find((o) => o[0] === "eq" && o[1] === "relacao_negocios");
    return { kind: "count", label: aba ? String(aba[2]) : "all" };
  }
  return { kind: "other", label: "other" };
}

/** O que o banco devolveria para a lista, AGORA. */
function listRowsFor(ops: Op[]): Row[] {
  const org = ops.find((o) => o[0] === "eq" && o[1] === "organization_id")?.[2];
  const ownerOr = ops.find((o) => o[0] === "or" && (String(o[1]).includes(UUID_A) || String(o[1]).includes(UUID_B)));
  const owner = ownerOr ? (String(ownerOr[1]).includes(UUID_A) ? UUID_A : UUID_B) : null;
  return db.rows
    .filter((r) => r.organization_id === org && r.deleted_at == null)
    .filter((r) => !owner || r.responsible_id === owner)
    .sort((a, b) => (String(b.created_at) < String(a.created_at) ? -1 : String(b.created_at) > String(a.created_at) ? 1 : a.id < b.id ? 1 : -1));
}

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const ops: Array<[string, ...unknown[]]> = [];
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
            const { kind, label } = classify(ops);
            const org = (ops.find((o) => o[0] === "eq" && o[1] === "organization_id")?.[2] as string) ?? null;
            db.calls.push({ table, ops, kind, at: Date.now(), label, org });
            const limit = ops.find((o) => o[0] === "limit")?.[1] as number | undefined;
            const range = ops.find((o) => o[0] === "range") as [string, number, number] | undefined;
            let result: unknown;
            if (kind === "list") {
              result = { data: listRowsFor(ops).slice(range?.[1] ?? 0, (range?.[2] ?? 49) + 1), error: null };
            } else if (kind === "count" || kind === "stats") {
              const n = limit ? Math.min(limit, db.matching) : db.matching;
              const head = ops.some((o) => o[0] === "select" && (o[2] as { head?: boolean } | undefined)?.head);
              result = { data: head ? null : Array.from({ length: n }, (_, i) => ({ id: `c-${i}` })), count: db.matching, error: null };
            } else {
              result = { data: [], error: null };
            }
            if (db.delayMs > 0) return new Promise((r) => setTimeout(() => r(result), db.delayMs)).then(resolve, reject);
            return Promise.resolve(result).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => { ops.push([prop, ...args]); return builder; };
      },
    });
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

const channels = vi.hoisted(() => new Map<(p: unknown) => void, { table: string; filter?: string; enabled?: boolean }>());
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { table: string; filter?: string; onEvent: (p: unknown) => void; enabled?: boolean }) => {
    channels.set(opts.onEvent, { table: opts.table, filter: opts.filter, enabled: opts.enabled });
    return { state: "joined", diagnostics: [] };
  },
}));
vi.mock("@/shared/realtime/realtime-org-context", () => ({ useRealtimeOrgId: () => H.org.id }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/identity/org-team/hooks/useOrganization")>();
  return {
    ...real,
    useOrganization: () => ({ organizationId: H.org.id, isReady: true, timezone: "America/Sao_Paulo" }),
    useRequiredOrganization: () => ({ organizationId: H.org.id, isReady: true, timezone: "America/Sao_Paulo", teamMemberId: "tm-1" }),
  };
});
vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({ isMaster: false, isReady: true, organizationId: H.org.id, teamMemberId: "tm-1", userId: "u-1" }),
}));

import { useLeads, useLeadsCount } from "@/modules/leads/hooks/useLeads";
import { useLeadsStats } from "@/modules/leads/hooks/useLeadsStats";
import { render } from "@testing-library/react";
import { LeadsStatsV2 } from "@/modules/leads/components/leads/LeadsStatsV2";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE = Date.UTC(2026, 9, 5, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "+00:00");
const pgText = (s: string) => s.replace("T", " ").replace("+00:00", "+00");

function row(i: number, org = "org-1", over: Partial<Row> = {}): Row {
  const created = iso(BASE - i * 60_000);
  return {
    id: `${org}-lead-${i}`, organization_id: org, name: `Lead ${i}`, company: null, email: null, phone: null,
    normalized_phone: null, origin: "outro", uf: null, qualification_tier: null, classificacao: null,
    relacao_negocios: "lead", is_shadow: false, deleted_at: null, erp_code: null, cafe_jurere_erp_elegivel: false,
    notes: "antes", ai_disabled: false, created_at: created, updated_at: created, responsible_id: UUID_A,
    sdr_id: null, closer_id: null, pre_sale_responsible_id: null, sale_responsible_id: null,
    responsible: { id: UUID_A, name: "Ana" }, sdr: null, closer: null, pre_sale_responsible: null,
    sale_responsible: null, lead_tags: [], ...over,
  };
}

function rt(r: Row, over: Record<string, unknown> = {}) {
  const { responsible: _1, sdr: _2, closer: _3, pre_sale_responsible: _4, sale_responsible: _5, lead_tags: _6, ...cols } = r;
  return { ...cols, created_at: pgText(String(r.created_at)), updated_at: pgText(String(r.updated_at)), ...over };
}

/** Substitui a linha (nunca muta: o retrato em voo guarda a referência antiga). */
function dbUpdate(id: string, over: Partial<Row>): Row {
  const i = db.rows.findIndex((r) => r.id === id);
  const next = { ...db.rows[i], ...over } as Row;
  db.rows = [...db.rows.slice(0, i), next, ...db.rows.slice(i + 1)];
  return next;
}

let qc: QueryClient;
/** Linha `id` em TODA página de lista em cache com observer — o que cada tela mostra. */
function cachedLists(id: string) {
  return qc.getQueryCache().findAll({ queryKey: ["leads"] })
    .filter((q) => Array.isArray(q.state.data) && q.getObserversCount() > 0)
    .map((q) => shown(q.state.data).find((x) => x.startsWith(id + "|")));
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Como o servidor: INSERT/UPDATE filtrados por org quando o canal tem filtro; DELETE vai a todos. */
function emit(table: string, payload: Record<string, unknown>) {
  let n = 0;
  for (const [onEvent, meta] of [...channels]) {
    if (meta.table !== table || meta.enabled === false) continue;
    const org = (payload.new as Record<string, unknown> | undefined)?.organization_id;
    if (meta.filter && payload.eventType !== "DELETE" && org && meta.filter !== `organization_id=eq.${org}`) continue;
    onEvent({ schema: "public", table, commit_timestamp: new Date().toISOString(), errors: null, ...payload });
    n++;
  }
  return n;
}

let seq = 0;
function insertTop(org = "org-1"): Row {
  seq++;
  const r = row(-seq, org, { id: `${org}-new-${seq}`, created_at: iso(BASE + seq * 1000), updated_at: iso(BASE + seq * 1000) });
  db.rows = [...db.rows, r];
  return r;
}
const insertEvt = (r: Row) => ({ eventType: "INSERT", new: rt(r), old: {} });
const sideEvt = () => ({ eventType: "UPDATE", new: { id: `pe-${seq}`, organization_id: H.org.id, lead_id: "x" }, old: {} });

const since = (from: number, until = Number.POSITIVE_INFINITY) => db.calls.filter((c) => c.at >= from && c.at < until);
const countOf = (calls: Call[], kind: Kind, label?: string) =>
  calls.filter((c) => c.kind === kind && (label === undefined || c.label === label)).length;
const tally = (calls: Call[]) => ({
  list: countOf(calls, "list"), count: countOf(calls, "count"), stats: countOf(calls, "stats"), relation: countOf(calls, "relation"),
});

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);

interface ScreenProps { page?: number; filterResponsible?: string; filterOrigin?: string; listEnabled?: boolean }
function useLeadsScreen(p: ScreenProps = {}) {
  const common = {
    searchQuery: "", filterOrigin: p.filterOrigin ?? "all", filterQualification: "all", usaLeiDoErp: false,
    usaCadastroErpCafeJurere: false, filterUf: undefined, createdFrom: undefined, createdTo: undefined,
    filterAssignment: "all" as const, filterResponsible: p.filterResponsible ?? "all",
  };
  const sort = { key: "created_at", direction: "desc" } as const;
  const list = useLeads({ page: p.page ?? 0, ...common, filterClassificacao: "all", sort }, { enabled: p.listEnabled ?? true });
  const total = useLeadsCount({ ...common, filterClassificacao: "all" });
  useLeadsCount({ ...common, filterClassificacao: "all" });
  useLeadsCount({ ...common, filterClassificacao: "lead" });
  useLeadsCount({ ...common, filterClassificacao: "cliente" });
  useLeadsCount({ ...common, filterClassificacao: "perdido" });
  const stats = useLeadsStats({
    searchQuery: "", filterOrigin: common.filterOrigin, filterQualification: "all", filterClassificacao: "all",
    usaLeiDoErp: false, usaCadastroErpCafeJurere: false, filterResponsible: common.filterResponsible,
    filterUf: undefined, createdFrom: undefined, createdTo: undefined,
  });
  return { list, total, stats };
}

async function mountScreen(p: ScreenProps = {}) {
  const hook = renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: p });
  await advance(50);
  return hook;
}

/** Página esperada AGORA (o que o banco devolveria), projetada em id+notes+responsável. */
function expectedPage(org: string, page = 0, owner?: string) {
  const ops: Op[] = [["eq", "organization_id", org]];
  if (owner) ops.push(["or", `responsible_id.eq.${owner}`]);
  return listRowsFor(ops).slice(page * 50, page * 50 + 50).map((r) => `${r.id}|${r.notes}|${r.responsible_id}`);
}
const shown = (data: unknown) => ((data as Row[] | undefined) ?? []).map((r) => `${r.id}|${r.notes}|${r.responsible_id}`);

/** ms até a tela bater com o banco (passo de 100 ms), ou Infinity. */
async function convergeMs(get: () => unknown, expected: () => string[], maxMs: number) {
  const start = Date.now();
  for (;;) {
    if (JSON.stringify(shown(get())) === JSON.stringify(expected())) return Date.now() - start;
    if (Date.now() - start >= maxMs) return Number.POSITIVE_INFINITY;
    await advance(100);
  }
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true, retry: false } },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 3_600_000));
  setVisibility("visible");
  H.org.id = "org-1";
  db.calls.length = 0;
  db.rows = [...Array.from({ length: 120 }, (_, i) => row(i, "org-1")), ...Array.from({ length: 60 }, (_, i) => row(i, "org-2"))];
  db.matching = 1500;
  db.delayMs = 0;
  channels.clear();
  seq = 0;
  qc = newClient();
});
afterEach(() => {
  qc.clear();
  setVisibility("visible");
  vi.useRealTimers();
});

// ── 1. Corretude sob concorrência ───────────────────────────────────────────

describe("1 — a tela converge para o banco", () => {
  it("INSERT no topo aparece na página 1 em ≤30 s", async () => {
    const { result } = await mountScreen();
    const r = insertTop();
    emit("leads", insertEvt(r));
    const ms = await convergeMs(() => result.current.list.data, () => expectedPage("org-1"), 120_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("DELETE de lead da tela: some já; página completa em ≤30 s", async () => {
    const { result } = await mountScreen();
    const victim = db.rows[3];
    db.rows = db.rows.filter((r) => r.id !== victim.id);
    emit("leads", { eventType: "DELETE", new: {}, old: { id: victim.id } });
    await advance(0);
    expect(shown(result.current.list.data).some((s) => s.startsWith(victim.id + "|"))).toBe(false);
    const ms = await convergeMs(() => result.current.list.data, () => expectedPage("org-1"), 120_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("UPDATE tira o lead do filtro de responsável → sai da tela em ≤30 s", async () => {
    const { result } = await mountScreen({ filterResponsible: UUID_A });
    const t = db.rows[2];
    const next = dbUpdate(t.id, { responsible_id: UUID_B });
    emit("leads", { eventType: "UPDATE", new: rt(next), old: { id: t.id } });
    const ms = await convergeMs(() => result.current.list.data, () => expectedPage("org-1", 0, UUID_A), 120_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("UPDATE com fetch em voo + troca de página e volta → página 0 certa em ≤30 s da volta", async () => {
    const hook = await mountScreen();
    db.delayMs = 3_000;
    await act(async () => { void qc.invalidateQueries({ queryKey: ["leads", "list"] }); });
    const t = db.rows[0];
    const next = dbUpdate(t.id, { notes: "depois" });
    emit("leads", { eventType: "UPDATE", new: rt(next), old: { id: t.id } });
    hook.rerender({ page: 1 });
    await advance(8_000);
    hook.rerender({ page: 0 });
    const ms = await convergeMs(() => hook.result.current.list.data, () => expectedPage("org-1"), 10 * 60_000);
    expect(ms).toBeLessThanOrEqual(30_000 + 2 * 3_000);
  });

  it("evento relevante seguido de troca de filtro e volta → a chave antiga não fica velha", async () => {
    const hook = await mountScreen();
    const r = insertTop();
    emit("leads", insertEvt(r));
    await advance(5_000);
    hook.rerender({ filterOrigin: "indicacao" });
    await advance(10_000);
    hook.rerender({});
    const ms = await convergeMs(() => hook.result.current.list.data, () => expectedPage("org-1"), 10 * 60_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("troca de org com evento pendente: nada da org antiga vai ao banco; org nova converge e recebe eventos", async () => {
    const hook = await mountScreen();
    emit("leads", insertEvt(insertTop("org-1")));
    await advance(5_000);
    const switchAt = Date.now();
    H.org.id = "org-2";
    hook.rerender({});
    await advance(100);
    // DELETE (não filtrável) de lead da org antiga e UPDATE da org antiga
    emit("leads", { eventType: "DELETE", new: {}, old: { id: "org-1-lead-5" } });
    emit("leads", { eventType: "UPDATE", new: rt(db.rows[6], { notes: "x" }), old: { id: db.rows[6].id } });
    await advance(120_000);
    const leak = since(switchAt).filter((c) => c.table === "leads" && c.org === "org-1");
    expect(leak).toHaveLength(0);
    expect(shown(hook.result.current.list.data)).toEqual(expectedPage("org-2"));
    // e a org nova ainda recebe evento
    const r2 = insertTop("org-2");
    expect(emit("leads", insertEvt(r2))).toBeGreaterThan(0);
    const ms = await convergeMs(() => hook.result.current.list.data, () => expectedPage("org-2"), 120_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("duas listas ATIVAS (tela + picker), ambas buscando (mutação invalidou ['leads']), UPDATE fora de recorte → as duas convergem", async () => {
    await mountScreen();
    renderHook(() => useLeads(), { wrapper });
    await advance(50);
    db.delayMs = 3_000;
    await act(async () => { void qc.invalidateQueries({ queryKey: ["leads"] }); });
    const t = db.rows[0];
    const next = dbUpdate(t.id, { notes: "depois" });
    emit("leads", { eventType: "UPDATE", new: rt(next), old: { id: t.id } });
    await advance(10 * 60_000);
    const all = cachedLists(t.id);
    expect(all).toHaveLength(2);
    for (const x of all) expect(x).toBe(`${t.id}|depois|${UUID_A}`);
  });

  it("duas listas ATIVAS, só a 2ª (montada depois) buscando, UPDATE fora de recorte → a 2ª converge", async () => {
    await mountScreen();
    const picker = renderHook(() => useLeads(), { wrapper });
    await advance(50);
    db.delayMs = 3_000;
    await act(async () => { void picker.result.current.refetch(); });
    const t = db.rows[0];
    const next = dbUpdate(t.id, { notes: "depois" });
    emit("leads", { eventType: "UPDATE", new: rt(next), old: { id: t.id } });
    await advance(10 * 60_000);
    const all = cachedLists(t.id);
    expect(all).toHaveLength(2);
    for (const x of all) expect(x).toBe(`${t.id}|depois|${UUID_A}`);
  });

  it("controle: só a 1ª (montada antes) buscando → converge", async () => {
    const screen = await mountScreen();
    renderHook(() => useLeads(), { wrapper });
    await advance(50);
    db.delayMs = 3_000;
    await act(async () => { void screen.result.current.list.refetch(); });
    const t = db.rows[0];
    const next = dbUpdate(t.id, { notes: "depois" });
    emit("leads", { eventType: "UPDATE", new: rt(next), old: { id: t.id } });
    await advance(10 * 60_000);
    expect(shown(screen.result.current.list.data).find((x) => x.startsWith(t.id + "|"))).toBe(`${t.id}|depois|${UUID_A}`);
  });
});

// ── 2. Carga ─────────────────────────────────────────────────────────────────

describe("2 — carga", () => {
  it("rajada 20 eventos/10 s (leads + funil + venda + deals)", async () => {
    await mountScreen();
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      emit("sale_events", sideEvt());
      emit("deals", sideEvt());
      await advance(500);
    }
    await advance(70_000);
    const n = tally(since(t0));
    expect(n.list).toBe(1);
    expect(n.count).toBeLessThanOrEqual(4);
    expect(n.stats).toBeLessThanOrEqual(2);
  });

  it("fluxo contínuo 5 min, 1 evento/s", async () => {
    await mountScreen();
    const t0 = Date.now();
    for (let s = 0; s < 300; s++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      await advance(1000);
    }
    const n = tally(since(t0, t0 + 300_000));
    expect(n.list).toBeLessThanOrEqual(11);
    // 4 abas + 2 cards, ≤1 por minuto cada → ≤ 6×5
    expect(n.count + n.stats).toBeLessThanOrEqual(30);
  });

  it("fluxo 5 min, 1 evento a cada 3 s (o antigo dispara entre eventos)", async () => {
    await mountScreen();
    const t0 = Date.now();
    for (let s = 0; s < 100; s++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      await advance(3000);
    }
    const n = tally(since(t0, t0 + 300_000));
    expect(n.list).toBeLessThanOrEqual(11);
    expect(n.count + n.stats).toBeLessThanOrEqual(30);
  });

  it("aba oculta 5 min com 1 evento/s, depois volta", async () => {
    await mountScreen();
    const t0 = Date.now();
    setVisibility("hidden");
    for (let s = 0; s < 300; s++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      await advance(1000);
    }
    const hidden = tally(since(t0));
    const back = Date.now();
    await act(async () => setVisibility("visible"));
    await advance(60_000);
    const after = tally(since(back));
    expect(hidden).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
    expect(after.list).toBe(1);
    expect(after.count).toBe(4);
    expect(after.stats).toBe(2);
  });

  it("3 instâncias de useLeads (tela + PriorityLeads + picker): rajada e 2 min contínuos", async () => {
    await mountScreen();
    renderHook(() => useLeads(), { wrapper });
    renderHook(() => useLeads({ searchQuery: "ana" }), { wrapper });
    await advance(50);
    let t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      await advance(500);
    }
    await advance(70_000);
    const burst = tally(since(t0));
    t0 = Date.now();
    for (let s = 0; s < 120; s++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt());
      await advance(1000);
    }
    const cont = tally(since(t0, t0 + 120_000));
    expect(burst.list).toBe(3);
    expect(cont.list).toBeLessThanOrEqual(3 * 5);
  });
});

// ── 3. Contagem com teto ────────────────────────────────────────────────────

describe("3 — contagem com teto", () => {
  for (const [n, value, capped] of [[0, 0, false], [999, 999, false], [1000, 1000, true], [1001, 1000, true], [12686, 1000, true]] as const) {
    it(`${n} linhas no recorte → { value: ${value}, capped: ${capped} } em total e cards`, async () => {
      db.matching = n;
      const { result } = await mountScreen();
      expect(result.current.total.data).toEqual({ value, capped });
      expect(result.current.stats.data?.withOwner).toEqual({ value, capped });
      expect(result.current.stats.data?.thisMonth).toEqual({ value, capped });
    });
  }
});

// PRÉ-EXISTENTE, FORA DO ESCOPO — follow-up aberto: o código antigo também
// subtraía/dividia `withOwner` da org por um `total` que, no deep-link, é a aba
// "sem responsável" ("333%", "0 sem responsável" na V5; "0 sem dono" na
// clássica). Não é deste diff de perf; destravar este bloco junto do conserto.
describe.skip("3b — cards com teto no deep-link ?atribuicao=sem-responsavel", () => {
  it("total = aba 'sem responsável' (exato 300) e 'com responsável' da org no teto: nada derivado do piso", () => {
    vi.useRealTimers();
    const { container } = render(
      React.createElement(LeadsStatsV2 as React.ComponentType<Record<string, unknown>>, {
        total: { value: 300, capped: false },
        thisMonth: { value: 40, capped: false },
        withOwner: { value: 1000, capped: true },
      }),
    );
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(/333/);
    expect(text).not.toMatch(/Todos têm dono|nenhum sem dono|\b0 sem dono/);
  });
});
