/**
 * Recuperação no SUBSCRIBED × canal COMPARTILHADO — com o transporte DE
 * VERDADE (`useRealtimeChannel` + `realtimeChannelRegistry` + agendador). Só o
 * socket é falso: SUBSCRIBED por timer (`RT.joinDelayMs`), CHANNEL_ERROR à
 * mão, `RT.hold` segura o join.
 *
 * Origem: harness da QA volta 3 (#2244), reaplicado depois do merge com o
 * #2245 (canal compartilhado por tabela + filtro). O que ele trava:
 *   - caso normal: entrar num canal já vivo, ou durante o 1º join dele, custa
 *     só a montagem — 0 consulta extra, 1 canal por chave;
 *   - fan-out: a instância que entra recebe o mesmo evento que as irmãs;
 *   - reconexão: N instâncias no mesmo canal → no máximo 1 busca por query;
 *   - entrar com o canal caído (backoff, circuito aberto) ou trocar de org
 *     para um canal que outra instância já tem `joined` e vê-lo cair: o que
 *     se perdeu na queda aparece depois da volta (no merge cru: nunca).
 *
 * `emit` conta CANAIS FÍSICOS que receberam o evento.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const H = vi.hoisted(() => ({ org: { id: "org-1" } }));

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

const RT = vi.hoisted(() => {
  type Ch = { id: number; table: string; filter?: string; handler: (p: unknown) => void; cb: (s: string, e?: Error) => void; st: "joining" | "joined" | "errored" | "removed"; tag: string; api: unknown; createdAt: number };
  const chans: Ch[] = [];
  return {
    chans,
    joinDelayMs: 0,
    tag: "",
    hold: false,
    created: 0,
    subs: {
      get size() { return chans.filter((c) => c.st !== "removed").length; },
      clear() { for (const c of chans) c.st = "removed"; chans.length = 0; },
    },
  };
});

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
      channel: (name: string) => {
        RT.created += 1;
        const ch = { id: RT.created, name, table: "", filter: undefined as string | undefined, handler: (_p: unknown) => {}, cb: (_s: string, _e?: Error) => {}, st: "joining" as "joining" | "joined" | "errored" | "removed", tag: RT.tag, api: null as unknown, createdAt: Date.now() };
        const api: Record<string, unknown> = {
          on: (_type: string, cfg: { table: string; filter?: string }, h: (p: unknown) => void) => { ch.table = cfg.table; ch.filter = cfg.filter; ch.handler = h; return api; },
          subscribe: (cb: (s: string, e?: Error) => void) => {
            ch.cb = cb;
            RT.chans.push(ch as never);
            if (!RT.hold) setTimeout(() => { if (ch.st === "joining") { ch.st = "joined"; cb("SUBSCRIBED"); } }, RT.joinDelayMs);
            return api;
          },
        };
        ch.api = api;
        return api;
      },
      removeChannel: (api: unknown) => { const ch = RT.chans.find((c) => c.api === api); if (ch) ch.st = "removed"; return Promise.resolve("ok"); },
    },
  };
});

// Transporte: o DE VERDADE (useRealtimeChannel não é dublado).
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
import { realtimeChannelRegistrySnapshot } from "@/shared/realtime/realtimeChannelRegistry";
import { useLeadsStats } from "@/modules/leads/hooks/useLeadsStats";

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
function dbUpdate(id: string, over: Partial<Row>): Row {
  const i = db.rows.findIndex((r) => r.id === id);
  const next = { ...db.rows[i], ...over } as Row;
  db.rows = [...db.rows.slice(0, i), next, ...db.rows.slice(i + 1)];
  return next;
}
const updEvt = (r: Row) => ({ eventType: "UPDATE", new: rt(r), old: { id: r.id } });
const delEvt = (id: string) => ({ eventType: "DELETE", new: {}, old: { id } });
let seq = 0;
function insertTop(org = "org-1"): Row {
  seq++;
  const r = row(-seq, org, { id: `${org}-new-${seq}`, created_at: iso(BASE + seq * 1000), updated_at: iso(BASE + seq * 1000) });
  db.rows = [...db.rows, r];
  return r;
}
const insertEvt = (r: Row) => ({ eventType: "INSERT", new: rt(r), old: {} });

function emit(table: string, payload: Record<string, unknown>, deaf: string[] = []) {
  let n = 0;
  for (const ch of [...RT.chans]) {
    if (ch.table !== table || ch.st !== "joined" || deaf.includes(ch.tag)) continue;
    const org = (payload.new as Record<string, unknown> | undefined)?.organization_id;
    if (ch.filter && payload.eventType !== "DELETE" && org && ch.filter !== `organization_id=eq.${org}`) continue;
    ch.handler({ schema: "public", table, commit_timestamp: new Date().toISOString(), errors: null, ...payload });
    n++;
  }
  return n;
}

const since = (from: number, until = Number.POSITIVE_INFINITY) => db.calls.filter((c) => c.at >= from && c.at < until);
const countOf = (calls: Call[], kind: Kind) => calls.filter((c) => c.kind === kind).length;
const tally = (calls: Call[]) => ({ list: countOf(calls, "list"), count: countOf(calls, "count"), stats: countOf(calls, "stats"), relation: countOf(calls, "relation") });

let qc: QueryClient;
let strict = false;
const wrapper = ({ children }: { children: React.ReactNode }) => {
  const inner = React.createElement(QueryClientProvider, { client: qc }, children);
  return strict ? React.createElement(React.StrictMode, null, inner) : inner;
};
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(250, left)); });
  if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

interface ScreenProps { page?: number; filterResponsible?: string; filterOrigin?: string; listEnabled?: boolean; cafe?: boolean; filterQualification?: string }
function useLeadsScreen(p: ScreenProps = {}) {
  const common = {
    searchQuery: "", filterOrigin: p.filterOrigin ?? "all", filterQualification: p.filterQualification ?? "all", usaLeiDoErp: false,
    usaCadastroErpCafeJurere: p.cafe ?? false, filterUf: undefined, createdFrom: undefined, createdTo: undefined,
    filterAssignment: "all" as const, filterResponsible: p.filterResponsible ?? "all",
  };
  const sort = { key: "created_at", direction: "desc" } as const;
  const list = useLeads({ page: p.page ?? 0, ...common, filterClassificacao: "all", sort }, { enabled: p.listEnabled ?? true });
  // Lidos no render: o TanStack só re-renderiza pelas props lidas.
  void list.data; void list.fetchStatus;
  useLeadsCount({ ...common, filterClassificacao: "all" });
  useLeadsCount({ ...common, filterClassificacao: "lead" });
  useLeadsCount({ ...common, filterClassificacao: "cliente" });
  useLeadsCount({ ...common, filterClassificacao: "perdido" });
  useLeadsStats({
    searchQuery: "", filterOrigin: common.filterOrigin, filterQualification: common.filterQualification, filterClassificacao: "all",
    usaLeiDoErp: false, usaCadastroErpCafeJurere: common.usaCadastroErpCafeJurere, filterResponsible: common.filterResponsible,
    filterUf: undefined, createdFrom: undefined, createdTo: undefined,
  });
  return { list };
}
async function mountScreen(p: ScreenProps = {}) {
  const hook = renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: p });
  await advance(50);
  return hook;
}
type PickerProps = { params?: Record<string, unknown>; enabled?: boolean };
function usePicker(p: PickerProps) {
  const q = useLeads(p.params ?? {}, { enabled: p.enabled ?? true });
  void q.data; void q.fetchStatus;
  return q;
}
/** Monta um `useLeads` extra; `joinDelayMs` > 0 = canal dele "joining" por esse tempo. */
function mountPicker(p: PickerProps = {}, opts: { joinDelayMs?: number; tag?: string } = {}) {
  RT.joinDelayMs = opts.joinDelayMs ?? 0;
  RT.tag = opts.tag ?? "";
  const hook = renderHook((props: PickerProps) => usePicker(props), { wrapper, initialProps: p });
  RT.joinDelayMs = 0;
  RT.tag = "";
  return hook;
}

const shown = (data: unknown) => ((data as Row[] | undefined) ?? []).map((r) => `${r.id}|${r.notes}|${r.responsible_id}`);
const noteOf = (data: unknown, id: string) => ((data as Row[] | undefined) ?? []).find((r) => r.id === id)?.notes ?? "(ausente)";
const has = (data: unknown, id: string) => ((data as Row[] | undefined) ?? []).some((r) => r.id === id);
function expectedPage(org: string, page = 0, owner?: string) {
  const ops: Op[] = [["eq", "organization_id", org]];
  if (owner) ops.push(["or", `responsible_id.eq.${owner}`]);
  return listRowsFor(ops).slice(page * 50, page * 50 + 50).map((r) => `${r.id}|${r.notes}|${r.responsible_id}`);
}
const matches = (data: unknown, org = "org-1", page = 0, owner?: string) => JSON.stringify(shown(data)) === JSON.stringify(expectedPage(org, page, owner));
/** ms até a condição valer E CONTINUAR valendo por `holdMs` (pega o "pisca" novo → antigo). */
async function convergeMs(ok: () => boolean, maxMs: number, holdMs = 40_000) {
  const start = Date.now();
  let since: number | null = null;
  for (;;) {
    const now = Date.now();
    if (ok()) {
      if (since === null) since = now;
      if (now - since >= holdMs) return since - start;
    } else {
      since = null;
    }
    if (now - start >= maxMs + holdMs) return Number.POSITIVE_INFINITY;
    await advance(100);
  }
}

beforeEach(() => {
  // Canal compartilhado é estado de módulo: teste anterior que vazasse
  // instância deixaria canal vivo para o próximo.
  expect(realtimeChannelRegistrySnapshot()).toEqual([]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 3_600_000));
  setVisibility("visible");
  H.org.id = "org-1";
  db.calls.length = 0;
  db.rows = [...Array.from({ length: 120 }, (_, i) => row(i, "org-1")), ...Array.from({ length: 60 }, (_, i) => row(i, "org-2"))];
  db.matching = 1500;
  db.delayMs = 0;
  RT.subs.clear();
  RT.created = 0;
  RT.joinDelayMs = 0;
  RT.tag = "";
  RT.hold = false;
  strict = false;
  seq = 0;
  qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true, retry: false } },
  });
});
afterEach(() => {
  qc.clear();
  setVisibility("visible");
  vi.useRealTimers();
});

async function failChannels(table = "leads", states: Array<"joining" | "joined"> = ["joined"]) {
  let n = 0;
  await act(async () => {
    for (const ch of [...RT.chans]) {
      if (ch.table !== table || !states.includes(ch.st as "joining" | "joined")) continue;
      ch.st = "errored";
      ch.cb("CHANNEL_ERROR", new Error("boom"));
      n++;
    }
  });
  return n;
}
const liveCount = (table = "leads") => RT.chans.filter((c) => c.table === table && c.st === "joined").length;
const callsFrom = (i0: number) => db.calls.slice(i0) as Call[];
const AGE = 5 * 60_000;

// ── Caso normal ─────────────────────────────────────────────────────────────

describe("caso normal — entrar no canal compartilhado custa só a montagem", () => {
  it("tela sozinha, join de 300 ms, sem evento: 0 consulta em 5 min", async () => {
    RT.joinDelayMs = 300;
    renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: {} });
    await advance(1_000);
    const i1 = db.calls.length;
    expect(tally(db.calls)).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
    await advance(AGE);
    expect(tally(callsFrom(i1))).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
  });

  it("tela + 2 pickers (chaves de lista distintas): 1 canal e 0 consulta extra", async () => {
    RT.joinDelayMs = 300;
    renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: {} });
    mountPicker();
    mountPicker({ params: { searchQuery: "ana" } });
    await advance(1_500);
    const i1 = db.calls.length;
    expect(RT.subs.size).toBe(1);
    expect(RT.created).toBe(1);
    await advance(AGE);
    expect(tally(callsFrom(i1))).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
  });

  it("4 instâncias entram, uma a uma, num canal JÁ joined: só a montagem de cada uma", async () => {
    await mountScreen();
    await advance(AGE);
    for (let i = 0; i < 4; i++) {
      const i0 = db.calls.length;
      mountPicker(i % 2 ? {} : { params: { page: i } });
      await advance(50);
      const i1 = db.calls.length;
      expect(tally(db.calls.slice(i0, i1) as Call[])).toEqual({ list: 1, count: 0, stats: 0, relation: 0 });
      await advance(AGE);
      expect(tally(callsFrom(i1))).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
    }
    expect(RT.subs.size).toBe(1);
  });

  it("instância entra durante o 1º join do canal: 0 extra; o evento seguinte chega às duas", async () => {
    RT.joinDelayMs = 1_000;
    const A = renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: {} });
    await advance(300);
    const B = mountPicker();
    await advance(1_000);
    const i0 = db.calls.length;
    await advance(AGE);
    expect(tally(callsFrom(i0))).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
    expect(RT.created).toBe(1);
    const r = insertTop();
    expect(emit("leads", insertEvt(r))).toBe(1);
    const ms = await convergeMs(() => has(A.result.current.list.data, r.id) && has(B.result.current.data, r.id), 120_000, 1_000);
    expect(ms).toBeLessThanOrEqual(30_100);
  });

  it("StrictMode: tela + picker sem evento → 1 canal vivo, 0 extra", async () => {
    strict = true;
    RT.joinDelayMs = 300;
    renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: {} });
    mountPicker();
    await advance(1_000);
    const i1 = db.calls.length;
    await advance(AGE);
    expect(tally(callsFrom(i1))).toEqual({ list: 0, count: 0, stats: 0, relation: 0 });
    expect(liveCount()).toBe(1);
  });
});

// ── Fan-out ─────────────────────────────────────────────────────────────────

describe("fan-out — quem entra recebe o mesmo evento que as irmãs", () => {
  it("picker entra com a tela joined; patch → as duas mostram; DELETE → sai das duas na hora", async () => {
    const A = await mountScreen();
    const B = mountPicker();
    await advance(100);
    const id = db.rows[0].id;
    expect(emit("leads", updEvt(dbUpdate(id, { notes: "depois" })))).toBe(1);
    await advance(2_500);
    expect(noteOf(B.result.current.data, id)).toBe("depois");
    expect(noteOf(A.result.current.list.data, id)).toBe("depois");

    const victim = db.rows[3];
    db.rows = db.rows.filter((r) => r.id !== victim.id);
    emit("leads", delEvt(victim.id));
    await advance(0);
    expect(has(A.result.current.list.data, victim.id)).toBe(false);
    expect(has(B.result.current.data, victim.id)).toBe(false);
  });
});

// ── Reconexão ───────────────────────────────────────────────────────────────

describe("reconexão — N instâncias no mesmo canal, no máximo 1 busca por query", () => {
  it("5 instâncias (2 chaves de lista), 1 queda → 2 listas, 4 contagens, 2 cards", async () => {
    await mountScreen();
    for (let i = 0; i < 4; i++) mountPicker();
    await advance(100);
    await advance(AGE);
    expect(RT.subs.size).toBe(1);
    RT.joinDelayMs = 300;
    const i0 = db.calls.length;
    await failChannels("leads");
    await advance(120_000);
    expect(tally(callsFrom(i0))).toEqual({ list: 2, count: 4, stats: 2, relation: 0 });
  });

  it("10 quedas em 60 s, 1 instância, sem evento → 1 lista + contagens 1× (não 10)", async () => {
    const A = await mountScreen();
    await advance(AGE);
    RT.joinDelayMs = 300;
    const i0 = db.calls.length;
    for (let c = 0; c < 10; c++) {
      await failChannels("leads");
      await advance(6_000);
    }
    expect(tally(callsFrom(i0))).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
    expect(matches(A.result.current.list.data)).toBe(true);
    expect(liveCount()).toBe(1);
  });
});

// ── Recuperação ─────────────────────────────────────────────────────────────

describe("recuperação — o que caiu na queda aparece depois da volta", () => {
  it("troca de org para canal que OUTRA instância já tem joined; queda com INSERT perdido → a tela mostra", async () => {
    const A = await mountScreen();
    H.org.id = "org-2";
    mountPicker();
    await advance(100);
    const created = RT.created;
    A.rerender({});
    await advance(35_000);
    expect(RT.created).toBe(created); // entrou no canal da irmã
    RT.joinDelayMs = 300;
    await failChannels("leads");
    const lost = insertTop("org-2");
    expect(emit("leads", insertEvt(lost))).toBe(0);
    const ms = await convergeMs(() => has(A.result.current.list.data, lost.id), 10 * 60_000, 1_000);
    expect(ms).toBeLessThanOrEqual(32_000);
  });

  it("instância monta com o canal em backoff; INSERT perdido → ela mostra depois da volta", async () => {
    await mountScreen();
    await advance(AGE);
    RT.joinDelayMs = 300;
    await failChannels("leads");
    const B = mountPicker({ params: { searchQuery: "ana" } });
    await advance(50);
    const lost = insertTop();
    expect(emit("leads", insertEvt(lost))).toBe(0);
    const ms = await convergeMs(() => has(B.result.current.data, lost.id), 10 * 60_000, 1_000);
    expect(ms).toBeLessThanOrEqual(32_000);
  });

  it("instância monta com o circuito ABERTO (polling); INSERT perdido → ela mostra depois da sonda", async () => {
    await mountScreen();
    await advance(AGE);
    RT.hold = true;
    await failChannels("leads");
    for (let i = 0; i < 4; i++) { await advance(35_000); await failChannels("leads", ["joining"]); }
    const B = mountPicker({ params: { searchQuery: "ana" } });
    await advance(50);
    const lost = insertTop();
    expect(emit("leads", insertEvt(lost))).toBe(0);
    RT.hold = false;
    const ms = await convergeMs(() => has(B.result.current.data, lost.id), 10 * 60_000, 1_000);
    expect(ms).toBeLessThanOrEqual(151_000); // sonda em 120 s + prazo da lista
  });
});

// ── 1º join que falha ───────────────────────────────────────────────────────
// A instância que ABRE o canal entra com ele `joining` sem falha. Se esse 1º
// join cai (CHANNEL_ERROR/TIMED_OUT antes do SUBSCRIBED), o que entrou no
// banco nesse vão não chegou a ninguém — ela também tem de refazer no
// SUBSCRIBED seguinte, como quem entra com o canal já caído (revisor #2244 v13:
// antes, ficava com a lista velha para sempre).

describe("1º join que falha — quem abriu o canal também recupera", () => {
  /** A tela abre o canal; a montagem busca; o 1º join cai; um INSERT entra no vão. */
  async function openerWhoseFirstJoinFails() {
    RT.hold = true;
    const A = renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: {} });
    await advance(200);
    expect(RT.chans.map((c) => c.st)).toEqual(["joining"]);
    expect(await failChannels("leads", ["joining"])).toBe(1);
    return A;
  }

  it("tela sozinha: INSERT perdido no 1º join que falha → aparece depois da volta, 1 busca por query", async () => {
    const A = await openerWhoseFirstJoinFails();
    const lost = insertTop();
    expect(emit("leads", insertEvt(lost))).toBe(0);
    const i0 = db.calls.length;
    RT.hold = false;
    const ms = await convergeMs(() => has(A.result.current.list.data, lost.id), 10 * 60_000, 1_000);
    expect(ms).toBeLessThanOrEqual(32_000); // backoff 1 s + prazo da lista (30 s)
    expect(matches(A.result.current.list.data)).toBe(true);
    await advance(AGE);
    expect(tally(callsFrom(i0))).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
    expect(liveCount()).toBe(1);
  });

  it("1º join falha 5× → circuito aberto → sonda: INSERT perdido aparece depois da sonda", async () => {
    const A = await openerWhoseFirstJoinFails();
    const lost = insertTop();
    for (let i = 0; i < 4; i++) { await advance(35_000); await failChannels("leads", ["joining"]); }
    expect(emit("leads", insertEvt(lost))).toBe(0);
    RT.hold = false;
    const ms = await convergeMs(() => has(A.result.current.list.data, lost.id), 10 * 60_000, 1_000);
    expect(ms).toBeLessThanOrEqual(151_000); // sonda em 120 s + prazo da lista
  });

  it("irmã entra durante o backoff do 1º join: as DUAS recuperam, não só a que encontrou o canal caído", async () => {
    const A = await openerWhoseFirstJoinFails();
    const B = mountPicker({ params: { searchQuery: "ana" } });
    await advance(50);
    expect(RT.created).toBe(1); // entrou no mesmo canal, ainda em backoff
    const lost = insertTop();
    expect(emit("leads", insertEvt(lost))).toBe(0);
    RT.hold = false;
    // Instante em que CADA uma passa a mostrar (antes: B em ~31 s, A nunca).
    const shownAt: { a?: number; b?: number } = {};
    for (const t0 = Date.now(); Date.now() - t0 < 10 * 60_000 && (shownAt.a === undefined || shownAt.b === undefined); ) {
      if (shownAt.a === undefined && has(A.result.current.list.data, lost.id)) shownAt.a = Date.now() - t0;
      if (shownAt.b === undefined && has(B.result.current.data, lost.id)) shownAt.b = Date.now() - t0;
      await advance(100);
    }
    expect({ a: (shownAt.a ?? Infinity) <= 32_000, b: (shownAt.b ?? Infinity) <= 32_000 }).toEqual({ a: true, b: true });
    await advance(40_000);
    expect([has(A.result.current.list.data, lost.id), has(B.result.current.data, lost.id)]).toEqual([true, true]);
  });
});
