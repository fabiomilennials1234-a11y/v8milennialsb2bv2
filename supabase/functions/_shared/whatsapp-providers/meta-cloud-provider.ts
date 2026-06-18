// deno-lint-ignore-file no-explicit-any
/**
 * MetaCloudProvider — WhatsApp via the official Meta Cloud API (Graph).
 *
 * Outbound send slice (Track B final, ADR-0009). The provider ORCHESTRATES:
 *   1. lazy, fail-closed credential resolution (service_role RPC
 *      get_meta_cloud_credentials — never the client, never a selectable column),
 *   2. the 24h customer-service window guard (meta-cloud-window — Meta-ONLY),
 *   3. the SendResult mapping to the REAL wamid Meta returns.
 * The raw Graph HTTP lives in the injectable meta-cloud-graph client.
 *
 * D4 — persistence (see docs/meta-cloud-cert + slice notes): the provider does
 * NOT persist the outgoing `whatsapp_messages` row. Both callers that can reach
 * a meta_cloud instance already persist it keyed by SendResult.message_id (= the
 * wamid):
 *   - human composer: useSendWhatsAppMessage/Media upsert
 *     whatsapp_messages(message_id=result.message_id, onConflict message_id,instance_id);
 *   - server auto-dispatch (outbound-sender, etc.) persists keyed by the same id
 *     BUT is provider-blind-excluded from Meta (Rule 1), so it never reaches here.
 * Persisting here would DOUBLE-WRITE. Returning the real wamid is sufficient:
 * meta-webhook/applyCloudStatus then UPDATEs that exact row by (message_id,
 * instance_id) on sent/delivered/read/failed.
 *
 * Contract obligations honored (docs/meta-cloud-cert/CERTIFICATION.md):
 *  - Rule 6: the window guard runs only for Meta, inside this provider.
 *  - Rule 7: Uazapi-only capability methods throw NotSupportedError ("does not
 *    support") so the frontend isFeatureUnavailable() matcher shows the right
 *    toast (mirrors EvolutionProvider exactly, synchronously).
 *  - Rule 9: credentials fail-closed via the service-role RPC; token NEVER logged
 *    or echoed in an error (the graph client redacts it).
 */

import {
  MetaWindowClosedError,
  NotSupportedError,
  type CreateInstanceInput,
  type CreateInstanceResult,
  type InstanceStatus,
  type SendMediaOptions,
  type SendResult,
  type SendTemplateOptions,
  type SendTextOptions,
  type WhatsAppProvider,
} from "../whatsapp-client.ts";
import {
  createMetaCloudGraph,
  type FetchImpl,
  type MetaCloudGraph,
  type MetaMediaType,
} from "./meta-cloud-graph.ts";
import { isSessionOpen } from "./meta-cloud-window.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface MetaCloudProviderConfig {
  instanceId: string;
  organizationId: string;
  supabaseAdmin: SupabaseClient;
  /** Injectable fetch + graph factory for tests. Defaults to the real Graph. */
  fetchImpl?: FetchImpl;
  graphFactory?: typeof createMetaCloudGraph;
}

interface ResolvedCreds {
  wabaId: string | null;
  phoneNumberId: string;
  accessToken: string;
  organizationId: string;
}

/** Maps our unified media type → the Cloud `type` discriminator. */
function toMetaMediaType(type: SendMediaOptions["type"]): MetaMediaType {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "ptt":
      return "audio";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    default:
      return "document";
  }
}

/** Cloud carries `to` as bare digits — strip everything else. */
function toDigits(number: string): string {
  return String(number).replace(/\D/g, "");
}

function isHttpUrl(file: string): boolean {
  return /^https?:\/\//i.test(file.trim());
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly provider = "meta_cloud" as const;

  protected readonly instanceId: string;
  protected readonly organizationId: string;
  protected readonly supabaseAdmin: SupabaseClient;
  private readonly fetchImpl?: FetchImpl;
  private readonly graphFactory: typeof createMetaCloudGraph;

  // Memoized per-instance to avoid re-hitting the RPC across text+media in a turn.
  private credsPromise: Promise<ResolvedCreds> | null = null;

  constructor(config: MetaCloudProviderConfig) {
    this.instanceId = config.instanceId;
    this.organizationId = config.organizationId;
    this.supabaseAdmin = config.supabaseAdmin;
    this.fetchImpl = config.fetchImpl;
    this.graphFactory = config.graphFactory ?? createMetaCloudGraph;
  }

  // ── Credentials (lazy, fail-closed — Rule 9) ──────────────────────────────
  private resolveCreds(): Promise<ResolvedCreds> {
    if (!this.credsPromise) {
      this.credsPromise = this.fetchCreds().catch((e) => {
        // Reset so a transient failure can be retried on the next call.
        this.credsPromise = null;
        throw e;
      });
    }
    return this.credsPromise;
  }

  private async fetchCreds(): Promise<ResolvedCreds> {
    const { data, error } = await this.supabaseAdmin.rpc("get_meta_cloud_credentials", {
      p_instance_id: this.instanceId,
    });
    if (error) {
      // Never include the RPC payload (could echo nothing sensitive, but stay terse).
      throw new Error(`Failed to fetch meta_cloud credentials: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error(`No meta_cloud credentials found for instance ${this.instanceId}`);
    }
    const accessToken: string | null = row.meta_access_token ?? null;
    const phoneNumberId: string | null = row.meta_phone_number_id ?? null;
    if (!accessToken) {
      throw new Error(`meta_access_token is null for instance ${this.instanceId}`);
    }
    if (!phoneNumberId) {
      throw new Error(`meta_phone_number_id is null for instance ${this.instanceId}`);
    }
    return {
      wabaId: row.meta_waba_id ?? null,
      phoneNumberId,
      accessToken,
      organizationId: row.organization_id ?? this.organizationId,
    };
  }

  private async graph(): Promise<{ client: MetaCloudGraph; creds: ResolvedCreds }> {
    const creds = await this.resolveCreds();
    const client = this.graphFactory({
      token: creds.accessToken,
      phoneNumberId: creds.phoneNumberId,
      fetchImpl: this.fetchImpl,
    });
    return { client, creds };
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────
  // Meta Cloud has no QR pairing / instance-init; numbers come from Embedded
  // Signup. These remain genuinely unsupported here.
  createInstance(_input: CreateInstanceInput): Promise<CreateInstanceResult> {
    throw new NotSupportedError("meta_cloud", "createInstance (use Embedded Signup)");
  }

  connectQR(_phone?: string): Promise<{ qrcode?: string; paircode?: string }> {
    throw new NotSupportedError("meta_cloud", "connectQR (use Embedded Signup)");
  }

  deleteInstance(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "deleteInstance (managed via Embedded Signup)");
  }

  logoutInstance(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "logoutInstance (managed via Embedded Signup)");
  }

  // ── Status ────────────────────────────────────────────────────────────────
  async getStatus(): Promise<InstanceStatus> {
    try {
      const { client } = await this.graph();
      const phone = await client.getPhoneNumber();
      if (!phone) return { connected: false, state: "unknown" };
      return {
        connected: true,
        state: "connected",
        owner: phone.display_phone_number ? toDigits(phone.display_phone_number) : undefined,
      };
    } catch {
      // Credential miss or network failure → degrade, never throw from status.
      return { connected: false, state: "disconnected" };
    }
  }

  // ── sendText (24h window gated — Rule 6) ──────────────────────────────────
  async sendText(opts: SendTextOptions): Promise<SendResult> {
    const { client } = await this.graph();
    const to = toDigits(opts.number);

    // `to` is bare digits — the SAME form Cloud inbound stores in
    // whatsapp_messages.phone_number (meta-webhook persists `msg.from`), so the
    // window lookup matches regardless of how the composer formatted the input.
    const window = await isSessionOpen(this.supabaseAdmin, this.instanceId, to);
    if (!window.open) {
      throw new MetaWindowClosedError(window.lastInboundAt);
    }

    const { wamid } = await client.sendText(to, opts.text);
    return { message_id: wamid, status: "sent", timestamp: Date.now() };
  }

  // ── sendMedia (24h window gated — Rule 6 / D5) ────────────────────────────
  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    const { client } = await this.graph();
    const to = toDigits(opts.number);
    const metaType = toMetaMediaType(opts.type);

    // `to` bare digits matches whatsapp_messages.phone_number (see sendText note).
    const window = await isSessionOpen(this.supabaseAdmin, this.instanceId, to);
    if (!window.open) {
      throw new MetaWindowClosedError(window.lastInboundAt);
    }

    // caption only on image/video/document; filename only on document.
    const allowsCaption = metaType === "image" || metaType === "video" || metaType === "document";
    const caption = allowsCaption && opts.caption ? opts.caption : undefined;
    const filename = metaType === "document" ? opts.filename : undefined;

    let result;
    if (isHttpUrl(opts.file)) {
      result = await client.sendMediaByLink(to, metaType, {
        link: opts.file.trim(),
        caption,
        filename,
      });
    } else {
      // base64 (optionally a data: URL) → upload to obtain a media id, then send.
      const { bytes, mimeType } = decodeBase64Media(opts.file);
      const mediaId = await client.uploadMedia(bytes, mimeType);
      result = await client.sendMediaById(to, metaType, { id: mediaId, caption, filename });
    }

    return { message_id: result.wamid, status: "sent", timestamp: Date.now() };
  }

  // ── sendTemplate (Meta-only, ignores the window — D3) ─────────────────────
  async sendTemplate(opts: SendTemplateOptions): Promise<SendResult> {
    const { client } = await this.graph();
    const to = toDigits(opts.number);
    const { wamid } = await client.sendTemplate(to, {
      name: opts.templateName,
      language: { code: opts.language },
      components: opts.components,
    });
    return { message_id: wamid, status: "sent", timestamp: Date.now() };
  }

  // ── setPresence — NO-OP (D6) ──────────────────────────────────────────────
  // Meta Cloud has no presence/typing equivalent. Copilot calls setPresence
  // before sending, so this MUST NOT throw — silently succeed.
  setPresence(_number: string, _state: "composing" | "available"): Promise<void> {
    return Promise.resolve();
  }

  // ── downloadMedia (inbound media id → bytes — D6) ─────────────────────────
  async downloadMedia(mediaId: string): Promise<{ base64: string; mimetype: string }> {
    const { client } = await this.graph();
    const { bytes, mimeType } = await client.getMedia(mediaId);
    return { base64: encodeBase64(bytes), mimetype: mimeType };
  }

  // ── Uazapi-only capabilities (Rule 7) ─────────────────────────────────────
  // Mirror EvolutionProvider: throw NotSupportedError so isFeatureUnavailable()
  // ("does not support") shows the right toast instead of a raw 500.
  sendMenu(): Promise<SendResult> {
    throw new NotSupportedError("meta_cloud", "sendMenu");
  }

  sendPixButton(): Promise<SendResult> {
    throw new NotSupportedError("meta_cloud", "sendPixButton");
  }

  react(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "react");
  }

  edit(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "edit");
  }

  pin(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "pin");
  }

  deleteForAll(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "deleteForAll");
  }

  markRead(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "markRead");
  }

  listChats(): Promise<Array<{ id: string; name?: string; isGroup?: boolean; lastMessageTimestamp?: number }>> {
    throw new NotSupportedError("meta_cloud", "listChats");
  }

  historySync(): Promise<{ messages: unknown[]; nextCursor?: string }> {
    throw new NotSupportedError("meta_cloud", "historySync");
  }

  getMessageLimits(): Promise<{ current: number; limit: number; reachout_timelock?: number }> {
    throw new NotSupportedError("meta_cloud", "getMessageLimits");
  }

  senderAdvanced(): Promise<never> {
    throw new NotSupportedError("meta_cloud", "senderAdvanced");
  }

  senderGet(): Promise<never> {
    throw new NotSupportedError("meta_cloud", "senderGet");
  }

  senderPause(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "senderPause");
  }

  senderResume(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "senderResume");
  }

  senderStop(): Promise<void> {
    throw new NotSupportedError("meta_cloud", "senderStop");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// base64 helpers (Deno + Node/Vitest both expose atob/btoa globally)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Decodes a base64 payload (optionally a `data:<mime>;base64,...` URL) into raw
 * bytes + mime. Falls back to application/octet-stream when no mime is present.
 */
export function decodeBase64Media(file: string): { bytes: Uint8Array; mimeType: string } {
  let mimeType = "application/octet-stream";
  let b64 = file.trim();
  const dataUrl = b64.match(/^data:([^;,]+)[^,]*;base64,(.+)$/);
  if (dataUrl) {
    mimeType = dataUrl[1];
    b64 = dataUrl[2];
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType };
}

/** Encodes raw bytes to a base64 string. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
