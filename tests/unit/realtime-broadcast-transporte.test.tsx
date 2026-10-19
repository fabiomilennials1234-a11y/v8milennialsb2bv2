/**
 * Broadcast S1 no cliente: plano → transporte → registry → consumidor.
 *
 * O contrato que importa: com o plano `broadcast`, os consumidores de
 * `pipeline_entries` recebem o MESMO formato de evento de antes, por UM canal
 * privado por org por aba, e o recorte (`lead_id=eq.X`) continua valendo — só
 * que no cliente. Sem plano, plano `pg_changes`, falha ou filtro que o cliente
 * não reproduz: tudo exatamente como antes (postgres_changes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

type Cb = (...args: unknown[]) => void;
interface FakeChannel {
  name: string;
  opts: unknown;
  kind: string | null;
  cfg: unknown;
  onEvent: Cb | null;
  onStatus: Cb | null;
  on: (kind: string, cfg: unknown, cb: Cb) => FakeChannel;
  subscribe: (cb: Cb) => FakeChannel;
}

const { created, removed, rpcImpl, removeImpl } = vi.hoisted(() => ({
  created: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  rpcImpl: { fn: null as null | ((name: string, args: unknown) => unknown) },
  removeImpl: { fn: null as null | ((ch: FakeChannel) => Promise<unknown>) },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn((name: string, opts?: unknown) => {
      const ch = { name, opts, kind: null, cfg: null, onEvent: null, onStatus: null } as unknown as FakeChannel;
      ch.on = (kind, cfg, cb) => {
        ch.kind = kind;
        ch.cfg = cfg;
        ch.onEvent = cb;
        return ch;
      };
      ch.subscribe = (cb) => {
        ch.onStatus = cb;
        return ch;
      };
      created.push(ch);
      return ch;
    }),
    removeChannel: vi.fn((ch: FakeChannel) => {
      removed.push(ch);
      return removeImpl.fn ? removeImpl.fn(ch) : Promise.resolve("ok");
    }),
    rpc: vi.fn((name: string, args: unknown) => rpcImpl.fn?.(name, args)),
  },
}));

vi.mock("@/lib/realtimeStatusStore", () => ({
  setChannelState: vi.fn(),
  incrementFailures: vi.fn().mockReturnValue(1),
  resetFailures: vi.fn(),
  openCircuitBreaker: vi.fn(),
  recordChannelEvent: vi.fn(),
}));

import { supabase } from "@/integrations/supabase/client";
import { RealtimeOrgProvider } from "@/shared/realtime/realtime-org-context";
import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import { realtimeChannelRegistrySnapshot } from "@/shared/realtime/realtimeChannelRegistry";
import {
  PLAN_TIMEOUT_MS,
  PLAN_TTL_MS,
  __resetRealtimeTransportPlan,
} from "@/shared/realtime/realtimeTransportPlan";
import {
  broadcastSupports,
  envelopeToPayload,
  parseEqFilter,
  payloadMatches,
} from "@/shared/realtime/broadcastTransport";

const ORG = "0a000000-0000-0000-0000-000000000001";
const OTHER = "0a000000-0000-0000-0000-000000000002";
const TOPIC = `org:${ORG}:pe`;

const wrapper =
  (org: string | null) =>
  ({ children }: { children: ReactNode }) => <RealtimeOrgProvider organizationId={org}>{children}</RealtimeOrgProvider>;

const planReturns = (pe: "broadcast" | "pg_changes") => {
  rpcImpl.fn = (name) =>
    name === "realtime_subscription_plan"
      ? Promise.resolve({ data: { v: 1, pipeline_entries: pe }, error: null })
      : Promise.resolve({ data: null, error: null });
};

const flush = () => act(async () => {});

const envelope = (op: "INSERT" | "UPDATE" | "DELETE", row: Record<string, unknown> | null, old: Record<string, unknown> | null = null) => ({
  type: "broadcast",
  event: "pipeline_entries",
  payload: { v: 1, t: "pipeline_entries", op, id: (row ?? old)!.id, row, old, ts: "2026-10-19T12:00:00Z" },
});

const bcChannels = () => created.filter((c) => c.kind === "broadcast");
const pgChannels = () => created.filter((c) => c.kind === "postgres_changes");

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
  rpcImpl.fn = null;
  removeImpl.fn = null;
  vi.clearAllMocks();
  __resetRealtimeTransportPlan();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("broadcastTransport (puro)", () => {
  it("envelope → payload no formato do postgres_changes", () => {
    const row = { id: "e1", stage_key: "b", pipeline_id: "p" };
    expect(envelopeToPayload("pipeline_entries", envelope("INSERT", row).payload)).toMatchObject({
      eventType: "INSERT", schema: "public", table: "pipeline_entries", new: row, old: {}, errors: [],
      commit_timestamp: "2026-10-19T12:00:00Z",
    });
    expect(envelopeToPayload("pipeline_entries", envelope("UPDATE", row, { id: "e1", stage_key: "a" }).payload)).toMatchObject({
      eventType: "UPDATE", new: row, old: { id: "e1", stage_key: "a" },
    });
    expect(envelopeToPayload("pipeline_entries", envelope("DELETE", null, row).payload)).toMatchObject({
      eventType: "DELETE", new: {}, old: row,
    });
  });

  it("envelope de outra tabela, outra versão ou lixo → ignorado", () => {
    const ok = envelope("INSERT", { id: "e1" }).payload;
    expect(envelopeToPayload("leads", ok)).toBeNull();
    expect(envelopeToPayload("pipeline_entries", { ...ok, v: 2 })).toBeNull();
    expect(envelopeToPayload("pipeline_entries", { ...ok, op: "TRUNCATE" })).toBeNull();
    expect(envelopeToPayload("pipeline_entries", null)).toBeNull();
    expect(envelopeToPayload("pipeline_entries", "x")).toBeNull();
  });

  it("filtro eq: INSERT/UPDATE olham a linha nova, DELETE a antiga", () => {
    const f = parseEqFilter("lead_id=eq.L1");
    expect(f).toEqual({ column: "lead_id", value: "L1" });
    const ins = envelopeToPayload("pipeline_entries", envelope("INSERT", { id: "e", lead_id: "L1" }).payload)!;
    const other = envelopeToPayload("pipeline_entries", envelope("INSERT", { id: "e", lead_id: "L2" }).payload)!;
    const del = envelopeToPayload("pipeline_entries", envelope("DELETE", null, { id: "e", lead_id: "L1" }).payload)!;
    expect(payloadMatches(ins, f)).toBe(true);
    expect(payloadMatches(other, f)).toBe(false);
    expect(payloadMatches(del, f)).toBe(true);
    expect(payloadMatches(other, null)).toBe(true);
  });

  it("só vai para o broadcast o que o cliente consegue recortar", () => {
    expect(broadcastSupports("pipeline_entries", undefined)).toBe(true);
    expect(broadcastSupports("pipeline_entries", `organization_id=eq.${ORG}`)).toBe(true);
    expect(broadcastSupports("pipeline_entries", "lead_id=eq.L1")).toBe(true);
    expect(broadcastSupports("pipeline_entries", "metadata=eq.x")).toBe(false); // fora da allowlist
    expect(broadcastSupports("pipeline_entries", "notes=eq.x")).toBe(false);
    expect(broadcastSupports("pipeline_entries", "lead_id=in.(a,b)")).toBe(false);
    expect(broadcastSupports("leads", undefined)).toBe(false);
  });
});

describe("plano → transporte", () => {
  it("plano broadcast: 1 canal privado da org, evento convertido entregue", async () => {
    planReturns("broadcast");
    const onEvent = vi.fn();
    renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${ORG}`, onEvent }),
      { wrapper: wrapper(ORG) },
    );
    expect(created).toHaveLength(0); // plano chegando: espera, não abre postgres_changes
    await flush();
    expect(bcChannels()).toHaveLength(1);
    expect(pgChannels()).toHaveLength(0);
    const ch = bcChannels()[0];
    expect(ch.name).toBe(TOPIC);
    expect(ch.opts).toEqual({ config: { private: true } });
    expect(ch.cfg).toEqual({ event: "pipeline_entries" });
    expect(supabase.rpc).toHaveBeenCalledWith("realtime_subscription_plan", { p_organization_id: ORG });

    act(() => ch.onStatus!("SUBSCRIBED"));
    act(() => ch.onEvent!(envelope("UPDATE", { id: "e1", organization_id: ORG, stage_key: "b" }, { id: "e1", stage_key: "a" })));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toMatchObject({ eventType: "UPDATE", new: { id: "e1", stage_key: "b" } });
  });

  it("filtros diferentes da mesma org dividem UM canal; o recorte é por assinante", async () => {
    planReturns("broadcast");
    const orgWide = vi.fn();
    const leadOnly = vi.fn();
    renderHook(
      () => {
        useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${ORG}`, onEvent: orgWide });
        useRealtimeChannel({ table: "pipeline_entries", filter: "lead_id=eq.L1", onEvent: leadOnly });
        useRealtimeChannel({ table: "pipeline_entries", onEvent: orgWide });
      },
      { wrapper: wrapper(ORG) },
    );
    await flush();
    expect(bcChannels()).toHaveLength(1);
    expect(realtimeChannelRegistrySnapshot()).toEqual([
      expect.objectContaining({ key: expect.stringContaining(`bc|${TOPIC}|pipeline_entries`), subscribers: 3 }),
    ]);
    const ch = bcChannels()[0];
    act(() => ch.onStatus!("SUBSCRIBED"));
    act(() => ch.onEvent!(envelope("INSERT", { id: "e1", organization_id: ORG, lead_id: "L2" })));
    expect(orgWide).toHaveBeenCalledTimes(2);
    expect(leadOnly).not.toHaveBeenCalled();
    act(() => ch.onEvent!(envelope("DELETE", null, { id: "e2", organization_id: ORG, lead_id: "L1" })));
    expect(leadOnly).toHaveBeenCalledTimes(1);
    expect(orgWide).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["plano pg_changes", () => planReturns("pg_changes")],
    ["rpc com erro", () => { rpcImpl.fn = () => Promise.resolve({ data: null, error: { message: "boom" } }); }],
    ["rpc rejeita", () => { rpcImpl.fn = () => Promise.reject(new Error("net")); }],
    ["cliente sem rpc (lança)", () => { rpcImpl.fn = () => { throw new TypeError("rpc is not a function"); }; }],
  ])("%s → postgres_changes como antes", async (_label, arrange) => {
    arrange();
    renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${ORG}`, onEvent: vi.fn() }),
      { wrapper: wrapper(ORG) },
    );
    await flush();
    expect(bcChannels()).toHaveLength(0);
    expect(pgChannels()).toHaveLength(1);
    expect(pgChannels()[0].cfg).toEqual({ event: "*", schema: "public", table: "pipeline_entries", filter: `organization_id=eq.${ORG}` });
  });

  it("plano que não volta em 3 s → postgres_changes; resposta tardia troca uma vez", async () => {
    vi.useFakeTimers();
    let resolve!: (v: unknown) => void;
    rpcImpl.fn = () => new Promise((r) => { resolve = r; });
    renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${ORG}`, onEvent: vi.fn() }),
      { wrapper: wrapper(ORG) },
    );
    expect(created).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_TIMEOUT_MS); });
    expect(pgChannels()).toHaveLength(1);
    await act(async () => { resolve({ data: { pipeline_entries: "broadcast" }, error: null }); });
    expect(removed).toContain(pgChannels()[0]);
    expect(bcChannels()).toHaveLength(1);
  });

  it("tabela sem broadcast, sem org, filtro de outra org ou coluna fora da allowlist: nem consulta o plano", async () => {
    planReturns("broadcast");
    renderHook(
      () => {
        useRealtimeChannel({ table: "leads", filter: `organization_id=eq.${ORG}`, onEvent: vi.fn() });
        useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${OTHER}`, onEvent: vi.fn() });
        useRealtimeChannel({ table: "pipeline_entries", filter: "metadata=eq.x", onEvent: vi.fn() });
      },
      { wrapper: wrapper(ORG) },
    );
    await flush();
    expect(bcChannels()).toHaveLength(0);
    expect(pgChannels()).toHaveLength(3);

    created.length = 0;
    __resetRealtimeTransportPlan();
    vi.mocked(supabase.rpc).mockClear();
    renderHook(() => useRealtimeChannel({ table: "pipeline_entries", onEvent: vi.fn() }), { wrapper: wrapper(null) });
    await flush();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(pgChannels()).toHaveLength(1);
  });

  it("kill switch: plano relido a cada 5 min volta ao postgres_changes", async () => {
    vi.useFakeTimers();
    planReturns("broadcast");
    renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", filter: `organization_id=eq.${ORG}`, onEvent: vi.fn() }),
      { wrapper: wrapper(ORG) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bcChannels()).toHaveLength(1);
    planReturns("pg_changes");
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAN_TTL_MS); });
    expect(removed).toContain(bcChannels()[0]);
    expect(pgChannels()).toHaveLength(1);
  });
});

describe("ciclo do canal privado", () => {
  it("re-entrar no mesmo tópico espera o leave do canal anterior (supabase-js devolveria o que está saindo)", async () => {
    planReturns("broadcast");
    let finishLeave!: () => void;
    let n = 0;
    removeImpl.fn = () => (n++ === 0 ? new Promise((r) => { finishLeave = () => r("ok"); }) : Promise.resolve("ok"));
    const { unmount } = renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", onEvent: vi.fn() }),
      { wrapper: wrapper(ORG) },
    );
    await flush();
    expect(bcChannels()).toHaveLength(1);
    unmount();
    expect(removed).toHaveLength(1);

    renderHook(() => useRealtimeChannel({ table: "pipeline_entries", onEvent: vi.fn() }), { wrapper: wrapper(ORG) });
    await flush();
    expect(bcChannels()).toHaveLength(1); // ainda esperando
    await act(async () => { finishLeave(); });
    expect(bcChannels()).toHaveLength(2);
    expect(bcChannels()[1].name).toBe(TOPIC);
  });

  it("join recusado (CHANNEL_ERROR) → errored → backoff reabre no mesmo tópico", async () => {
    vi.useFakeTimers();
    planReturns("broadcast");
    const states: string[] = [];
    renderHook(
      () => useRealtimeChannel({
        table: "pipeline_entries",
        onEvent: vi.fn(),
        onStateChange: (c) => states.push(c.state),
      }),
      { wrapper: wrapper(ORG) },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => bcChannels()[0].onStatus!("CHANNEL_ERROR", new Error("Unauthorized")));
    expect(states).toContain("errored");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(bcChannels()).toHaveLength(2);
    expect(removed).toContain(bcChannels()[0]);
  });

  it("evento de geração velha não chega", async () => {
    planReturns("broadcast");
    const onEvent = vi.fn();
    const { unmount } = renderHook(
      () => useRealtimeChannel({ table: "pipeline_entries", onEvent }),
      { wrapper: wrapper(ORG) },
    );
    await flush();
    const ch = bcChannels()[0];
    unmount();
    ch.onEvent!(envelope("INSERT", { id: "e1", organization_id: ORG }));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
