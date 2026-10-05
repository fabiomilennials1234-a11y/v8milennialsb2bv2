// @vitest-environment node
/**
 * calculate-portfolio-health — orquestração em lote (incidente 2026-10-05).
 *
 * Dirige o handler de verdade com o supabase dublado e conta as requisições:
 * o orçamento é 2 de gating + 2 por página (inputs/apply) + as raras de alerta
 * novo. E prova que os efeitos externos (WhatsApp ao vendedor, recompra_atrasada)
 * seguem a regra de antes, mas só para o que o apply devolveu como INSERIDO.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";

const { getHandler, state, sendText, resolveInst, fireTriggerMock, logRuntimeMock } = vi.hoisted(() => {
  const envStore: Record<string, string> = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CRON_SECRET: "cron-secret-de-teste",
  };
  let handler: unknown = null;
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: {
      get: (key: string) => envStore[key] ?? undefined,
      set: (key: string, value: string) => { envStore[key] = value; },
      delete: (key: string) => { delete envStore[key]; },
      toObject: () => ({ ...envStore }),
    },
    serve: (fn: unknown) => { handler = fn; },
  };
  return {
    getHandler: () => handler as (req: Request) => Promise<Response>,
    state: { client: null as unknown },
    sendText: vi.fn(),
    resolveInst: vi.fn(),
    fireTriggerMock: vi.fn(),
    logRuntimeMock: vi.fn(),
  };
});

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => {
    if (!state.client) throw new Error("teste não configurou o cliente supabase");
    return state.client;
  },
}));
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: unknown) => handler,
}));
vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: logRuntimeMock,
}));
vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveInstance: resolveInst,
  sendTextViaInstance: sendText,
}));
vi.mock("../../supabase/functions/_shared/workflow-trigger.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fireTrigger: fireTriggerMock,
}));

import "../../supabase/functions/calculate-portfolio-health/index.ts";

// ─── Cenário ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const PAGE = 500;
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

type Org = {
  id: string;
  clients: Client[];
  org?: Record<string, unknown>;
};

type Client = {
  id: string; lead_id: string; closer_id: string | null; name: string;
  last_order_at: string | null; orders: unknown[]; ctx_engagement: number | null;
  last_incoming_at: string | null;
};

function plainClient(n: number): Client {
  return {
    id: uuid(n),
    lead_id: uuid(100000 + n),
    closer_id: null,
    name: `Cliente ${n}`,
    last_order_at: null,
    orders: [],
    ctx_engagement: null,
    last_incoming_at: null,
  };
}

/** Atrasado 70 dias (crítico) e sem responder há 20 (engagement_cold, crítico). */
function overdueClient(n: number, closer: string | null) {
  const now = Date.now();
  return {
    ...plainClient(n),
    closer_id: closer,
    last_order_at: new Date(now - 100 * DAY).toISOString(),
    last_incoming_at: new Date(now - 20 * DAY).toISOString(),
  };
}

const DEFAULT_ORG = {
  default_reorder_cycle_days: null,
  approved_sum: 0,
  approved_count: 0,
  whatsapp_alerts_enabled: false,
  retention_config: null,
};

type Signal = { alert_type: string; severity: string; metadata: Record<string, unknown> };
type ApplyRow = { client_id: string; signals: Signal[] } & Record<string, unknown>;
type InsertedAlert = {
  id: string; client_id: string; signal_index: number;
  alert_type: string; severity: string; metadata: Record<string, unknown>;
};
type RpcParams = {
  p_org_id: string; p_after: string | null; p_limit: number;
  p_now: string; p_results: ApplyRow[]; p_key: string;
};

interface RunOpts {
  orgs: Org[];
  /** alertas que o apply devolve como inseridos, por org */
  inserted?: (orgId: string, payload: ApplyRow[]) => InsertedAlert[];
  applyError?: (orgId: string, call: number) => boolean;
  inputsError?: (orgId: string) => boolean;
}

async function run(opts: RunOpts) {
  const mock = createMockSupabase();
  mock.mockTable("organization_features", opts.orgs.map((o) => ({
    organization_id: o.id, feature_key: "customer_portfolio", enabled: true,
  })));
  mock.mockTable("feature_flags", [{ key: "customer_portfolio", default_enabled: false }]);
  mock.mockTable("team_members", [{ id: "closer-1", phone: "11999990000", name: "Vend" }]);
  mock.mockTable("client_alerts", []);
  mock.mockTable("outbound_dispatch_log", []);

  const requests: string[] = [];
  const rpcLog: { name: string; params: RpcParams }[] = [];
  const updates: { table: string; values: unknown; filters: unknown[] }[] = [];
  const rateKeys = new Set<string>();
  const applyCalls = new Map<string, number>();

  const realFrom = mock.sb.from;
  const sb = {
    ...mock.sb,
    from: (table: string) => {
      requests.push(`from:${table}`);
      const chain = realFrom(table);
      const realUpdate = chain.update;
      chain.update = (values: unknown) => {
        const entry = { table, values, filters: [] as unknown[] };
        updates.push(entry);
        const c = realUpdate(values);
        const realEq = c.eq;
        c.eq = (f: string, v: unknown) => { entry.filters.push([f, v]); return realEq(f, v); };
        return c;
      };
      return chain;
    },
    rpc: async (name: string, params: RpcParams) => {
      requests.push(`rpc:${name}`);
      rpcLog.push({ name, params });
      if (name === "portfolio_health_inputs") {
        const org = opts.orgs.find((o) => o.id === params.p_org_id)!;
        if (opts.inputsError?.(org.id)) return { data: null, error: { message: "boom" } };
        const sorted = [...org.clients].sort((a, b) => (a.id < b.id ? -1 : 1));
        const after = params.p_after;
        const rest = after ? sorted.filter((c) => c.id > after) : sorted;
        return {
          data: {
            org: params.p_after ? null : { ...DEFAULT_ORG, ...(org.org ?? {}) },
            clients: rest.slice(0, params.p_limit),
          },
          error: null,
        };
      }
      if (name === "portfolio_health_apply") {
        const n = (applyCalls.get(params.p_org_id) ?? 0) + 1;
        applyCalls.set(params.p_org_id, n);
        if (opts.applyError?.(params.p_org_id, n)) return { data: null, error: { message: "apply boom" } };
        return {
          data: {
            updated: params.p_results.length,
            snapshots: params.p_results.length,
            resolved: 0,
            inserted: opts.inserted?.(params.p_org_id, params.p_results) ?? [],
          },
          error: null,
        };
      }
      if (name === "check_rate_limit") {
        const allowed = !rateKeys.has(params.p_key);
        rateKeys.add(params.p_key);
        return { data: { allowed }, error: null };
      }
      return { data: null, error: { message: `rpc ${name} não dublada` } };
    },
  };
  state.client = sb;

  const res = await getHandler()(
    new Request("http://localhost/calculate-portfolio-health", {
      method: "POST",
      headers: { "x-cron-secret": "cron-secret-de-teste" },
    }),
  );
  return { res, body: await res.json(), requests, rpcLog, updates };
}

beforeEach(() => {
  sendText.mockReset().mockResolvedValue({ success: true });
  resolveInst.mockReset().mockResolvedValue({ id: "inst-1", provider: "uazapi" });
  fireTriggerMock.mockReset().mockResolvedValue(1);
  logRuntimeMock.mockReset().mockResolvedValue(undefined);
});

describe("calculate-portfolio-health — orçamento de requisições", () => {
  it("2 de gating + 2 por página; org vazia custa 1", async () => {
    const big: Org = {
      id: uuid(1),
      clients: Array.from({ length: 1200 }, (_, i) => plainClient(10_000 + i)),
    };
    const empty: Org = { id: uuid(2), clients: [] };
    const { body, requests, rpcLog } = await run({ orgs: [big, empty] });

    expect(body).toMatchObject({ success: true, orgs: 2, totalProcessed: 1200, totalFailed: 0 });
    // 3 páginas (500/500/200) + 1 da org vazia
    expect(requests).toEqual([
      "from:organization_features",
      "from:feature_flags",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
      "rpc:portfolio_health_inputs",
    ]);
    const pages = 3 + 1;
    expect(requests.length).toBeLessThanOrEqual(2 + 2 * pages);

    const inputsCalls = rpcLog.filter((r) => r.name === "portfolio_health_inputs");
    expect(inputsCalls.map((c) => c.params.p_after)).toEqual([
      null, uuid(10_000 + 499), uuid(10_000 + 999), null,
    ]);
    expect(inputsCalls.every((c) => c.params.p_limit === PAGE)).toBe(true);

    const applies = rpcLog.filter((r) => r.name === "portfolio_health_apply");
    const ids = applies.flatMap((a) => a.params.p_results.map((r) => r.client_id));
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);
    expect(new Set(applies.map((a) => a.params.p_now)).size).toBe(1);
    expect(applies.every((a) => a.params.p_org_id === big.id)).toBe(true);
    // payload completo: as 12 colunas de saúde + signals, sem org do payload
    expect(Object.keys(applies[0].params.p_results[0]).sort()).toEqual([
      "avg_ticket", "churn_probability", "client_id", "days_since_last_order", "health_score",
      "health_status", "last_order_at", "lifetime_value", "next_order_expected", "order_count",
      "reorder_cycle_days", "segment", "signals", "trend",
    ]);
  });

  it("apply com erro: página conta como falha, sem efeito externo, segue pra próxima", async () => {
    const org: Org = {
      id: uuid(1),
      org: { whatsapp_alerts_enabled: true },
      clients: [
        ...Array.from({ length: PAGE }, (_, i) => overdueClient(10_000 + i, "closer-1")),
        plainClient(20_000),
      ],
    };
    const { body, rpcLog } = await run({
      orgs: [org],
      applyError: (_o, call) => call === 1,
      inserted: () => [],
    });
    expect(body).toMatchObject({ totalProcessed: 1, totalFailed: PAGE });
    expect(rpcLog.filter((r) => r.name === "portfolio_health_apply")).toHaveLength(2);
    expect(sendText).not.toHaveBeenCalled();
    expect(fireTriggerMock).not.toHaveBeenCalled();
  });

  it("inputs com erro: para a org sem gravar e o run sai como error, nunca success mudo", async () => {
    const ok: Org = { id: uuid(2), clients: [plainClient(2)] };
    const { body, rpcLog } = await run({
      orgs: [{ id: uuid(1), clients: [plainClient(1)] }, ok],
      inputsError: (orgId) => orgId === uuid(1),
    });
    expect(body).toMatchObject({ totalProcessed: 1, totalFailed: 0, orgsFailed: 1 });
    expect(body.summary[uuid(1)]).toEqual({ processed: 0, failed: 0, inputsFailed: true });
    // a org quebrada não grava; a seguinte segue
    expect(rpcLog.map((r) => [r.name, r.params.p_org_id])).toEqual([
      ["portfolio_health_inputs", uuid(1)],
      ["portfolio_health_inputs", uuid(2)],
      ["portfolio_health_apply", uuid(2)],
    ]);
    expect(logRuntimeMock).toHaveBeenCalledTimes(1);
    expect(logRuntimeMock.mock.calls[0][0]).toMatchObject({
      status: "error",
      payloadSnapshot: { orgsFailed: 1, totalFailed: 0 },
      errorMessage: "1 org(s) failed reading inputs",
    });
  });

  it("run limpo loga success com orgsFailed 0", async () => {
    await run({ orgs: [{ id: uuid(1), clients: [plainClient(1)] }] });
    expect(logRuntimeMock.mock.calls[0][0]).toMatchObject({
      status: "success",
      payloadSnapshot: { orgsFailed: 0, totalFailed: 0 },
      errorMessage: undefined,
    });
  });
});

describe("calculate-portfolio-health — efeitos só para alerta INSERIDO", () => {
  const C1 = overdueClient(1, "closer-1"); // crítico, com vendedor
  const C2 = overdueClient(2, null); // crítico, sem vendedor
  const C3 = overdueClient(3, "closer-1"); // alertas já abertos → nada inserido

  /** Devolve os inseridos FORA de ordem — a edge function reordena. */
  const insertedFor = (payload: ApplyRow[]) => {
    const out: InsertedAlert[] = [];
    for (const row of payload) {
      if (row.client_id === C3.id) continue;
      row.signals.forEach((s, i) => out.push({
        id: `alert-${row.client_id.slice(-2)}-${i}`,
        client_id: row.client_id,
        signal_index: i,
        alert_type: s.alert_type,
        severity: s.severity,
        metadata: s.metadata,
      }));
    }
    return out.reverse();
  };

  it("WhatsApp ligado: 1 envio por cliente (rate limit), só crítico com vendedor; notified_at pelo id", async () => {
    const { rpcLog, updates, requests } = await run({
      orgs: [{ id: uuid(9), org: { whatsapp_alerts_enabled: true }, clients: [C1, C2, C3] }],
      inserted: (_o, payload) => insertedFor(payload),
    });

    const payloadC1 = rpcLog.find((r) => r.name === "portfolio_health_apply")!
      .params.p_results.find((r) => r.client_id === C1.id)!;
    expect(payloadC1.signals.map((s) => [s.alert_type, s.severity])).toEqual([
      ["reorder_overdue", "critical"],
      ["engagement_cold", "critical"],
    ]);

    // rate limit consultado nos 2 críticos de C1 (o 2º é barrado); C2 sem vendedor nem consulta
    const rate = rpcLog.filter((r) => r.name === "check_rate_limit");
    expect(rate.map((r) => r.params)).toEqual([
      { p_key: `portfolio_alert:${C1.id}`, p_max_requests: 1, p_window_seconds: 86400 },
      { p_key: `portfolio_alert:${C1.id}`, p_max_requests: 1, p_window_seconds: 86400 },
    ]);
    expect(sendText).toHaveBeenCalledTimes(1);
    const [, , phone, msg, track] = sendText.mock.calls[0];
    expect(phone).toBe("11999990000");
    expect(msg).toContain("Cliente *Cliente 1*");
    expect(msg).toContain("Recompra 70 dias atrasada"); // o 1º crítico, na ordem de detectSignals
    expect(track).toEqual({ trackSource: "portfolio_alert", trackId: C1.id });

    // notified_at no id devolvido pelo apply, sem reler client_alerts
    const notified = updates.filter((u) => u.table === "client_alerts");
    expect(notified).toHaveLength(1);
    expect(notified[0].filters).toEqual([["id", `alert-${C1.id.slice(-2)}-0`]]);
    expect(Object.keys(notified[0].values as object)).toEqual(["notified_at"]);
    expect(requests.filter((r) => r === "from:client_alerts")).toHaveLength(1);

    // recompra_atrasada para cada reorder_overdue INSERIDO (C1, C2), nunca C3
    expect(fireTriggerMock).toHaveBeenCalledTimes(2);
    const ctxs = fireTriggerMock.mock.calls.map(([p]) => p);
    expect(ctxs.map((p) => p.leadId)).toEqual([C1.lead_id, C2.lead_id]);
    expect(ctxs[0]).toMatchObject({
      organizationId: uuid(9),
      triggerType: "recompra_atrasada",
      context: { client_id: C1.id, days_overdue: 70, cycle_days: 30 },
    });
  });

  it("WhatsApp desligado: nenhuma consulta de rate limit nem envio; trigger segue", async () => {
    const { rpcLog } = await run({
      orgs: [{ id: uuid(9), clients: [C1, C2] }],
      inserted: (_o, payload) => insertedFor(payload),
    });
    expect(rpcLog.some((r) => r.name === "check_rate_limit")).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(fireTriggerMock).toHaveBeenCalledTimes(2);
  });

  it("nada inserido: nenhum efeito, nem para cliente crítico com vendedor", async () => {
    const { requests } = await run({
      orgs: [{ id: uuid(9), org: { whatsapp_alerts_enabled: true }, clients: [C1, C3] }],
      inserted: () => [],
    });
    expect(sendText).not.toHaveBeenCalled();
    expect(fireTriggerMock).not.toHaveBeenCalled();
    expect(requests.filter((r) => r.startsWith("from:")).length).toBe(2);
  });

  it("agente de retenção com auto_approach=false barra o recompra_atrasada", async () => {
    await run({
      orgs: [{ id: uuid(9), org: { retention_config: { auto_approach: false } }, clients: [C1] }],
      inserted: (_o, payload) => insertedFor(payload),
    });
    expect(fireTriggerMock).not.toHaveBeenCalled();
  });

  it("envio falho não grava notified_at", async () => {
    sendText.mockResolvedValue({ success: false, error: "x" });
    const { updates } = await run({
      orgs: [{ id: uuid(9), org: { whatsapp_alerts_enabled: true }, clients: [C1] }],
      inserted: (_o, payload) => insertedFor(payload),
    });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(updates.filter((u) => u.table === "client_alerts")).toHaveLength(0);
  });
});
