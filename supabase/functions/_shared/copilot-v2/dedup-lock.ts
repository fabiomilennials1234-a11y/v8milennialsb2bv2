/**
 * dedup-lock — Copilot v2 inbound dedup key + window (pure layer).
 *
 * The atomic reservation lives in the SQL RPC `copilot_v2_acquire_dedup_lock`
 * (INSERT ON CONFLICT DO NOTHING RETURNING) — that is what actually serializes
 * concurrent identical messages. This module computes the canonical lock KEY so
 * equivalent content collapses to the same row, and the per-source TTL window.
 *
 * The hash is a deterministic, dependency-free FNV-1a over normalized content —
 * good enough for a dedup key (collision-resistant within a per-(org,phone)
 * scope) without pulling in crypto for a sync, pure function.
 */

export type DedupSource = "inbound" | "outbound" | "system";

export function normalizeForDedup(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}

/** FNV-1a 32-bit, hex. Pure + deterministic. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in unsigned range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export interface DedupKeyArgs {
  orgId: string;
  phone: string;
  content: string;
  source: DedupSource;
}

/**
 * Canonical dedup key. Scoped by org (multi-tenant isolation) + phone, hashing
 * the normalized content so cosmetic differences don't defeat dedup.
 */
export function buildDedupKey(args: DedupKeyArgs): string {
  const contentHash = fnv1a(normalizeForDedup(args.content));
  return `${args.orgId}:${args.phone}:${args.source}:${contentHash}`;
}

const WINDOW_BY_SOURCE: Record<DedupSource, number> = {
  inbound: 30,
  outbound: 60,
  system: 15,
};

export function dedupWindowSeconds(source: DedupSource): number {
  return WINDOW_BY_SOURCE[source] ?? 30;
}
