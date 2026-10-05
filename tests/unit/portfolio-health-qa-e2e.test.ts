// @vitest-environment node
/**
 * calculate-portfolio-health — QA ponta a ponta: o HANDLER REAL da edge function
 * contra um Postgres de verdade (PGlite) com a migration nova aplicada.
 *
 * `rpc()` executa a função SQL como service_role; `from()` traduz o select/update
 * encadeado em SQL. Só o mundo externo é dublê (envio WhatsApp, resolveInstance,
 * fireTrigger, check_rate_limit, logRuntime).
 *
 * Oráculo do caminho antigo: os selects por cliente de 566880b3e:index.ts +
 * computeClientHealth (provado ≡ corpo antigo em portfolio-health-compute.test.ts)
 * + a escrita antiga (UPDATE incondicional, upsert de snapshot, syncAlerts) num
 * segundo banco com a MESMA semente.
 *
 * Volume: org A 700 clientes (2 páginas), org B 50, org C fora do opt-in.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { computeClientHealth } from "../../supabase/functions/_shared/portfolio-health.ts";


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
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: logRuntimeMock }));
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

// ─── Banco ───────────────────────────────────────────────────────────────────

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const BASELINE = read("tests/integration/fixtures/portfolio-health-baseline.sql");
const MIGRATION = read("supabase/migrations/20271107120000_portfolio_health_set_based.sql");
const EXTRA = `
  CREATE TABLE public.feature_flags (key text PRIMARY KEY, default_enabled boolean);
  CREATE TABLE public.team_members (id uuid PRIMARY KEY, phone text, name text);
  CREATE TABLE public.outbound_dispatch_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, dispatched_at timestamptz);
`;

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T15:00:00.000Z");
const uuid = (p: number, n: number) => `${String(p).padStart(8, "0")}-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG_A = uuid(1, 1), ORG_B = uuid(1, 2), ORG_C = uuid(1, 3);
const CLOSER_PHONE = uuid(2, 1), CLOSER_NOPHONE = uuid(2, 2);
const PRODUCTS = ["Café", "Filtro", "Moedor", "Xícara", "Açúcar"];
const ALERT_TYPES = ["reorder_overdue", "ticket_declining", "product_missing", "cycle_stretching", "engagement_cold", "nps_low"];

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Seeded = { clients: { id: string; org: string; lead: string; closer: string | null }[]; dupStale: Set<string> };

/** Gera a carteira. Mesma semente → mesmo banco, nos dois lados do oráculo. */
async function seed(db: PGlite): Promise<Seeded> {
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const iso = (ms: number) => new Date(ms).toISOString();
  const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);
  const clients: Seeded["clients"] = [];
  const dupStale = new Set<string>();
  const cRows: string[] = [], oRows: string[] = [], mRows: string[] = [], ctxRows: string[] = [], aRows: string[] = [], dRows: string[] = [];
  let orderN = 0, alertN = 0, leadN = 0;

  const make = (org: string, n: number, base: number) => {
    for (let i = 0; i < n; i++) {
      const id = uuid(base, i + 1);
      const lead = uuid(9, ++leadN); // único entre orgs: o select antigo não filtrava org
      const closer = r() < 0.6 ? CLOSER_PHONE : r() < 0.5 ? CLOSER_NOPHONE : null;
      const nOrders = Math.floor(r() * 13);
      const imported = nOrders === 0 && r() < 0.5 ? iso(NOW.getTime() - Math.floor(r() * 300) * DAY) : null;
      const active = r() < 0.97;
      clients.push({ id, org, lead, closer });
      cRows.push(`(${q(id)}, ${q(org)}, ${q(lead)}, ${q(`Cliente ${base}-${i}`)}, ${q(closer)}, ${q(imported)}, ${active})`);
      // sold_at únicos (sem empate: o select antigo ordenava só por sold_at)
      let t = NOW.getTime() - (60 + Math.floor(r() * 400)) * DAY;
      const step = 10 + Math.floor(r() * 50);
      for (let k = 0; k < nOrders; k++) {
        t += (step + Math.floor(r() * 20) - 10) * DAY + (++orderN) * 1000;
        if (t > NOW.getTime()) break;
        const status = r() < 0.9 ? "approved" : pick(["pending", "rejected"]);
        oRows.push(`(${q(uuid(5, orderN))}, ${q(org)}, ${q(id)}, ${q(pick(PRODUCTS))}, ${(50 + Math.floor(r() * 50000) / 100).toFixed(2)}, ${q(iso(t))}, ${q(status)})`);
      }
      if (r() < 0.5) ctxRows.push(`(${q(lead)}, ${q(org)}, ${Math.floor(r() * 100)})`);
      const nMsg = Math.floor(r() * 5);
      for (let k = 0; k < nMsg; k++) {
        mRows.push(`(${q(org)}, ${q(lead)}, ${q(r() < 0.6 ? "incoming" : "outgoing")}, ${q(iso(NOW.getTime() - Math.floor(r() * 60 * DAY)))})`);
      }
      if (r() < 0.25) {
        const type = pick(ALERT_TYPES);
        const copies = r() < 0.3 ? 2 : 1;
        if (copies === 2) dupStale.add(`${id}:${type}`);
        for (let k = 0; k < copies; k++) {
          aRows.push(`(${q(uuid(7, ++alertN))}, ${q(org)}, ${q(id)}, ${q(type)}, 'warning', 'pré')`);
        }
      }
      if (org === ORG_B && r() < 0.5) dRows.push(`(${q(lead)}, ${q(iso(NOW.getTime() - Math.floor(r() * 14) * DAY))})`);
    }
  };
  make(ORG_A, 700, 3);
  make(ORG_B, 50, 4);
  make(ORG_C, 30, 6);

  await db.exec(`
    INSERT INTO organizations (id, name, slug, default_reorder_cycle_days) VALUES
      ('${ORG_A}', 'A', 'a', NULL), ('${ORG_B}', 'B', 'b', 20), ('${ORG_C}', 'C', 'c', NULL);
    INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES
      ('${ORG_A}', 'customer_portfolio', true), ('${ORG_B}', 'customer_portfolio', true),
      ('${ORG_C}', 'customer_portfolio', false),
      ('${ORG_A}', 'portfolio_alerts_whatsapp', true), ('${ORG_C}', 'portfolio_alerts_whatsapp', true);
    INSERT INTO feature_flags VALUES ('customer_portfolio', false);
    INSERT INTO team_members VALUES ('${CLOSER_PHONE}', '5511999990000', 'Vend'), ('${CLOSER_NOPHONE}', NULL, 'Sem fone');
    INSERT INTO copilot_agents (organization_id, name, is_active, retention_enabled, retention_config) VALUES
      ('${ORG_B}', 'retenção B', true, true, '{"max_frequency_days": 7}');
    INSERT INTO upsell_clients (id, organization_id, lead_id, name, closer_id, last_order_at, is_active) VALUES ${cRows.join(",")};
    INSERT INTO upsell_orders (id, organization_id, client_id, product_name, sale_value, sold_at, approval_status) VALUES ${oRows.join(",")};
    INSERT INTO conversation_context_summary (lead_id, organization_id, engagement_score) VALUES ${ctxRows.join(",")};
    INSERT INTO whatsapp_messages (organization_id, lead_id, direction, "timestamp") VALUES ${mRows.join(",")};
    INSERT INTO client_alerts (id, organization_id, client_id, alert_type, severity, title) VALUES ${aRows.join(",")};
    INSERT INTO outbound_dispatch_log (lead_id, dispatched_at) VALUES ${dRows.join(",")};
  `);
  return { clients, dupStale };
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(EXTRA);
  const seeded = await seed(db);
  await db.exec(MIGRATION);
  return { db, seeded };
}

// ─── Supabase dublado sobre o PGlite ─────────────────────────────────────────

type Inserted = { id: string; client_id: string; signal_index: number; alert_type: string; severity: string };
type Applied = { updated: number; snapshots: number; resolved: number; inserted: Inserted[] };

interface Probe {
  requests: string[];
  applies: { org: string; size: number; ms: number; result: Applied | null; error?: string }[];
  inputs: { org: string; after: string | null; ms: number; n: number }[];
  rateKeys: string[];
}

function bindSupabase(db: PGlite, opts: { failInputsFor?: string; rateUsed?: Set<string> } = {}): Probe {
  const probe: Probe = { requests: [], applies: [], inputs: [], rateKeys: [] };
  const rateUsed = opts.rateUsed ?? new Set<string>();

  const asService = async (sql: string, params: unknown[]) => {
    await db.exec("SET ROLE service_role");
    try { return await db.query<{ r: unknown }>(sql, params); } finally { await db.exec("RESET ROLE"); }
  };

  const from = (table: string) => {
    probe.requests.push(`from:${table}`);
    const st = { op: "select", cols: "*", filters: [] as [string, unknown][], order: null as null | [string, boolean], limit: null as null | number, values: null as null | Record<string, unknown> };
    const exec = async () => {
      const params: unknown[] = [];
      const where = () => (st.filters.length
        ? " WHERE " + st.filters.map(([f, v]) => { params.push(v); return `"${f}" = $${params.length}`; }).join(" AND ")
        : "");
      try {
        if (st.op === "update") {
          const sets = Object.entries(st.values!).map(([k, v]) => { params.push(v); return `"${k}" = $${params.length}`; });
          await db.query(`UPDATE public.${table} SET ${sets.join(", ")}${where()}`, params);
          return { data: null, error: null };
        }
        const cols = st.cols.split(",").map((c) => `"${c.trim()}"`).join(", ");
        const ord = st.order ? ` ORDER BY "${st.order[0]}" ${st.order[1] ? "ASC" : "DESC"}` : "";
        const lim = st.limit ? ` LIMIT ${st.limit}` : "";
        const res = await db.query(`SELECT ${cols} FROM public.${table}${where()}${ord}${lim}`, params);
        return { data: res.rows, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    };
    const b = {
      select(c?: string) { if (st.op !== "update") st.cols = c ?? "*"; return b; },
      eq(f: string, v: unknown) { st.filters.push([f, v]); return b; },
      order(f: string, o?: { ascending?: boolean }) { st.order = [f, o?.ascending !== false]; return b; },
      limit(n: number) { st.limit = n; return b; },
      update(v: Record<string, unknown>) { st.op = "update"; st.values = v; return b; },
      maybeSingle: () => exec().then((r) => ({ data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  };

  const rpc = async (name: string, p: Record<string, unknown>) => {
    probe.requests.push(`rpc:${name}`);
    if (name === "portfolio_health_inputs") {
      if (opts.failInputsFor === p.p_org_id) return { data: null, error: { message: "canceling statement due to statement timeout" } };
      const t0 = performance.now();
      try {
        const res = await asService("SELECT portfolio_health_inputs($1, $2, $3) AS r", [p.p_org_id, p.p_after, p.p_limit]);
        const data = res.rows[0].r as { clients: unknown[] };
        probe.inputs.push({ org: p.p_org_id as string, after: p.p_after as string | null, ms: performance.now() - t0, n: data.clients.length });
        return { data, error: null };
      } catch (e) { return { data: null, error: { message: String(e) } }; }
    }
    if (name === "portfolio_health_apply") {
      const t0 = performance.now();
      const size = (p.p_results as unknown[]).length;
      try {
        const res = await asService("SELECT portfolio_health_apply($1, $2, $3) AS r", [p.p_org_id, p.p_now, JSON.stringify(p.p_results)]);
        const result = res.rows[0].r as Applied;
        probe.applies.push({ org: p.p_org_id as string, size, ms: performance.now() - t0, result });
        return { data: result, error: null };
      } catch (e) {
        probe.applies.push({ org: p.p_org_id as string, size, ms: performance.now() - t0, result: null, error: String(e) });
        return { data: null, error: { message: String(e) } };
      }
    }
    if (name === "check_rate_limit") {
      const key = p.p_key as string;
      probe.rateKeys.push(key);
      const allowed = !rateUsed.has(key);
      rateUsed.add(key);
      return { data: { allowed }, error: null };
    }
    return { data: null, error: { message: `rpc ${name} não dublada` } };
  };

  state.client = { from, rpc };
  return probe;
}

async function runHandler() {
  const res = await getHandler()(new Request("http://localhost/calculate-portfolio-health", {
    method: "POST", headers: { "x-cron-secret": "cron-secret-de-teste" },
  }));
  return res.json();
}

// ─── Oráculo: o caminho antigo, cliente a cliente ────────────────────────────

const UPDATE_COLS = ["health_score", "health_status", "segment", "reorder_cycle_days", "days_since_last_order", "last_order_at",
  "next_order_expected", "order_count", "lifetime_value", "avg_ticket", "trend", "churn_probability"] as const;

async function legacyRun(db: PGlite, orgIds: string[], now: Date) {
  for (const org of orgIds) {
    const cycle = (await db.query<{ d: number | null }>(`SELECT default_reorder_cycle_days d FROM organizations WHERE id=$1`, [org])).rows[0]?.d ?? undefined;
    const vals = (await db.query<{ v: number }>(`SELECT sale_value::float8 v FROM upsell_orders WHERE organization_id=$1 AND approval_status='approved'`, [org])).rows.map((x) => x.v);
    const orgAvg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const clients = (await db.query<{ id: string; organization_id: string; lead_id: string; last_order_at: Date | null }>(
      `SELECT id, organization_id, lead_id, last_order_at FROM upsell_clients WHERE organization_id=$1 AND is_active=true`, [org])).rows;
    for (const c of clients) {
      const orders = (await db.query<{ id: string; sale_value: number; sold_at: Date; product_name: string }>(
        `SELECT id, sale_value::float8 sale_value, sold_at, product_name FROM upsell_orders WHERE client_id=$1 AND approval_status='approved' ORDER BY sold_at ASC`, [c.id])).rows
        .map((o) => ({ ...o, sold_at: o.sold_at.toISOString() }));
      const ctx = (await db.query<{ e: number | null }>(`SELECT engagement_score e FROM conversation_context_summary WHERE lead_id=$1`, [c.lead_id])).rows[0];
      const last = (await db.query<{ t: Date }>(`SELECT "timestamp" t FROM whatsapp_messages WHERE lead_id=$1 AND direction='incoming' ORDER BY "timestamp" DESC LIMIT 1`, [c.lead_id])).rows[0];
      const r = computeClientHealth({
        leadId: c.lead_id,
        lastOrderAtStored: c.last_order_at ? c.last_order_at.toISOString() : null,
        orders,
        ctxEngagement: ctx?.e ?? null,
        lastIncomingAt: last ? last.t.toISOString() : null,
      }, { orgAvgTicket: orgAvg, defaultCycleDays: cycle }, now);

      const u = r.update as unknown as Record<string, unknown>;
      await db.query(`UPDATE upsell_clients SET ${UPDATE_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, health_updated_at = $14 WHERE id = $1`,
        [c.id, ...UPDATE_COLS.map((k) => u[k]), now.toISOString()]);
      await db.query(`INSERT INTO client_health_snapshots (client_id, organization_id, health_score, health_status, segment, snapshot_date)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (client_id, snapshot_date) DO UPDATE SET health_score=EXCLUDED.health_score,
        health_status=EXCLUDED.health_status, segment=EXCLUDED.segment`,
        [c.id, c.organization_id, u.health_score, u.health_status, u.segment, now.toISOString().slice(0, 10)]);

      // syncAlerts antigo: Map por tipo (o último id vence) → resolve 1 por tipo
      const open = (await db.query<{ id: string; alert_type: string }>(`SELECT id, alert_type FROM client_alerts WHERE client_id=$1 AND is_resolved=false`, [c.id])).rows;
      const byType = new Map(open.map((a) => [a.alert_type, a.id]));
      const active = new Set(r.signals.map((s) => s.type));
      const toResolve = [...byType].filter(([t]) => !active.has(t)).map(([, id]) => id);
      for (const id of toResolve) await db.query(`UPDATE client_alerts SET is_resolved=true, resolved_at=$2 WHERE id=$1`, [id, now.toISOString()]);
      for (const s of r.signals) {
        if (byType.has(s.type)) continue;
        await db.query(`INSERT INTO client_alerts (organization_id, client_id, alert_type, severity, title, description, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [c.organization_id, c.id, s.type, s.severity, s.title, s.description, JSON.stringify(s.metadata)]);
      }
    }
  }
}

// ─── Leituras de estado ──────────────────────────────────────────────────────

const clientState = async (db: PGlite) => (await db.query<Record<string, unknown>>(`SELECT id, health_score, health_status, segment, reorder_cycle_days,
  days_since_last_order, last_order_at, next_order_expected, order_count, lifetime_value::text lv, avg_ticket::text at, trend,
  churn_probability, health_updated_at FROM upsell_clients ORDER BY id`)).rows;
const snapState = async (db: PGlite) => (await db.query(`SELECT client_id, organization_id, health_score, health_status, segment,
  snapshot_date::text d FROM client_health_snapshots ORDER BY client_id, snapshot_date`)).rows;
const alertState = async (db: PGlite) => (await db.query<{ k: string }>(`SELECT concat_ws('|', organization_id, client_id, alert_type, severity, title,
  coalesce(description,'∅'), coalesce(metadata::text,'∅'), is_resolved, coalesce(resolved_at::text,'∅')) k FROM client_alerts`)).rows.map((r) => r.k).sort();
const updatedAtState = async (db: PGlite) => (await db.query(`SELECT id, updated_at FROM upsell_clients ORDER BY id`)).rows;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sendText.mockReset().mockResolvedValue({ success: true });
  resolveInst.mockReset().mockResolvedValue({ id: "inst-1", provider: "uazapi" });
  fireTriggerMock.mockReset().mockResolvedValue(1);
  logRuntimeMock.mockReset().mockResolvedValue(undefined);
});
afterAll(() => { vi.useRealTimers(); });

// ─── Cenários ────────────────────────────────────────────────────────────────

describe("QA ponta a ponta — handler real × PGlite × oráculo antigo", () => {
  it("golden path, idempotência, mudança pontual, alertas e efeitos externos", async () => {
    const { db, seeded } = await freshDb();
    const { db: legacy } = await freshDb();
    const rateUsed = new Set<string>();
    const orgOf = new Map(seeded.clients.map((c) => [c.id, c.org]));
    const orgCBefore = {
      clients: (await clientState(db)).filter((c) => orgOf.get(c.id as string) === ORG_C),
      alerts: (await alertState(db)).filter((k) => k.startsWith(ORG_C)),
    };

    // ── 1. Golden path ─────────────────────────────────────────────────────
    const p1 = bindSupabase(db, { rateUsed });
    const body1 = await runHandler();
    const active = (await db.query<{ n: number; org: string }>(`SELECT organization_id org, count(*)::int n FROM upsell_clients WHERE is_active GROUP BY 1`)).rows;
    const nA = active.find((r) => r.org === ORG_A)!.n, nB = active.find((r) => r.org === ORG_B)!.n;
    expect(body1).toMatchObject({ success: true, orgs: 2, totalProcessed: nA + nB, totalFailed: 0, orgsFailed: 0 });
    expect(logRuntimeMock.mock.calls[0][0]).toMatchObject({ status: "success" });

    const effectReq = ["rpc:check_rate_limit", "from:team_members", "from:client_alerts", "from:outbound_dispatch_log"];
    const core = p1.requests.filter((r) => !effectReq.includes(r));
    expect(core).toEqual([
      "from:organization_features", "from:feature_flags",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
    ]);
    expect(p1.applies.map((a) => [a.org, a.size])).toEqual([[ORG_A, 500], [ORG_A, nA - 500], [ORG_B, nB]]);

    await legacyRun(legacy, [ORG_A, ORG_B], NOW);
    expect(await clientState(db)).toEqual(await clientState(legacy));
    expect(await snapState(db)).toEqual(await snapState(legacy));

    const dupKeyOf = (k: string) => { const [, c, t] = k.split("|"); return `${c}:${t}`; };
    const newAlerts = await alertState(db), oldAlerts = await alertState(legacy);
    const isDup = (k: string) => seeded.dupStale.has(dupKeyOf(k));
    expect(newAlerts.filter((k) => !isDup(k))).toEqual(oldAlerts.filter((k) => !isDup(k)));
    let dupResolvedStale = 0, dupStillActive = 0, dupOutOfScope = 0;
    for (const key of seeded.dupStale) {
      const [c, t] = key.split(":");
      const sql = `SELECT count(*) FILTER (WHERE NOT is_resolved)::int open FROM client_alerts WHERE client_id=$1 AND alert_type=$2 AND title='pré'`;
      const open = (await db.query<{ open: number }>(sql, [c, t])).rows[0].open;
      const legacyOpen = (await legacy.query<{ open: number }>(sql, [c, t])).rows[0].open;
      const isActiveClient = (await db.query<{ a: boolean }>(`SELECT is_active a FROM upsell_clients WHERE id=$1`, [c])).rows[0].a;
      if (!isActiveClient || orgOf.get(c) === ORG_C) { dupOutOfScope++; expect(open).toBe(2); continue; }
      if (open === 0) { dupResolvedStale++; expect(legacyOpen).toBe(1); }
      else { dupStillActive++; expect(open).toBe(2); expect(legacyOpen).toBe(2); }
    }
    expect(dupResolvedStale).toBeGreaterThan(0);

    expect((await clientState(db)).filter((c) => orgOf.get(c.id as string) === ORG_C)).toEqual(orgCBefore.clients);
    expect((await alertState(db)).filter((k) => k.startsWith(ORG_C))).toEqual(orgCBefore.alerts);

    // ── 5. Efeitos externos do golden path ────────────────────────────────
    const inserted = p1.applies.flatMap((a) => a.result!.inserted.map((i) => ({ ...i, org: a.org })));
    const byId = new Map(seeded.clients.map((c) => [c.id, c]));
    const firstCritical = new Map<string, Inserted>();
    for (const i of inserted) {
      if (i.org !== ORG_A || i.severity !== "critical" || !byId.get(i.client_id)!.closer) continue;
      const cur = firstCritical.get(i.client_id);
      if (!cur || i.signal_index < cur.signal_index) firstCritical.set(i.client_id, i);
    }
    const withPhone = [...firstCritical].filter(([c]) => byId.get(c)!.closer === CLOSER_PHONE);
    expect(firstCritical.size).toBeGreaterThan(0);
    expect(new Set(p1.rateKeys)).toEqual(new Set([...firstCritical.keys()].map((c) => `portfolio_alert:${c}`)));
    expect(sendText.mock.calls.map((c) => c[4].trackId).sort()).toEqual(withPhone.map(([c]) => c).sort());
    expect(sendText.mock.calls.every((c) => c[2] === "5511999990000")).toBe(true);
    const notified = (await db.query<{ id: string }>(`SELECT id FROM client_alerts WHERE notified_at IS NOT NULL ORDER BY id`)).rows.map((r) => r.id);
    expect(notified).toEqual(withPhone.map(([, a]) => a.id).sort());
    const recentDispatch = new Set((await db.query<{ l: string }>(`SELECT DISTINCT lead_id l FROM outbound_dispatch_log
      WHERE dispatched_at > $1`, [new Date(NOW.getTime() - 7 * DAY).toISOString()])).rows.map((r) => r.l));
    const reorderIns = inserted.filter((i) => i.alert_type === "reorder_overdue");
    const expectedTriggers = reorderIns.map((i) => byId.get(i.client_id)!.lead).filter((lead) => !recentDispatch.has(lead));
    const suppressed = reorderIns.filter((i) => recentDispatch.has(byId.get(i.client_id)!.lead));
    expect(fireTriggerMock.mock.calls.map(([p]) => p.leadId).sort()).toEqual(expectedTriggers.sort());
    expect(fireTriggerMock.mock.calls.every(([p]) => p.triggerType === "recompra_atrasada")).toBe(true);
    expect(suppressed.length).toBeGreaterThan(0);
    const run1 = { sends: sendText.mock.calls.length, triggers: fireTriggerMock.mock.calls.length, critClients: firstCritical.size };

    // ── 2. Idempotência ────────────────────────────────────────────────────
    const before2 = { u: await updatedAtState(db), s: await snapState(db), a: await alertState(db) };
    sendText.mockClear(); fireTriggerMock.mockClear();
    const p2 = bindSupabase(db, { rateUsed });
    await runHandler();
    expect(p2.applies.map((a) => a.result)).toEqual(p2.applies.map(() => ({ updated: 0, snapshots: 0, resolved: 0, inserted: [] })));
    expect(await updatedAtState(db)).toEqual(before2.u);
    expect(await snapState(db)).toEqual(before2.s);
    expect(await alertState(db)).toEqual(before2.a);
    expect(sendText).not.toHaveBeenCalled();
    expect(fireTriggerMock).not.toHaveBeenCalled();
    expect(p2.rateKeys).toEqual([]);

    // ── 3+4a. Muda 1 pedido de 1 cliente com reorder_overdue aberto ────────
    const x = (await db.query<{ c: string; o: string }>(`SELECT a.client_id c, (SELECT id FROM upsell_orders o WHERE o.client_id=a.client_id
      AND approval_status='approved' ORDER BY sold_at DESC LIMIT 1) o FROM client_alerts a JOIN upsell_clients uc ON uc.id=a.client_id
      WHERE a.organization_id=$1 AND a.alert_type='reorder_overdue' AND NOT a.is_resolved AND uc.is_active AND uc.order_count >= 3
      ORDER BY a.client_id LIMIT 1`, [ORG_A])).rows[0];
    expect(x?.o).toBeTruthy();
    await db.query(`UPDATE upsell_orders SET sold_at=$2 WHERE id=$1`, [x.o, new Date(NOW.getTime() - DAY).toISOString()]);
    const NOW3 = new Date(NOW.getTime() + 1000);
    vi.setSystemTime(NOW3);
    const hBefore = (await db.query<{ id: string; h: Date | null }>(`SELECT id, health_updated_at h FROM upsell_clients ORDER BY id`)).rows;
    const p3 = bindSupabase(db, { rateUsed });
    await runHandler();
    const upd3 = p3.applies.reduce((s, a) => s + a.result!.updated, 0);
    const res3 = p3.applies.reduce((s, a) => s + a.result!.resolved, 0);
    const ins3 = p3.applies.flatMap((a) => a.result!.inserted);
    expect(upd3).toBe(1);
    const hAfter = (await db.query<{ id: string; h: Date | null }>(`SELECT id, health_updated_at h FROM upsell_clients ORDER BY id`)).rows;
    const changedH = hAfter.filter((r, i) => r.h?.getTime() !== hBefore[i].h?.getTime()).map((r) => r.id);
    expect(changedH).toEqual([x.c]);
    expect(hAfter.find((r) => r.id === x.c)!.h!.toISOString()).toBe(NOW3.toISOString());
    const resolved3 = (await db.query<{ c: string; t: string }>(`SELECT client_id c, alert_type t FROM client_alerts WHERE resolved_at=$1`, [NOW3.toISOString()])).rows;
    expect(resolved3.length).toBe(res3);
    expect(resolved3.every((r) => r.c === x.c)).toBe(true);
    expect(resolved3.map((r) => r.t)).toContain("reorder_overdue");
    expect(ins3.every((i) => i.client_id === x.c)).toBe(true);

    // ── 4b. Sinal novo insere: cliente sem alerta fica muito atrasado ───────
    const y = (await db.query<{ c: string; lead: string }>(`SELECT uc.id c, uc.lead_id lead FROM upsell_clients uc WHERE uc.organization_id=$1 AND uc.is_active
      AND uc.closer_id=$2 AND uc.order_count >= 3 AND NOT EXISTS (SELECT 1 FROM client_alerts a WHERE a.client_id=uc.id)
      ORDER BY uc.id LIMIT 1`, [ORG_A, CLOSER_PHONE])).rows[0];
    expect(y).toBeTruthy();
    await db.query(`UPDATE upsell_orders SET sold_at = sold_at - interval '400 days' WHERE client_id=$1`, [y.c]);
    vi.setSystemTime(new Date(NOW.getTime() + 2000));
    sendText.mockClear(); fireTriggerMock.mockClear();
    const p4 = bindSupabase(db, { rateUsed });
    await runHandler();
    const ins4 = p4.applies.flatMap((a) => a.result!.inserted);
    expect(p4.applies.reduce((s, a) => s + a.result!.updated, 0)).toBe(1);
    expect(ins4.length).toBeGreaterThan(0);
    expect(ins4.every((i) => i.client_id === y.c)).toBe(true);
    expect(ins4.map((i) => i.alert_type)).toContain("reorder_overdue");
    expect(fireTriggerMock.mock.calls.map(([p]) => p.leadId)).toEqual([y.lead]);
    expect(sendText.mock.calls.map((c) => c[4].trackId)).toEqual(ins4.some((i) => i.severity === "critical") ? [y.c] : []);
    const notifiedY = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM client_alerts WHERE client_id=$1 AND notified_at IS NOT NULL`, [y.c])).rows[0].n;
    expect(notifiedY).toBe(sendText.mock.calls.length);

    console.log("[QA] apply ms:", p1.applies.map((a) => `${a.org.slice(-1)}:${a.size}→${a.ms.toFixed(1)}`).join(" | "),
      "· inputs ms:", p1.inputs.map((i) => `${i.org.slice(-1)}:${i.n}→${i.ms.toFixed(1)}`).join(" | "),
      "\n[QA] run1: clientes", nA + nB, "· alertas inseridos", inserted.length, "· críticos c/ closer", run1.critClients,
      "· WhatsApp", run1.sends, "· triggers", run1.triggers, "· suprimidos (gate 7d) B", suppressed.length,
      "\n[QA] dupStale: resolvidas", dupResolvedStale, "· tipo ainda ativo", dupStillActive, "· fora de escopo", dupOutOfScope,
      "\n[QA] run3: cliente", x.c, "updated", upd3, "resolved", res3, "inserted", ins3.length,
      "\n[QA] run4: cliente", y.c, "inserted", ins4.map((i) => `${i.alert_type}/${i.severity}`).join(","), "· WhatsApp", sendText.mock.calls.length);
    await db.close(); await legacy.close();
  }, 300_000);

  it("falha real do apply (rollback da página) e falha do inputs: nada gravado nem enviado, resto segue, run = error", async () => {
    const { db, seeded } = await freshDb();
    const firstPage = (await db.query<{ id: string }>(`SELECT id FROM upsell_clients WHERE organization_id=$1 AND is_active ORDER BY id LIMIT 500`, [ORG_A])).rows.map((r) => r.id);
    const poison = firstPage[10];
    // explode no snapshot (etapa c) — DEPOIS do UPDATE de saúde (etapa b), na mesma transação
    await db.exec(`CREATE FUNCTION poison() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.client_id = '${poison}' THEN RAISE EXCEPTION 'poison'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER poison BEFORE INSERT ON client_health_snapshots FOR EACH ROW EXECUTE FUNCTION poison();`);
    const alertsP1Before = (await db.query<{ k: string }>(`SELECT concat_ws('|', id, is_resolved) k FROM client_alerts WHERE client_id = ANY($1) ORDER BY id`, [firstPage])).rows;
    const p = bindSupabase(db);
    const body = await runHandler();
    expect(p.applies.map((a) => !!a.error)).toEqual([true, false, false]);
    expect(body.summary[ORG_A].failed).toBe(500);
    expect(body).toMatchObject({ totalFailed: 500, orgsFailed: 0 });
    expect(logRuntimeMock.mock.calls[0][0]).toMatchObject({ status: "error" });
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM upsell_clients WHERE id = ANY($1) AND health_updated_at IS NOT NULL`, [firstPage])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM client_health_snapshots WHERE client_id = ANY($1)`, [firstPage])).rows[0].n).toBe(0);
    expect((await db.query<{ k: string }>(`SELECT concat_ws('|', id, is_resolved) k FROM client_alerts WHERE client_id = ANY($1) ORDER BY id`, [firstPage])).rows).toEqual(alertsP1Before);
    const leadsP1 = new Set(seeded.clients.filter((c) => firstPage.includes(c.id)).map((c) => c.lead));
    expect(sendText.mock.calls.filter((c) => firstPage.includes(c[4].trackId))).toEqual([]);
    expect(fireTriggerMock.mock.calls.filter(([x]) => leadsP1.has(x.leadId))).toEqual([]);
    expect(p.rateKeys.filter((k) => firstPage.includes(k.split(":")[1]))).toEqual([]);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM upsell_clients WHERE organization_id=$1 AND is_active AND health_updated_at IS NULL`, [ORG_B])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM upsell_clients WHERE organization_id=$1 AND is_active AND NOT (id = ANY($2)) AND health_updated_at IS NULL`, [ORG_A, firstPage])).rows[0].n).toBe(0);

    await db.exec(`DROP TRIGGER poison ON client_health_snapshots`);
    logRuntimeMock.mockClear();
    const q = bindSupabase(db, { failInputsFor: ORG_A });
    const body2 = await runHandler();
    expect(q.requests.filter((r) => r.startsWith("rpc:portfolio"))).toEqual([
      "rpc:portfolio_health_inputs", "rpc:portfolio_health_inputs", "rpc:portfolio_health_apply",
    ]);
    expect(q.applies.every((a) => a.org === ORG_B)).toBe(true);
    expect(body2).toMatchObject({ orgsFailed: 1, totalFailed: 0 });
    expect(logRuntimeMock.mock.calls[0][0]).toMatchObject({ status: "error", payloadSnapshot: { orgsFailed: 1 } });
    console.log("[QA] apply falho:", p.applies[0].error?.slice(0, 120));
    await db.close();
  }, 120_000);

  it("multi-tenant: apply cruzado = 42501 sem escrita; inputs não vaza; grants", async () => {
    const { db, seeded } = await freshDb();
    // mensagem/contexto da org B usando lead da org A não pode contaminar A
    const aFirst = seeded.clients.find((c) => c.org === ORG_A)!;
    await db.query(`INSERT INTO whatsapp_messages (organization_id, lead_id, direction, "timestamp") VALUES ($1, $2, 'incoming', $3)`,
      [ORG_B, aFirst.lead, NOW.toISOString()]);
    await db.exec("SET ROLE service_role");
    const pageA = (await db.query<{ r: { clients: { id: string; last_incoming_at: string | null; orders: { id: string }[] }[] } }>(
      `SELECT portfolio_health_inputs($1) r`, [ORG_A])).rows[0].r;
    await db.exec("RESET ROLE");
    const aIds = new Set(seeded.clients.filter((c) => c.org === ORG_A).map((c) => c.id));
    expect(pageA.clients.every((c) => aIds.has(c.id))).toBe(true);
    const orderIds = pageA.clients.flatMap((c) => c.orders.map((o) => o.id));
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM upsell_orders WHERE id = ANY($1) AND organization_id <> $2`, [orderIds, ORG_A])).rows[0].n).toBe(0);
    const li = pageA.clients.find((c) => c.id === aFirst.id)?.last_incoming_at;
    expect(li === null || li === undefined || new Date(li).getTime() < NOW.getTime()).toBe(true);

    const before = { c: await clientState(db), s: await snapState(db), a: await alertState(db) };
    const bClient = seeded.clients.find((c) => c.org === ORG_B)!.id;
    const row = (id: string) => ({ client_id: id, health_score: 1, health_status: "risco", segment: "resgate", reorder_cycle_days: 30,
      days_since_last_order: 1, last_order_at: null, next_order_expected: null, order_count: 1, lifetime_value: 1, avg_ticket: 1,
      trend: "down", churn_probability: 1, signals: [{ alert_type: "nps_low", severity: "critical", title: "t", description: "d", metadata: {} }] });
    const tryApply = async (org: string, rows: unknown[]) => {
      await db.exec("SET ROLE service_role");
      try { await db.query(`SELECT portfolio_health_apply($1, $2, $3)`, [org, NOW.toISOString(), JSON.stringify(rows)]); return "ok"; }
      catch (e) { return (e as { code?: string }).code; }
      finally { await db.exec("RESET ROLE"); }
    };
    expect(await tryApply(ORG_A, [row(aFirst.id), row(bClient)])).toBe("42501");
    expect(await tryApply(ORG_B, [row(aFirst.id)])).toBe("42501");
    expect({ c: await clientState(db), s: await snapState(db), a: await alertState(db) }).toEqual(before);

    for (const fn of ["portfolio_health_inputs(uuid,uuid,integer)", "portfolio_health_apply(uuid,timestamptz,jsonb)"]) {
      const g = (await db.query<{ a: boolean; u: boolean; s: boolean }>(`SELECT has_function_privilege('anon','${fn}','EXECUTE') a,
        has_function_privilege('authenticated','${fn}','EXECUTE') u, has_function_privilege('service_role','${fn}','EXECUTE') s`)).rows[0];
      expect(g).toEqual({ a: false, u: false, s: true });
    }
    await db.close();
  }, 60_000);
});
