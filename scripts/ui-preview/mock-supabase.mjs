#!/usr/bin/env node
/**
 * ui-preview — fake Supabase for rendering the REAL app with fixture data.
 *
 *   node scripts/ui-preview/mock-supabase.mjs [--master] [--port 54399] [--quiet]
 *
 * Serves, on 127.0.0.1 only:
 *   /auth/v1/*          fake user + session (see lib/session.mjs)
 *   /rest/v1/<table>    PostgREST emulation over fixtures (lib/postgrest.mjs)
 *   /rest/v1/rpc/<fn>   fixtures/rpc.mjs, else a type-shaped empty answer
 *   /functions/v1/<fn>  fixtures/functions.mjs, else {}
 *   /storage/v1/*       empty
 *   /realtime/v1/websocket  silent Phoenix socket (lib/realtime.mjs)
 *   /__log  /__misses  /__reset   introspection for shoot.mjs
 *
 * Never talks to the network. Writes (POST/PATCH/DELETE) mutate memory only;
 * GET /__reset (or a restart) restores the seed.
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadSchema, defaultFor } from "./lib/schema.mjs";
import { parseSelect, buildFilters, applyOrder, projectRow } from "./lib/postgrest.mjs";
import { handleRealtimeUpgrade } from "./lib/realtime.mjs";
import { MOCK_HOST, MOCK_PORT, buildSession, buildUser } from "./lib/session.mjs";
import { buildFixtures, fixtureNow } from "./fixtures/seed.mjs";
import { rpcHandlers } from "./fixtures/rpc.mjs";
import { functionHandlers } from "./fixtures/functions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i !== -1 ? args[i + 1] : d;
};
const PORT = Number(opt("--port", MOCK_PORT));
const MASTER = flag("--master") || process.env.UI_PREVIEW_MASTER === "1";
const QUIET = flag("--quiet");

const schema = loadSchema(resolve(ROOT, "src/integrations/supabase/types.ts"));

let fx;
function reset() {
  fx = buildFixtures({ master: MASTER, now: fixtureNow() });
  // Pad every fixture row with all real columns (types.ts) so `row.x === null`
  // checks and `.map` on NOT NULL arrays behave like production.
  for (const [table, rows] of Object.entries(fx.db)) {
    const cols = schema.tables[table]?.columns;
    if (!cols) continue;
    for (const row of rows) {
      for (const [c, meta] of Object.entries(cols)) {
        if (!(c in row)) row[c] = defaultFor(meta, schema.enums);
      }
    }
  }
}
reset();

// ───────────────────────── logging ─────────────────────────
const LOG_MAX = 20000;
let log = [];
function record(entry) {
  log.push({ t: Date.now(), ...entry });
  if (log.length > LOG_MAX) log = log.slice(-LOG_MAX / 2);
  if (!QUIET && entry.miss) console.log(`· miss ${entry.method} ${entry.kind} ${entry.name}${entry.note ? ` (${entry.note})` : ""}`);
}

// ───────────────────────── http helpers ─────────────────────────
function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "*",
    "Access-Control-Expose-Headers": "Content-Range, Range-Unit, X-Total-Count, Preference-Applied, Location",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function send(req, res, status, body, extra = {}) {
  const headers = { ...cors(req), ...extra };
  if (body === undefined || req.method === "HEAD") {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = typeof body === "string" ? body : JSON.stringify(body);
  headers["Content-Type"] ??= "application/json; charset=utf-8";
  res.writeHead(status, headers);
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

// ───────────────────────── auth ─────────────────────────
async function handleAuth(req, res, path, url) {
  const session = buildSession(fx);
  if (path === "/auth/v1/user") {
    if (req.method === "PUT") return send(req, res, 200, buildUser(fx));
    return send(req, res, 200, buildUser(fx));
  }
  if (path === "/auth/v1/token") return send(req, res, 200, session);
  if (path === "/auth/v1/logout") return send(req, res, 204);
  if (path === "/auth/v1/settings")
    return send(req, res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false });
  if (path.startsWith("/auth/v1/factors")) return send(req, res, 200, { id: "f0f0f0f0-0000-4000-8000-000000000001", type: "totp" });
  if (path === "/auth/v1/.well-known/jwks.json") return send(req, res, 200, { keys: [] });
  record({ kind: "auth", method: req.method, name: path, miss: true });
  return send(req, res, 200, {});
}

// ───────────────────────── rest ─────────────────────────
function wantsObject(req) {
  return (req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
}

function contentRange(offset, n, total) {
  return n === 0 ? `*/${total}` : `${offset}-${offset + n - 1}/${total}`;
}

function selectRows(table, params) {
  const rows = fx.db[table] ?? [];
  const pred = buildFilters(params);
  let matched = rows.filter((r) => {
    try {
      return pred(r);
    } catch {
      return true;
    }
  });
  matched = applyOrder(matched, params.get("order"));
  return matched;
}

async function handleRest(req, res, table, url) {
  const params = url.searchParams;
  const known = table in fx.db;
  const inSchema = !!schema.tables[table];
  const prefer = req.headers.prefer ?? "";
  const countExact = /count=(exact|planned|estimated)/.test(prefer);
  const nodes = parseSelect(params.get("select"));
  const ctx = { schema, db: fx.db, depth: 0 };

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = selectRows(table, params);
    const projected = [];
    for (const r of rows) {
      const { row, keep } = projectRow(ctx, table, r, nodes);
      if (keep) projected.push(row);
    }
    const total = projected.length;
    const offset = Number(params.get("offset") ?? 0);
    const limit = params.has("limit") ? Number(params.get("limit")) : Infinity;
    // Range header (older clients)
    let page = projected.slice(offset, offset + limit);
    const range = req.headers.range?.match(/(\d+)-(\d+)/);
    if (range) page = projected.slice(Number(range[1]), Number(range[2]) + 1);

    record({ kind: "rest", method: req.method, name: table, rows: page.length, miss: !known, note: !known ? (inSchema ? "empty table" : "NOT IN SCHEMA") : undefined, query: url.search.slice(0, 300) });

    const headers = { "Content-Range": contentRange(offset, page.length, total), "Range-Unit": "items" };
    if (countExact) headers["Preference-Applied"] = "count=exact";
    if (wantsObject(req)) {
      if (page.length === 0) record({ kind: "single0", method: "GET", name: table, miss: true, note: ".single() on 0 rows → 406", query: url.search.slice(0, 300) });
      if (page.length === 0)
        return send(req, res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }, headers);
      return send(req, res, 200, page[0], headers);
    }
    return send(req, res, 200, page, headers);
  }

  const body = await readBody(req);
  const returnRep = prefer.includes("return=representation");

  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body ?? {}];
    fx.db[table] ??= [];
    const created = items.map((it) => {
      const row = { id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...it };
      const onConflict = params.get("on_conflict");
      if (onConflict && prefer.includes("resolution=merge-duplicates")) {
        const keys = onConflict.split(",");
        const existing = fx.db[table].find((r) => keys.every((k) => String(r[k]) === String(row[k])));
        if (existing) return Object.assign(existing, it);
      }
      fx.db[table].push(row);
      return row;
    });
    record({ kind: "rest", method: "POST", name: table, rows: created.length });
    if (!returnRep) return send(req, res, 201);
    const out = created.map((r) => projectRow(ctx, table, r, nodes).row);
    return send(req, res, 201, wantsObject(req) ? out[0] : out);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    const rows = selectRows(table, params);
    for (const r of rows) Object.assign(r, body ?? {}, { updated_at: new Date().toISOString() });
    record({ kind: "rest", method: req.method, name: table, rows: rows.length });
    if (!returnRep) return send(req, res, 204);
    const out = rows.map((r) => projectRow(ctx, table, r, nodes).row);
    if (wantsObject(req)) return send(req, res, 200, out[0] ?? { ...(body ?? {}) });
    return send(req, res, 200, out);
  }

  if (req.method === "DELETE") {
    const rows = selectRows(table, params);
    fx.db[table] = (fx.db[table] ?? []).filter((r) => !rows.includes(r));
    record({ kind: "rest", method: "DELETE", name: table, rows: rows.length });
    if (!returnRep) return send(req, res, 204);
    return send(req, res, 200, wantsObject(req) ? rows[0] ?? null : rows);
  }

  return send(req, res, 405, { message: "method not allowed" });
}

async function handleRpc(req, res, fn, url) {
  let args = {};
  if (req.method === "GET" || req.method === "HEAD") {
    for (const [k, v] of url.searchParams) args[k] = v;
  } else {
    args = (await readBody(req)) ?? {};
  }
  const handler = rpcHandlers[fn];
  let result;
  let miss = false;
  if (handler) {
    try {
      result = await handler(args, fx, { schema });
    } catch (e) {
      console.error(`rpc ${fn} handler threw:`, e);
      result = null;
    }
  } else {
    miss = true;
    const meta = schema.functions[fn];
    if (!meta) result = [];
    else if (meta.returnsArray) result = [];
    else if (meta.returnType === "boolean") result = fn.startsWith("is_") || fn.startsWith("can_") || fn.startsWith("has_") ? true : false;
    else if (meta.returnType === "number") result = 0;
    else result = null;
  }
  record({ kind: "rpc", method: req.method, name: fn, miss, note: miss ? (schema.functions[fn] ? "default by type" : "NOT IN SCHEMA") : undefined });
  if (result instanceof Response) return send(req, res, result.status, await result.text());
  if (result && result.__status) return send(req, res, result.__status, result.body);
  if (wantsObject(req) && Array.isArray(result)) result = result[0] ?? null;
  // supabase-js treats an empty body as data=null
  if (result === null || result === undefined) return send(req, res, 200, "null");
  return send(req, res, 200, result);
}

async function handleFunction(req, res, name) {
  const body = req.method === "GET" ? null : await readBody(req);
  const handler = functionHandlers[name];
  let result = {};
  if (handler) {
    try {
      result = await handler(body, fx, req);
    } catch (e) {
      console.error(`function ${name} handler threw:`, e);
    }
  }
  record({ kind: "fn", method: req.method, name, miss: !handler });
  if (result && result.__status) return send(req, res, result.__status, result.body);
  return send(req, res, 200, result ?? {});
}

// ───────────────────────── server ─────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(req, res, 204);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/__reset") {
      reset();
      log = [];
      return send(req, res, 200, { ok: true });
    }
    if (path === "/__log") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return send(req, res, 200, log.filter((e) => e.t >= since));
    }
    if (path === "/__misses") {
      const agg = {};
      for (const e of log.filter((x) => x.miss)) {
        const k = `${e.kind} ${e.name}${e.note ? ` (${e.note})` : ""}`;
        agg[k] = (agg[k] ?? 0) + 1;
      }
      return send(req, res, 200, agg);
    }
    if (path === "/__health") return send(req, res, 200, { ok: true, master: MASTER, now: fx.NOW, nowIso: new Date(fx.NOW).toISOString() });

    if (path.startsWith("/auth/v1")) return handleAuth(req, res, path, url);
    if (path.startsWith("/rest/v1/rpc/")) return handleRpc(req, res, decodeURIComponent(path.slice("/rest/v1/rpc/".length)), url);
    if (path.startsWith("/rest/v1/")) return handleRest(req, res, decodeURIComponent(path.slice("/rest/v1/".length)), url);
    if (path === "/rest/v1") return send(req, res, 200, {});
    if (path.startsWith("/functions/v1/")) return handleFunction(req, res, path.slice("/functions/v1/".length).split("/")[0]);
    if (path.startsWith("/storage/v1/")) {
      record({ kind: "storage", method: req.method, name: path });
      if (path.includes("/object/list/")) return send(req, res, 200, []);
      if (path.includes("/object/sign/")) return send(req, res, 200, { signedURL: null, signedUrls: [] });
      if (path.startsWith("/storage/v1/bucket")) return send(req, res, 200, []);
      return send(req, res, 404, { statusCode: "404", error: "not_found", message: "Object not found (ui-preview)" });
    }
    record({ kind: "other", method: req.method, name: path, miss: true });
    return send(req, res, 404, { message: "ui-preview mock: unknown endpoint" });
  } catch (e) {
    console.error("mock error:", e);
    try {
      send(req, res, 500, { message: String(e?.message ?? e) });
    } catch {
      /* socket gone */
    }
  }
});

server.on("upgrade", (req, socket) => {
  if (req.url?.startsWith("/realtime/v1/websocket")) return handleRealtimeUpgrade(req, socket, QUIET ? null : null);
  socket.destroy();
});

server.listen(PORT, MOCK_HOST, () => {
  console.log(`ui-preview mock Supabase on http://${MOCK_HOST}:${PORT}  (master=${MASTER})`);
  console.log(`  fixture org: ${fx.org.name} (${fx.org.id}) — user ${fx.authUser.full_name} <${fx.authUser.email}>`);
  console.log(`  fixture clock: ${new Date(fx.NOW).toISOString()} (UI_PREVIEW_NOW=${process.env.UI_PREVIEW_NOW ?? "default"})`);
  console.log(`  tables seeded: ${Object.keys(fx.db).length}, schema tables: ${Object.keys(schema.tables).length}, rpc handlers: ${Object.keys(rpcHandlers).length}`);
});
