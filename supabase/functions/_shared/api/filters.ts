/**
 * Server-side allowlist for `GET /api/v1/leads` query filters (ADR-0008,
 * decision 4). Only known params are honored — everything else is ignored, so
 * a caller can never inject arbitrary filter columns.
 *
 * Multi-value filters (stage/tier/tag/origin) accept comma-separated lists.
 */

export interface LeadFilters {
  stage?: string[];
  tier?: string[];
  tag?: string[];
  origin?: string[];
  responsible_id?: string;
  created_from?: string;
  created_to?: string;
  q?: string;
}

const MULTI = ["stage", "tier", "tag", "origin"] as const;
const SCALAR = ["responsible_id", "created_from", "created_to", "q"] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const f: LeadFilters = {};

  for (const key of MULTI) {
    const raw = params.get(key);
    if (raw == null) continue;
    const list = splitList(raw);
    if (list.length > 0) f[key] = list;
  }

  for (const key of SCALAR) {
    const raw = params.get(key);
    if (raw == null) continue;
    const v = raw.trim();
    if (v.length > 0) f[key] = v;
  }

  return f;
}

/** Parses `?limit=`, clamped to [1, 100], defaulting to 50. */
export function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw == null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}
