/**
 * Minimal, forgiving PostgREST emulation over in-memory fixture rows.
 *
 * Implements what supabase-js actually sends: `select=` with embeds
 * (`alias:rel!hint(cols)`, `!inner`, spreads, `count`), horizontal filters
 * (eq/neq/gt/gte/lt/lte/like/ilike/is/in/cs/cd/ov/not.*), `or=`/`and=` trees,
 * `order=`, `limit`/`offset`. Anything it does not understand is IGNORED
 * (row kept) rather than erroring — the goal is a screen that renders, not a
 * conformant database.
 */

// ───────────────────────── select parsing ─────────────────────────

/** Split on top-level commas (ignores commas inside parentheses / quotes). */
export function splitTop(str, sep = ",") {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of str) {
    if (ch === '"') quote = !quote;
    if (!quote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === sep && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a select string into nodes:
 *  { kind: "star" }
 *  { kind: "col", name, alias, path }            (path = json path segments)
 *  { kind: "embed", rel, alias, hint, inner, spread, children }
 *  { kind: "count", alias }
 */
export function parseSelect(sel) {
  if (!sel) return [{ kind: "star" }];
  return splitTop(sel.replace(/\s+/g, "")).map(parseSelectItem);
}

function parseSelectItem(item) {
  let spread = false;
  if (item.startsWith("...")) {
    spread = true;
    item = item.slice(3);
  }
  const paren = item.indexOf("(");
  if (paren !== -1 && item.endsWith(")")) {
    let head = item.slice(0, paren);
    const inner = item.slice(paren + 1, -1);
    let alias = null;
    if (head.includes(":")) [alias, head] = head.split(":");
    const parts = head.split("!");
    const rel = parts[0];
    let hint = null;
    let isInner = false;
    for (const p of parts.slice(1)) {
      if (p === "inner") isInner = true;
      else if (p === "left") continue;
      else hint = p;
    }
    if (rel === "count" && inner === "") return { kind: "count", alias: alias ?? "count" };
    return { kind: "embed", rel, alias, hint, inner: isInner, spread, children: parseSelect(inner) };
  }
  if (item === "*") return { kind: "star" };
  let alias = null;
  let expr = item;
  // alias:col  (but not the `::cast`)
  const aliasMatch = expr.match(/^([A-Za-z0-9_]+):(?!:)(.*)$/);
  if (aliasMatch) {
    alias = aliasMatch[1];
    expr = aliasMatch[2];
  }
  expr = expr.replace(/::[a-z0-9_[\]]+$/i, "");
  if (expr === "count()" || expr === "count") return { kind: "count", alias: alias ?? "count" };
  // aggregate like `amount.sum()` — return the column value
  expr = expr.replace(/\.(sum|avg|min|max|count)\(\)$/, "");
  const path = expr.split(/->>?/);
  const name = path[0];
  return { kind: "col", name, alias: alias ?? (path.length > 1 ? path[path.length - 1] : null), path };
}

// ───────────────────────── filters ─────────────────────────

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseValueList(v) {
  // in.(a,b,"c d")  /  cs.{a,b}
  const inner = v.replace(/^[({]/, "").replace(/[)}]$/, "");
  if (inner === "") return [];
  return splitTop(inner).map((x) => x.replace(/^"|"$/g, ""));
}

function coerce(raw, sample) {
  if (raw === "null") return null;
  if (typeof sample === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (typeof sample === "boolean") return raw === "true";
  return raw;
}

function getPath(row, path) {
  let v = row;
  for (const seg of path) {
    if (v == null) return undefined;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        return undefined;
      }
    }
    v = v[seg];
  }
  return v;
}

function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function likeToRegex(pattern, flags) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*");
  return new RegExp(`^${esc}$`, flags);
}

/** Evaluate `op.value` against a column value. Unknown op → true (lenient). */
function evalOp(value, opExpr) {
  let negate = false;
  if (opExpr.startsWith("not.")) {
    negate = true;
    opExpr = opExpr.slice(4);
  }
  const dot = opExpr.indexOf(".");
  const op = dot === -1 ? opExpr : opExpr.slice(0, dot);
  const raw = dot === -1 ? "" : decodeURIComponent(opExpr.slice(dot + 1));
  let res;
  switch (op) {
    case "eq":
      res = value != null && String(value) === String(coerce(raw, value));
      break;
    case "neq":
      res = value == null ? false : String(value) !== String(coerce(raw, value));
      break;
    case "gt":
      res = value != null && cmp(value, coerce(raw, value)) > 0;
      break;
    case "gte":
      res = value != null && cmp(value, coerce(raw, value)) >= 0;
      break;
    case "lt":
      res = value != null && cmp(value, coerce(raw, value)) < 0;
      break;
    case "lte":
      res = value != null && cmp(value, coerce(raw, value)) <= 0;
      break;
    case "like":
      res = value != null && likeToRegex(raw).test(String(value));
      break;
    case "ilike":
      res = value != null && likeToRegex(raw, "i").test(String(value));
      break;
    case "is":
      if (raw === "null") res = value == null;
      else if (raw === "true") res = value === true;
      else if (raw === "false") res = value === false;
      else res = true;
      break;
    case "in": {
      const list = parseValueList(raw);
      res = value != null && list.includes(String(value));
      break;
    }
    case "cs": {
      const list = raw.startsWith("{") ? parseValueList(raw) : safeJson(raw);
      if (Array.isArray(value) && Array.isArray(list)) res = list.every((x) => value.map(String).includes(String(x)));
      else if (value && typeof value === "object" && list && typeof list === "object")
        res = Object.entries(list).every(([k, v]) => JSON.stringify(value[k]) === JSON.stringify(v));
      else res = true;
      break;
    }
    case "cd": {
      const list = parseValueList(raw);
      res = Array.isArray(value) ? value.every((x) => list.includes(String(x))) : true;
      break;
    }
    case "ov": {
      const list = parseValueList(raw);
      res = Array.isArray(value) ? value.some((x) => list.includes(String(x))) : false;
      break;
    }
    case "fts":
    case "plfts":
    case "phfts":
    case "wfts":
      res = value != null && String(value).toLowerCase().includes(raw.toLowerCase());
      break;
    default:
      res = true;
  }
  return negate ? !res : res;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Parse `or=(a.eq.1,and(b.is.null,c.gt.2))` into a predicate. */
function parseLogic(expr, mode) {
  const inner = expr.replace(/^\(/, "").replace(/\)$/, "");
  const parts = splitTop(inner).map((p) => {
    const m = p.match(/^(not\.)?(or|and)\((.*)\)$/);
    if (m) {
      const sub = parseLogic(`(${m[3]})`, m[2]);
      return m[1] ? (row) => !sub(row) : sub;
    }
    // col.op.value  — column may contain json arrows
    const firstDot = p.indexOf(".");
    const col = p.slice(0, firstDot);
    const rest = p.slice(firstDot + 1);
    const path = col.split(/->>?/);
    return (row) => evalOp(getPath(row, path), rest);
  });
  return mode === "or" ? (row) => parts.some((f) => f(row)) : (row) => parts.every((f) => f(row));
}

/** Build predicates from query params. Filters on embedded resources (a.b=...) are ignored. */
export function buildFilters(params) {
  const preds = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") {
      try {
        preds.push(parseLogic(value, key));
      } catch {
        /* lenient */
      }
      continue;
    }
    if (key === "not.or" || key === "not.and") {
      try {
        const f = parseLogic(value, key.slice(4));
        preds.push((row) => !f(row));
      } catch {
        /* lenient */
      }
      continue;
    }
    if (/\.(or|and|order|limit|offset)$/.test(key)) continue; // embedded modifiers
    if (key.includes(".") && !key.includes("->")) continue; // embedded filter
    const path = key.split(/->>?/);
    preds.push((row) => evalOp(getPath(row, path), value));
  }
  return (row) => preds.every((p) => p(row));
}

export function applyOrder(rows, orderParam) {
  if (!orderParam) return rows;
  const specs = splitTop(orderParam).map((s) => {
    const parts = s.split(".");
    // strip embedded order like `stage.position` → ignore (keep as column path)
    const desc = parts.includes("desc");
    const nullsFirst = parts.includes("nullsfirst");
    const nullsLast = parts.includes("nullslast");
    const col = parts.filter((p) => !["asc", "desc", "nullsfirst", "nullslast"].includes(p)).join(".");
    return { path: col.split(/->>?/), desc, nullsFirst: nullsFirst || (!nullsLast && desc) };
  });
  return [...rows].sort((a, b) => {
    for (const s of specs) {
      const va = getPath(a, s.path);
      const vb = getPath(b, s.path);
      if (va == null || vb == null) {
        if (va == null && vb == null) continue;
        const nullCmp = va == null ? -1 : 1;
        return s.nullsFirst ? nullCmp : -nullCmp;
      }
      const c = cmp(va, vb);
      if (c !== 0) return s.desc ? -c : c;
    }
    return 0;
  });
}

// ───────────────────────── embedding ─────────────────────────

/**
 * Resolve how `parentTable` relates to `rel` using the FK graph from types.ts.
 * Returns { table, type: "m2o"|"o2m", localCol, remoteCol } or null.
 */
export function resolveRelation(schema, db, parentTable, rel, hint) {
  const tables = schema.tables;
  const parentRels = tables[parentTable]?.rels ?? [];
  const isTable = (t) => !!tables[t] || !!db[t];

  // rel given as an FK column name of the parent (e.g. `sdr_id(name)`).
  if (!isTable(rel)) {
    const viaCol = parentRels.find((r) => r.columns?.[0] === rel || r.fk === rel);
    if (viaCol) return { table: viaCol.ref, type: "m2o", localCol: viaCol.columns[0], remoteCol: viaCol.refColumns?.[0] ?? "id" };
    if (rel.endsWith("_id")) return guessM2O(rel, rel.replace(/_id$/, ""), db);
    return null;
  }
  const target = rel;
  const targetRels = tables[target]?.rels ?? [];

  if (hint) {
    // hint = column name on parent
    const byCol = parentRels.find((r) => r.ref === target && r.columns?.[0] === hint);
    if (byCol) return { table: target, type: "m2o", localCol: hint, remoteCol: byCol.refColumns?.[0] ?? "id" };
    // hint = constraint name on parent
    const byFkParent = parentRels.find((r) => r.fk === hint && (r.ref === target || true));
    if (byFkParent && byFkParent.ref === target)
      return { table: target, type: "m2o", localCol: byFkParent.columns[0], remoteCol: byFkParent.refColumns?.[0] ?? "id" };
    // hint = constraint name on target (one-to-many)
    const byFkTarget = targetRels.find((r) => r.fk === hint && r.ref === parentTable);
    if (byFkTarget) return { table: target, type: byFkTarget.oneToOne ? "o2o" : "o2m", localCol: byFkTarget.refColumns?.[0] ?? "id", remoteCol: byFkTarget.columns[0] };
    // hint = column name on target
    const byTargetCol = targetRels.find((r) => r.ref === parentTable && r.columns?.[0] === hint);
    if (byTargetCol) return { table: target, type: "o2m", localCol: "id", remoteCol: hint };
    if (byFkParent) return { table: target, type: "m2o", localCol: byFkParent.columns[0], remoteCol: "id" };
    // hint = column on parent even without declared FK
    if (/_id$|_to$|_by$/.test(hint)) return { table: target, type: "m2o", localCol: hint, remoteCol: "id" };
  }
  const m2o = parentRels.find((r) => r.ref === target);
  if (m2o) return { table: target, type: "m2o", localCol: m2o.columns[0], remoteCol: m2o.refColumns?.[0] ?? "id" };
  const o2m = targetRels.find((r) => r.ref === parentTable);
  if (o2m) return { table: target, type: o2m.oneToOne ? "o2o" : "o2m", localCol: o2m.refColumns?.[0] ?? "id", remoteCol: o2m.columns[0] };
  // Heuristics for views (no FK metadata): <singular>_id on either side.
  const singular = (t) => t.replace(/ies$/, "y").replace(/s$/, "");
  const sampleParent = db[parentTable]?.[0] ?? {};
  const sampleTarget = db[target]?.[0] ?? {};
  if (`${singular(target)}_id` in sampleParent) return { table: target, type: "m2o", localCol: `${singular(target)}_id`, remoteCol: "id" };
  if (`${singular(parentTable)}_id` in sampleTarget) return { table: target, type: "o2m", localCol: "id", remoteCol: `${singular(parentTable)}_id` };
  return { table: target, type: "m2o", localCol: `${singular(target)}_id`, remoteCol: "id" };
}

function guessM2O(col, base, db) {
  const candidates = [`${base}s`, `${base}es`, base.replace(/y$/, "ies")];
  const table = candidates.find((t) => db[t]) ?? candidates[0];
  return { table, type: "m2o", localCol: col, remoteCol: "id" };
}

/** Project a row according to select nodes (keeps all columns on `*`). */
export function projectRow(ctx, table, row, nodes) {
  const hasStar = nodes.some((n) => n.kind === "star");
  const out = hasStar ? { ...row } : {};
  let keep = true;
  for (const n of nodes) {
    if (n.kind === "col") {
      const v = getPath(row, n.path);
      out[n.alias ?? n.name] = v === undefined ? null : v;
    } else if (n.kind === "count") {
      out[n.alias] = 1;
    } else if (n.kind === "embed") {
      const relInfo = resolveRelation(ctx.schema, ctx.db, table, n.rel, n.hint);
      const key = n.alias ?? n.rel;
      if (!relInfo) {
        out[key] = null;
        continue;
      }
      const targetRows = ctx.db[relInfo.table] ?? [];
      const countOnly = n.children.length === 1 && n.children[0].kind === "count";
      if (relInfo.type === "m2o" || relInfo.type === "o2o") {
        const lv = relInfo.type === "m2o" ? row[relInfo.localCol] : row[relInfo.localCol ?? "id"];
        const match =
          lv == null ? null : targetRows.find((t) => String(t[relInfo.type === "m2o" ? relInfo.remoteCol : relInfo.remoteCol]) === String(lv)) ?? null;
        if (n.inner && !match) keep = false;
        const projected = match && ctx.depth < 4 ? projectRow({ ...ctx, depth: ctx.depth + 1 }, relInfo.table, match, n.children).row : match;
        if (n.spread && projected) Object.assign(out, projected);
        else out[key] = projected;
      } else {
        const lv = row[relInfo.localCol];
        const matches = targetRows.filter((t) => lv != null && String(t[relInfo.remoteCol]) === String(lv));
        if (n.inner && matches.length === 0) keep = false;
        if (countOnly) out[key] = [{ count: matches.length }];
        else
          out[key] =
            ctx.depth < 4
              ? matches.map((m) => projectRow({ ...ctx, depth: ctx.depth + 1 }, relInfo.table, m, n.children).row)
              : matches;
      }
    }
  }
  return { row: out, keep };
}
