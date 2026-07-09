/**
 * Pure helpers for the whatsapp-media-retention edge function.
 *
 * NO Deno / Supabase imports on purpose — this module is unit-tested in Node
 * (Vitest) and re-used by index.ts. Keep it side-effect free.
 *
 * Storage path shapes under the (public, shared) `media` bucket:
 *   - Inbound  (persisted by `_shared/whatsapp-media.ts`):
 *       `whatsapp-media/{org_id}/{message_id}.{ext}`            → 3 segments
 *   - Outbound (uploaded by `useWhatsAppSend.uploadMediaToStorage`):
 *       `whatsapp-media/{org_id}/{random_uuid}/{file_name}`     → 4 segments
 *
 * Everything else in the bucket (message templates, campaign assets, avatars,
 * copilot audio, ...) lives under DIFFERENT prefixes and MUST never be touched.
 */

export const WHATSAPP_MEDIA_PREFIX = "whatsapp-media/";

/**
 * True only for objects under the `whatsapp-media/` prefix. Defensive scope
 * guard — the retention job never deletes an object for which this is false,
 * even if the listing RPC somehow returned it.
 */
export function isWhatsAppMediaPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith(WHATSAPP_MEDIA_PREFIX);
}

export type MediaCorrelation =
  | { kind: "inbound"; orgId: string; messageId: string; path: string }
  | { kind: "outbound"; orgId: string; path: string }
  | { kind: "unknown"; path: string };

/**
 * Correlate a storage object path back to the whatsapp_messages row(s) it
 * belongs to.
 *
 * Inbound paths embed the `message_id` (precise, indexed match). Outbound paths
 * only carry a random UUID, so the caller must fall back to matching by
 * `media_url LIKE '%' || path` (the media_url column stores the full public URL,
 * which ends with the storage path).
 */
export function correlatePathToMessage(path: string): MediaCorrelation {
  if (!isWhatsAppMediaPath(path)) return { kind: "unknown", path };

  const segments = path.split("/");
  const orgId = segments[1] ?? "";
  if (!orgId) return { kind: "unknown", path };

  // `whatsapp-media/{org}/{message_id}.{ext}` → inbound
  if (segments.length === 3) {
    const file = segments[2] ?? "";
    const dot = file.lastIndexOf(".");
    const messageId = dot > 0 ? file.slice(0, dot) : file;
    if (!messageId) return { kind: "unknown", path };
    return { kind: "inbound", orgId, messageId, path };
  }

  // `whatsapp-media/{org}/{uuid}/{file}` (or deeper) → outbound
  if (segments.length >= 4) {
    return { kind: "outbound", orgId, path };
  }

  return { kind: "unknown", path };
}

/**
 * Escape LIKE metacharacters (`\`, `%`, `_`) so a path with underscores in the
 * file name (e.g. `image_1699999999.png`) is matched literally in
 * `media_url LIKE '%' || path`. Postgres default escape char is backslash.
 */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export interface MediaCandidate {
  path: string;
  size_bytes: number;
}

export interface CandidateSummary {
  deleted_count: number;
  freed_bytes_estimate: number;
  orgs_affected: number;
}

/**
 * Aggregate a candidate list for dry-run reporting. Pure — no side effects.
 * `orgs_affected` counts distinct org ids derived from the path (the tenant is
 * encoded in the path, so no cross-tenant leakage is possible here).
 */
export function summarizeCandidates(candidates: MediaCandidate[]): CandidateSummary {
  const orgs = new Set<string>();
  let bytes = 0;
  for (const c of candidates) {
    bytes += Number(c.size_bytes) || 0;
    const corr = correlatePathToMessage(c.path);
    if (corr.kind !== "unknown") orgs.add(corr.orgId);
  }
  return {
    deleted_count: candidates.length,
    freed_bytes_estimate: bytes,
    orgs_affected: orgs.size,
  };
}
