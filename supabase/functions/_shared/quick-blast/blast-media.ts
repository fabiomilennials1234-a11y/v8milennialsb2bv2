/**
 * blast-media — the single attachment a Disparo carries (Chamado dac7e647).
 *
 * Two kinds travel on /sender/advanced today: an image, and a document (PDF or
 * Word). The provider contract for the document item comes from the Uazapi spec
 * (openapi-bundled.json, POST /sender/advanced, `messages[]`): `type:"document"`,
 * `file` = URL, `docName` = file name, and the caption in `text` ("Texto da
 * mensagem … ou legenda para mídia").
 *
 * Pure module: the edge fn validates the request with `parseBlastMediaInput`,
 * the plan persists `blastMediaColumns`, and every release reads it back with
 * `resolvePlanMedia`.
 */

export type BlastMediaKind = "image" | "document";

export interface BlastMedia {
  type: BlastMediaKind;
  /** Public URL the provider downloads. */
  url: string;
  /** File name shown to the lead (documents). Null for legacy image plans. */
  name: string | null;
}

/** blast_plans.media_name ceiling — same as the server-side check. */
export const BLAST_MEDIA_NAME_MAX = 255;

const MEDIA_KINDS: ReadonlySet<string> = new Set<BlastMediaKind>(["image", "document"]);
const PUBLIC_MEDIA_PREFIX = "/storage/v1/object/public/media/";

/** C0 control characters or DEL — never part of a file name a lead should see. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export type ParseBlastMediaResult =
  | { ok: true; media: BlastMedia | null }
  | { ok: false; error: "media_url_invalida" | "media_type_invalido" | "media_name_invalido" | "media_conflitante" };

/**
 * Validate the attachment of a blast-plan-create request, FAIL-CLOSED.
 *
 * The URL is handed to the provider, which downloads it and delivers it to every
 * lead of the Disparo — so only a public object of THIS project's `media` bucket
 * is accepted (same origin as SUPABASE_URL, public path, no traversal). Anything
 * else is refused before a plan exists.
 *
 * The legacy `image_url` alone (older clients, the API) keeps its behaviour:
 * accepted as an image, exactly as before this change.
 */
export function parseBlastMediaInput(
  body: { media_url?: unknown; media_type?: unknown; media_name?: unknown; image_url?: unknown },
  supabaseUrl: string,
): ParseBlastMediaResult {
  const hasMediaFields =
    body.media_url != null || body.media_type != null || body.media_name != null;

  if (!hasMediaFields) {
    const legacy = typeof body.image_url === "string" ? body.image_url.trim() : "";
    return { ok: true, media: legacy ? { type: "image", url: legacy, name: null } : null };
  }

  if (typeof body.media_url !== "string" || !isOwnPublicMediaUrl(body.media_url, supabaseUrl)) {
    return { ok: false, error: "media_url_invalida" };
  }
  if (typeof body.media_type !== "string" || !MEDIA_KINDS.has(body.media_type)) {
    return { ok: false, error: "media_type_invalido" };
  }
  const type = body.media_type as BlastMediaKind;

  let name: string | null = null;
  if (body.media_name != null) {
    if (typeof body.media_name !== "string") return { ok: false, error: "media_name_invalido" };
    const trimmed = body.media_name.trim();
    if (trimmed.length > BLAST_MEDIA_NAME_MAX || hasControlChars(trimmed)) {
      return { ok: false, error: "media_name_invalido" };
    }
    name = trimmed || null;
  }
  // The document's name is what the lead sees in WhatsApp — never send one blank.
  if (type === "document" && !name) return { ok: false, error: "media_name_invalido" };

  // A new client also sends image_url for images (older servers read only that).
  // Anything else in image_url contradicts the attachment: refuse, do not guess.
  if (body.image_url != null && (type !== "image" || body.image_url !== body.media_url)) {
    return { ok: false, error: "media_conflitante" };
  }

  return { ok: true, media: { type, url: body.media_url, name } };
}

/** Public object of this project's `media` bucket — and nothing else. */
function isOwnPublicMediaUrl(raw: string, supabaseUrl: string): boolean {
  if (!supabaseUrl) return false;
  let url: URL;
  let base: URL;
  try {
    url = new URL(raw);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (url.origin !== base.origin) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  // Reject traversal on the RAW string too: URL() already collapses "../", and
  // an encoded "%2e%2e" survives the parse untouched.
  if (/(^|\/)(\.|%2e){2}(\/|$)/i.test(raw)) return false;
  if (!url.pathname.startsWith(PUBLIC_MEDIA_PREFIX)) return false;
  return url.pathname.length > PUBLIC_MEDIA_PREFIX.length;
}

/**
 * Columns a plan persists for its attachment.
 *
 * An image keeps writing ONLY the legacy `image_url` — the path that works today
 * stays byte-identical and does not depend on migration 20271211000000. A
 * document is the one shape that needs the new columns. A text-only plan writes
 * none of them.
 */
export function blastMediaColumns(media: BlastMedia | null): {
  image_url: string | null;
  media_url?: string;
  media_type?: BlastMediaKind;
  media_name?: string | null;
} {
  if (!media) return { image_url: null };
  if (media.type === "image") return { image_url: media.url };
  return { image_url: null, media_url: media.url, media_type: media.type, media_name: media.name };
}

/** Read a persisted plan's attachment: the new columns first, then legacy image_url. */
export function resolvePlanMedia(plan: {
  image_url?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  media_name?: string | null;
}): BlastMedia | null {
  if (plan.media_url && plan.media_type && MEDIA_KINDS.has(plan.media_type)) {
    return { type: plan.media_type as BlastMediaKind, url: plan.media_url, name: plan.media_name ?? null };
  }
  if (plan.image_url) return { type: "image", url: plan.image_url, name: null };
  return null;
}
