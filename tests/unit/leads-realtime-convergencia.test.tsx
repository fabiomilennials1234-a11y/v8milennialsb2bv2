/**
 * Convergência da lista de Leads quando o evento não chega a quem decide.
 *
 * Repros do QA da volta 3 (2026-10-06) viraram contrato. Dois furos:
 *
 *   F — o veredito `counts` ("o lead está depois da última linha, a página não
 *       muda") era decidido contra a página EM CACHE com a página da tela
 *       buscando: a página a caminho é outra, e a lista ficava velha para
 *       sempre (30 min, 0 busca). Idem DELETE de id fora do cache.
 *   B — evento entregue a um canal físico enquanto outro canal da MESMA
 *       tabela + filtro ainda está "joining" não chega ao segundo, e ninguém
 *       mais toca a página ativa dele. Na queda, o evento cai para todas.
 *       Conserto: `catchUpOnSubscribe` (recupera no SUBSCRIBED).
 *
 * O transporte dublado aqui dá a CADA instância o próprio canal físico — o
 * mundo de antes do canal compartilhado (#2245) e, hoje, o caso de canais
 * físicos distintos na mesma chave lógica. O canal compartilhado de verdade
 * (registry) está em `realtime-catchup-transporte-real`. No mais imita o de
 * verdade: o canal nasce no effect, `joining` até o SUBSCRIBED (só então
 * recebe evento), queda passa por `errored`, e cada transição chega na hora
 * em `onStateChange` (a 1ª com `initial`).
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
  /** > 0: a resposta sai depois disso — o retrato é tirado na CHAMADA, como no banco. */
  delayMs: 0,
}));

interface Sub {
  table: string;
  filter?: string;
  ref: { current: (p: unknown) => void };
  joined: boolean;
  tag: string;
  /** Muda o estado do canal: render (`state`) + `onStateChange`, como o transporte. */
  setState: (s: string) => void;
  timer: ReturnType<typeof setTimeout> | null;
}
const RT = vi.hoisted(() => ({ subs: new Set<Sub>(), joinDelayMs: 0, tag: "" }));

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
      channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
      removeChannel: vi.fn(),
    },
  };
});

// Transporte: canal nasce no effect; `joining` até o SUBSCRIBED (só então
// recebe evento); handler lido por ref, como no de verdade.
vi.mock("@/shared/realtime/useRealtimeChannel", async () => {
  const R = await import("react");
  return {
    useRealtimeChannel: (opts: {
      table: string;
      filter?: string;
      onEvent: (p: unknown) => void;
      onStateChange?: (c: { state: string; failureCount: number; initial: boolean }) => void;
      enabled?: boolean;
    }) => {
      const ref = R.useRef(opts.onEvent);
      ref.current = opts.onEvent;
      const changeRef = R.useRef(opts.onStateChange);
      changeRef.current = opts.onStateChange;
      const enabled = opts.enabled ?? true;
      const [state, setRenderState] = R.useState("idle");
      R.useEffect(() => {
        if (!enabled) {
          setRenderState("idle");
          return;
        }
        let initial = true;
        let failures = 0;
        const setState = (s: string) => {
          failures = s === "joined" ? 0 : s === "errored" ? failures + 1 : failures;
          setRenderState(s);
          const first = initial;
          initial = false;
          changeRef.current?.({ state: s, failureCount: failures, initial: first });
        };
        const sub: Sub = { table: opts.table, filter: opts.filter, ref, joined: false, tag: RT.tag, setState, timer: null };
        setState("joining");
        sub.timer = setTimeout(() => {
          sub.joined = true;
          setState("joined");
        }, RT.joinDelayMs);
        RT.subs.add(sub);
        return () => {
          if (sub.timer) clearTimeout(sub.timer);
          RT.subs.delete(sub);
        };
      }, [opts.table, opts.filter, enabled]);
      return { state, diagnostics: [] };
    },
  };
});
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
/** O que o realtime manda: colunas cruas, timestamptz em texto do PG. */
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
/** Lead novo, criado agora: entra no topo da página 1. Já está no banco. */
function insertTop(org = "org-1"): Row {
  seq++;
  const r = row(-seq, org, { id: `${org}-new-${seq}`, created_at: iso(BASE + seq * 1000), updated_at: iso(BASE + seq * 1000) });
  db.rows = [...db.rows, r];
  return r;
}
const insertEvt = (r: Row) => ({ eventType: "INSERT", new: rt(r), old: {} });
const sideEvt = () => ({ eventType: "UPDATE", new: { id: `pe-${seq}`, organization_id: H.org.id, lead_id: "x" }, old: {} });

/** Entrega a todo canal JÁ SUBSCRIBED na tabela (e da org do evento). */
function emit(table: string, payload: Record<string, unknown>) {
  let n = 0;
  for (const sub of [...RT.subs]) {
    if (sub.table !== table || !sub.joined) continue;
    const org = (payload.new as Record<string, unknown> | undefined)?.organization_id;
    if (sub.filter && payload.eventType !== "DELETE" && org && sub.filter !== `organization_id=eq.${org}`) continue;
    sub.ref.current({ schema: "public", table, commit_timestamp: new Date().toISOString(), errors: null, ...payload });
    n++;
  }
  return n;
}
/** Queda do canal das instâncias marcadas com `tag` (CHANNEL_ERROR); volta em `rejoinMs`. */
async function drop(tag: string, rejoinMs: number) {
  await act(async () => {
    for (const sub of RT.subs) {
      if (sub.tag !== tag) continue;
      if (sub.timer) clearTimeout(sub.timer);
      sub.joined = false;
      sub.setState("errored");
      sub.timer = setTimeout(() => {
        sub.joined = true;
        sub.setState("joined");
      }, rejoinMs);
    }
  });
}

const since = (from: number, until = Number.POSITIVE_INFINITY) => db.calls.filter((c) => c.at >= from && c.at < until);
const countOf = (calls: Call[], kind: Kind) => calls.filter((c) => c.kind === kind).length;
const tally = (calls: Call[]) => ({ list: countOf(calls, "list"), count: countOf(calls, "count"), stats: countOf(calls, "stats"), relation: countOf(calls, "relation") });

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
/**
 * Relógio em passos curtos, cada um no seu `act`: o React só renderiza (e só
 * roda os effects, onde mora o SUBSCRIBED) quando o `act` fecha — um avanço
 * de 30 s num `act` só esconderia o SUBSCRIBED até o fim dele.
 */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(250, left)); });
  }
  if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ── O que Leads.tsx monta (lista + total/abas + cards) e um `useLeads` avulso ─

interface ScreenProps { filterResponsible?: string; tag?: string }
function useLeadsScreen(p: ScreenProps = {}) {
  const common = {
    searchQuery: "", filterOrigin: "all", filterQualification: "all", usaLeiDoErp: false,
    usaCadastroErpCafeJurere: false, filterUf: undefined, createdFrom: undefined, createdTo: undefined,
    filterAssignment: "all" as const, filterResponsible: p.filterResponsible ?? "all",
  };
  const sort = { key: "created_at", direction: "desc" } as const;
  const list = useLeads({ page: 0, ...common, filterClassificacao: "all", sort });
  // Lidos no render: o TanStack só re-renderiza pelas props lidas.
  void list.data; void list.fetchStatus;
  useLeadsCount({ ...common, filterClassificacao: "all" });
  useLeadsCount({ ...common, filterClassificacao: "lead" });
  useLeadsCount({ ...common, filterClassificacao: "cliente" });
  useLeadsCount({ ...common, filterClassificacao: "perdido" });
  useLeadsStats({
    searchQuery: "", filterOrigin: common.filterOrigin, filterQualification: common.filterQualification, filterClassificacao: "all",
    usaLeiDoErp: false, usaCadastroErpCafeJurere: false, filterResponsible: common.filterResponsible,
    filterUf: undefined, createdFrom: undefined, createdTo: undefined,
  });
  return { list };
}
/** Tela de Leads; `joinDelayMs` > 0 = canal dela "joining" por esse tempo. */
async function mountScreen(p: ScreenProps = {}, opts: { joinDelayMs?: number } = {}) {
  RT.joinDelayMs = opts.joinDelayMs ?? 0;
  RT.tag = p.tag ?? "A";
  const hook = renderHook((props: ScreenProps) => useLeadsScreen(props), { wrapper, initialProps: p });
  RT.joinDelayMs = 0;
  RT.tag = "";
  await advance(50);
  return hook;
}
type PickerProps = { params?: Record<string, unknown>; enabled?: boolean };
function usePicker(p: PickerProps) {
  const q = useLeads(p.params ?? {}, { enabled: p.enabled ?? true });
  void q.data; void q.fetchStatus;
  return q;
}
/** Um `useLeads` extra (picker, PriorityLeads); `joinDelayMs` > 0 = "joining" por esse tempo. */
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
function expectedPage(org: string, owner?: string) {
  const ops: Op[] = [["eq", "organization_id", org]];
  if (owner) ops.push(["or", `responsible_id.eq.${owner}`]);
  return listRowsFor(ops).slice(0, 50).map((r) => `${r.id}|${r.notes}|${r.responsible_id}`);
}
const matches = (data: unknown, org = "org-1", owner?: string) => JSON.stringify(shown(data)) === JSON.stringify(expectedPage(org, owner));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 3_600_000));
  setVisibility("visible");
  H.org.id = "org-1";
  db.calls.length = 0;
  db.rows = [...Array.from({ length: 120 }, (_, i) => row(i, "org-1")), ...Array.from({ length: 60 }, (_, i) => row(i, "org-2"))];
  db.matching = 1500;
  db.delayMs = 0;
  RT.subs.clear();
  RT.joinDelayMs = 0;
  RT.tag = "";
  seq = 0;
  // Os defaults de App.tsx (retry desligado só para não poluir a contagem).
  qc = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true, retry: false } },
  });
});
afterEach(() => {
  qc.clear();
  setVisibility("visible");
  vi.useRealTimers();
});

// ── F. Veredito decidido contra a página em cache, com a da tela buscando ───

describe("F — evento com a página da tela EM VOO", () => {
  /**
   * Tela filtrada pelo responsável A. Um lead da página sai do filtro (refetch
   * agendado para +30 s). O fetch sai em +30 s (3 s de voo, retrato de +30 s,
   * em que L — o 51º — já entra na página). Em +31 s, com o fetch em voo,
   * chega o evento de L: na página EM CACHE, L está depois da última linha.
   */
  async function setup() {
    const A = await mountScreen({ filterResponsible: UUID_A });
    const L = db.rows[50];
    emit("leads", updEvt(dbUpdate(db.rows[2].id, { responsible_id: UUID_B })));
    await advance(29_900);
    db.delayMs = 3_000;
    await advance(1_100);
    expect(A.result.current.list.fetchStatus).toBe("fetching");
    return { A, L };
  }

  it("F1 coluna fora de recorte do lead que a página a caminho traz → a linha fica certa (antes: velha 30 min, 0 busca)", async () => {
    const { A, L } = await setup();
    emit("leads", updEvt(dbUpdate(L.id, { notes: "depois" })));
    await advance(2_500);
    expect(noteOf(A.result.current.list.data, L.id)).toBe("antes");
    db.delayMs = 0;
    await advance(30_000);
    expect(noteOf(A.result.current.list.data, L.id)).toBe("depois");
    await advance(30 * 60_000);
    expect(matches(A.result.current.list.data, "org-1", UUID_A)).toBe(true);
  });

  it("F2 INSERT entre a última linha em cache e L → entra na página (antes: nunca)", async () => {
    const { A, L } = await setup();
    const lastCached = db.rows[49];
    const mid = Date.parse(String(lastCached.created_at)) - 30_000;
    const N = row(0, "org-1", { id: "org-1-mid", name: "Mid", created_at: iso(mid), updated_at: iso(mid) });
    db.rows = [...db.rows, N];
    emit("leads", insertEvt(N));
    db.delayMs = 0;
    await advance(32_500);
    expect(has(A.result.current.list.data, N.id)).toBe(true);
    expect(has(A.result.current.list.data, L.id)).toBe(false);
    expect(matches(A.result.current.list.data, "org-1", UUID_A)).toBe(true);
  });

  it("DELETE de lead fora do cache que a página a caminho traz → sai (sem fantasma)", async () => {
    const { A, L } = await setup();
    db.rows = db.rows.filter((r) => r.id !== L.id);
    emit("leads", delEvt(L.id));
    db.delayMs = 0;
    await advance(32_500);
    expect(has(A.result.current.list.data, L.id)).toBe(false);
    expect(matches(A.result.current.list.data, "org-1", UUID_A)).toBe(true);
  });

  it("controle: o mesmo evento com a página PARADA continua sem custo de lista", async () => {
    const A = await mountScreen({ filterResponsible: UUID_A });
    const t0 = Date.now();
    emit("leads", updEvt(dbUpdate(db.rows[110].id, { notes: "depois" }))); // fora da tela, depois da última linha
    emit("leads", delEvt("lead-de-outra-org"));
    await advance(10 * 60_000);
    expect(countOf(since(t0), "list")).toBe(0);
    expect(matches(A.result.current.list.data, "org-1", UUID_A)).toBe(true);
  });
});

// ── B. O dono da página não recebeu o evento ────────────────────────────────

describe("B — canal do dono ainda entrando quando a irmã recebe o evento", () => {
  it("B1 patch, página do dono parada → o dono recupera no SUBSCRIBED (antes: velha para sempre)", async () => {
    const A = await mountScreen();
    const B = mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(100);
    const id = db.rows[0].id;
    expect(emit("leads", updEvt(dbUpdate(id, { notes: "depois" })))).toBe(1); // só A ouviu
    await advance(32_500);
    expect(noteOf(B.result.current.data, id)).toBe("depois");
    expect(noteOf(A.result.current.list.data, id)).toBe("depois");
  });

  it("B2 patch, página do dono buscando (fetch inicial lento) → converge", async () => {
    await mountScreen();
    db.delayMs = 3_000;
    const B = mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(500);
    const id = db.rows[0].id;
    emit("leads", updEvt(dbUpdate(id, { notes: "depois" })));
    await advance(40_000);
    expect(noteOf(B.result.current.data, id)).toBe("depois");
  });

  it("B3 INSERT → entra na página do dono", async () => {
    await mountScreen();
    const B = mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(100);
    const r = insertTop();
    emit("leads", insertEvt(r));
    await advance(32_500);
    expect(has(B.result.current.data, r.id)).toBe(true);
    expect(matches(B.result.current.data)).toBe(true);
  });

  it("B4 DELETE de lead nas duas páginas → sai da do dono (antes: fantasma)", async () => {
    await mountScreen();
    const B = mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(100);
    const victim = db.rows[3];
    expect(has(B.result.current.data, victim.id)).toBe(true);
    db.rows = db.rows.filter((r) => r.id !== victim.id);
    emit("leads", delEvt(victim.id));
    await advance(32_500);
    expect(has(B.result.current.data, victim.id)).toBe(false);
    expect(matches(B.result.current.data)).toBe(true);
  });

  it("B5b irmã com a lista desligada ouve; dono entrando e buscando → converge", async () => {
    await mountScreen();
    const Y = mountPicker({}, { joinDelayMs: 2_000, tag: "Y" });
    const X = mountPicker({ enabled: false });
    await advance(100);
    db.delayMs = 3_000;
    await act(async () => { void Y.result.current.refetch(); });
    const id = db.rows[0].id;
    emit("leads", updEvt(dbUpdate(id, { notes: "depois" })));
    await advance(40_000);
    expect(noteOf(Y.result.current.data, id)).toBe("depois");
    void X;
  });
});

// ── Recuperação no SUBSCRIBED: o que ela NÃO pode custar ────────────────────

describe("caso normal — nenhum evento no vão do join: 0 consulta extra", () => {
  it("1 lista com join de 2 s: só a montagem, nada mais em 10 min", async () => {
    await mountScreen({}, { joinDelayMs: 2_000 });
    const mounted = tally(db.calls);
    await advance(10 * 60_000);
    expect(tally(db.calls)).toEqual(mounted);
    expect(mounted).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
  });

  it("3 listas (tela + 2 pickers) com join de 2 s: só a montagem de cada uma", async () => {
    await mountScreen({}, { joinDelayMs: 2_000 });
    mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    mountPicker({ params: { searchQuery: "ana" } }, { joinDelayMs: 2_000, tag: "C" });
    await advance(50);
    const mounted = tally(db.calls);
    await advance(10 * 60_000);
    expect(tally(db.calls)).toEqual(mounted);
    expect(mounted.list).toBe(3);
  });

  it("evento que a irmã recebeu ANTES de o dono montar não custa nada ao dono", async () => {
    await mountScreen();
    emit("leads", updEvt(dbUpdate(db.rows[0].id, { notes: "depois" })));
    await advance(5_000);
    const t0 = Date.now();
    mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(10 * 60_000);
    expect(tally(since(t0))).toEqual({ list: 1, count: 0, stats: 0, relation: 0 }); // a montagem dele
  });

  it("troca de org sem evento no vão: só as consultas da troca (o 'joined' do canal velho não conta como volta)", async () => {
    const hook = await mountScreen();
    await advance(2 * 60_000);
    const t0 = Date.now();
    RT.joinDelayMs = 2_000;
    RT.tag = "A";
    H.org.id = "org-2";
    hook.rerender({});
    RT.joinDelayMs = 0;
    RT.tag = "";
    await advance(10 * 60_000);
    expect(tally(since(t0))).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
    expect(matches(hook.result.current.list.data, "org-2")).toBe(true);
  });

  it("página do dono buscada DEPOIS da entrega à irmã: a lista não é refeita", async () => {
    await mountScreen();
    const B = mountPicker({}, { joinDelayMs: 2_000, tag: "B" });
    await advance(100);
    emit("leads", updEvt(dbUpdate(db.rows[0].id, { notes: "depois" })));
    await act(async () => { void B.result.current.refetch(); }); // retrato já com o evento
    await advance(50);
    const t0 = Date.now();
    await advance(10 * 60_000);
    expect(countOf(since(t0), "list")).toBe(0);
    expect(noteOf(B.result.current.data, db.rows[0].id)).toBe("depois");
  });
});

describe("queda e volta do canal — recupera uma vez, sempre", () => {
  it("errored → joined sem evento: exatamente 1 busca da lista; contagens no máximo 1 cada", async () => {
    await mountScreen();
    await advance(2 * 60_000);
    const t0 = Date.now();
    await drop("A", 5_000);
    await advance(10 * 60_000);
    const after = tally(since(t0));
    expect(after.list).toBe(1);
    expect(after.count).toBeLessThanOrEqual(4);
    expect(after.stats).toBeLessThanOrEqual(2);
  });

  it("evento que caiu para todas durante a queda (B2/B6b de transporte) aparece depois da volta", async () => {
    const A = await mountScreen();
    const B = mountPicker({}, { tag: "A" });
    await advance(50);
    await drop("A", 5_000);
    const r = insertTop();
    expect(emit("leads", insertEvt(r))).toBe(0); // ninguém ouviu
    await advance(36_000);
    expect(has(A.result.current.list.data, r.id)).toBe(true);
    expect(has(B.result.current.data, r.id)).toBe(true);
  });

  it("duas quedas → duas recuperações; nenhuma busca em loop", async () => {
    await mountScreen();
    const t0 = Date.now();
    await drop("A", 1_000);
    await advance(3 * 60_000);
    await drop("A", 1_000);
    await advance(10 * 60_000);
    expect(countOf(since(t0), "list")).toBe(2);
  });
});

// ── Carga: os números do QA não pioram (transporte com join de verdade) ─────

describe("carga — mesmos números da volta 2", () => {
  it("rajada de 20 em 10 s (leads + funil/venda/negócio) → 7 consultas", async () => {
    await mountScreen();
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      emit("leads", insertEvt(insertTop()));
      emit("pipeline_entries", sideEvt()); emit("sale_events", sideEvt()); emit("deals", sideEvt());
      await advance(500);
    }
    await advance(70_000);
    expect(tally(since(t0))).toEqual({ list: 1, count: 4, stats: 2, relation: 0 });
  });

  it("5 min a 1 evento / 3 s → 39 consultas", async () => {
    await mountScreen();
    const t0 = Date.now();
    for (let s = 0; s < 100; s++) { emit("leads", insertEvt(insertTop())); emit("pipeline_entries", sideEvt()); await advance(3000); }
    expect(tally(since(t0, t0 + 300_000))).toEqual({ list: 9, count: 20, stats: 10, relation: 0 });
  });

  it("três instâncias, rajada de 20 → 9 consultas", async () => {
    await mountScreen();
    mountPicker();
    mountPicker({ params: { searchQuery: "ana" } });
    await advance(50);
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) { emit("leads", insertEvt(insertTop())); emit("pipeline_entries", sideEvt()); await advance(500); }
    await advance(70_000);
    expect(tally(since(t0))).toEqual({ list: 3, count: 4, stats: 2, relation: 0 });
  });
});

// ── D. Página ociosa: marca + patches + idade ───────────────────────────────

describe("D — página ociosa", () => {
  it("D1 INSERT marca → 5 patches → volta em 3 min: busca uma vez e mostra o banco", async () => {
    await mountScreen();
    const v = mountPicker({ params: { filterQualification: "ouro" } });
    await advance(50);
    v.unmount();
    const q = qc.getQueryCache().findAll({ queryKey: ["leads"] })
      .find((x) => Array.isArray(x.state.data) && (x.queryKey as unknown[]).includes("ouro"))!;
    const age0 = q.state.dataUpdatedAt;
    await advance(10_000);
    emit("leads", insertEvt(insertTop()));
    expect(q.state.isInvalidated).toBe(true);
    for (let i = 0; i < 5; i++) { emit("leads", updEvt(dbUpdate(db.rows[i].id, { notes: `p${i}` }))); await advance(30_000); }
    expect(q.state.isInvalidated).toBe(true);
    expect(q.state.dataUpdatedAt).toBe(age0);
    expect(noteOf(q.state.data, db.rows[0].id)).toBe("p0");
    await advance(3 * 60_000 - 160_000);
    const t0 = Date.now();
    const back = mountPicker({ params: { filterQualification: "ouro" } });
    await advance(50);
    expect(countOf(since(t0), "list")).toBe(1);
    expect(matches(back.result.current.data)).toBe(true);
  });
});
