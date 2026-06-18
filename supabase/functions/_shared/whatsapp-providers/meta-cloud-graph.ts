/**
 * meta-cloud-graph — thin, injectable HTTP client for the WhatsApp Cloud SEND
 * surface of the Meta Graph API. No DB, no global state. All network I/O goes
 * through an injectable `fetchImpl`, so sendText / sendMedia / sendTemplate /
 * uploadMedia / getMedia / getPhoneNumber are unit-testable without ever
 * touching Meta.
 *
 * WHY a separate client (Slice — outbound send, ADR-0009 / CERTIFICATION §6):
 *   - The cert's coverage gate (§6) requires NEW Cloud-send logic in NEW files
 *     with their own tests — do NOT fatten meta-api.ts (per-file branch floor
 *     goes red). This file owns ONLY the raw Graph HTTP; the provider
 *     orchestrates creds + 24h window + the SendResult mapping.
 *   - Mirrors the established pattern of createMetaEmbeddedSignupGraph /
 *     createMetaTemplateGraph: factory(token, phoneNumberId) → thin methods.
 *
 * SECURITY:
 *   - The access token is supplied by the caller (resolved via the service_role
 *     RPC get_meta_cloud_credentials). It is sent only as an `Authorization:
 *     Bearer` header and is NEVER logged, echoed into an error, or returned.
 *     graphError() strips it — it carries only Meta's message + code.
 *
 * VERSION: pinned to the same GRAPH_VERSION the connection/template clients use
 * so a Cloud number speaks one Graph version across connect, template and send.
 */

export const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * A typed Graph error carrying Meta's message + code. NEVER carries the access
 * token. The provider lets this bubble (fail-closed) — there is no silent
 * swallow of a send failure.
 */
export class MetaGraphError extends Error {
  override readonly name = "MetaGraphError";
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.code = code;
  }
}

function graphError(error: { message?: string; code?: number; type?: string }): MetaGraphError {
  const code = typeof error.code === "number" ? error.code : null;
  const suffix = code != null ? ` (code ${code})` : "";
  return new MetaGraphError(`Meta Graph error: ${error.message ?? "unknown"}${suffix}`, code);
}

// ─── Send payloads (Graph shapes) ────────────────────────────────

/** Cloud media `type` discriminator on a /messages send. */
export type MetaMediaType = "image" | "video" | "audio" | "document" | "sticker";

/** The media object Meta accepts: either an uploaded media `id` OR an external `link`. */
export interface MetaMediaObject {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export interface MetaTemplatePayload {
  name: string;
  language: { code: string };
  components?: unknown[];
}

/** Normalized result of a successful Graph send: the real wamid. */
export interface MetaSendResult {
  /** The real WhatsApp message id (wamid) Meta assigned. */
  wamid: string;
}

// ─── Graph client ────────────────────────────────────────────────

export interface MetaCloudGraph {
  /** POST /{phone_number_id}/messages — free-form text. Returns the real wamid. */
  sendText(to: string, text: string): Promise<MetaSendResult>;

  /**
   * POST /{phone_number_id}/messages — media by external URL. caption applies to
   * image/video/document only; filename to document only (the provider gates
   * which fields are set per type).
   */
  sendMediaByLink(to: string, type: MetaMediaType, media: MetaMediaObject): Promise<MetaSendResult>;

  /** POST /{phone_number_id}/messages — media by previously-uploaded media id. */
  sendMediaById(to: string, type: MetaMediaType, media: MetaMediaObject): Promise<MetaSendResult>;

  /** POST /{phone_number_id}/messages — pre-approved template (ignores the 24h window). */
  sendTemplate(to: string, template: MetaTemplatePayload): Promise<MetaSendResult>;

  /**
   * POST /{phone_number_id}/media — uploads bytes (multipart) and returns the
   * Cloud media id used by sendMediaById.
   */
  uploadMedia(bytes: Uint8Array, mimeType: string): Promise<string>;

  /**
   * GET /{media_id} → { url, mime_type }, then GET that url with the Bearer
   * token. Returns the raw bytes + mime so the caller can base64-encode.
   * Destrava mídia inbound (Cloud stores only a media_id on the message).
   */
  getMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }>;

  /**
   * GET /{phone_number_id}?fields=verified_name,display_phone_number,
   * quality_rating — used by the provider's getStatus(). Returns null on any
   * Graph/network failure so getStatus can degrade to 'unknown' (never throws).
   */
  getPhoneNumber(): Promise<
    { display_phone_number?: string; verified_name?: string; quality_rating?: string } | null
  >;
}

/**
 * Builds a thin Graph client bound to one number's token + phone_number_id.
 * Injectable `fetchImpl` for tests. The token lives only in the closure and the
 * Authorization header — never in a field a caller can read back.
 */
export function createMetaCloudGraph(opts: {
  token: string;
  phoneNumberId: string;
  fetchImpl?: FetchImpl;
  version?: string;
}): MetaCloudGraph {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = opts.version ?? GRAPH_VERSION;
  const base = `${GRAPH_BASE}/${version}`;
  const { token, phoneNumberId } = opts;

  async function postMessage(body: Record<string, unknown>): Promise<MetaSendResult> {
    const res = await fetchImpl(`${base}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.error) throw graphError(json.error as { message?: string; code?: number });
    const messages = json.messages as Array<{ id?: string }> | undefined;
    const wamid = messages?.[0]?.id;
    if (!wamid) {
      throw new MetaGraphError("Meta Graph: resposta de envio sem message id (wamid)");
    }
    return { wamid: String(wamid) };
  }

  return {
    sendText(to, text) {
      return postMessage({
        to,
        type: "text",
        text: { body: text, preview_url: false },
      });
    },

    sendMediaByLink(to, type, media) {
      const obj: MetaMediaObject = { link: media.link };
      if (media.caption != null) obj.caption = media.caption;
      if (media.filename != null) obj.filename = media.filename;
      return postMessage({ to, type, [type]: obj });
    },

    sendMediaById(to, type, media) {
      const obj: MetaMediaObject = { id: media.id };
      if (media.caption != null) obj.caption = media.caption;
      if (media.filename != null) obj.filename = media.filename;
      return postMessage({ to, type, [type]: obj });
    },

    sendTemplate(to, template) {
      return postMessage({ to, type: "template", template });
    },

    async uploadMedia(bytes, mimeType) {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", mimeType);
      form.append(
        "file",
        new Blob([bytes as BlobPart], { type: mimeType }),
        "upload",
      );
      const res = await fetchImpl(`${base}/${phoneNumberId}/media`, {
        method: "POST",
        // No Content-Type header — fetch sets the multipart boundary itself.
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) throw graphError(json.error as { message?: string; code?: number });
      const id = json.id;
      if (!id) throw new MetaGraphError("Meta Graph: upload de mídia sem id");
      return String(id);
    },

    async getMedia(mediaId) {
      // 1) Resolve the short-lived signed URL + mime for the media id.
      const metaRes = await fetchImpl(`${base}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const metaJson = (await metaRes.json()) as Record<string, unknown>;
      if (metaJson.error) throw graphError(metaJson.error as { message?: string; code?: number });
      const url = typeof metaJson.url === "string" ? metaJson.url : "";
      const mimeType = typeof metaJson.mime_type === "string" ? metaJson.mime_type : "application/octet-stream";
      if (!url) throw new MetaGraphError("Meta Graph: media node sem url");

      // 2) Fetch the bytes — the CDN url still requires the Bearer token.
      const binRes = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!binRes.ok) {
        throw new MetaGraphError(`Meta Graph: download de mídia falhou (HTTP ${binRes.status})`);
      }
      const buf = new Uint8Array(await binRes.arrayBuffer());
      return { bytes: buf, mimeType };
    },

    async getPhoneNumber() {
      try {
        const params = new URLSearchParams({
          fields: "verified_name,display_phone_number,quality_rating",
        });
        const res = await fetchImpl(`${base}/${phoneNumberId}?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (json.error) return null;
        return {
          display_phone_number:
            typeof json.display_phone_number === "string" ? json.display_phone_number : undefined,
          verified_name: typeof json.verified_name === "string" ? json.verified_name : undefined,
          quality_rating: typeof json.quality_rating === "string" ? json.quality_rating : undefined,
        };
      } catch {
        // Network failure must degrade to 'unknown' in getStatus, never throw.
        return null;
      }
    },
  };
}
