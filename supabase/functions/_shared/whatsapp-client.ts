// deno-lint-ignore-file no-explicit-any

/**
 * WhatsApp Provider Abstraction Layer
 *
 * Contracts:
 *  - WhatsAppProvider interface — unified API across Evolution and Uazapi
 *  - getWhatsAppProvider() factory — resolves provider from instance row + RPC
 *  - NotSupportedError — thrown by Evolution on Uazapi-only operations
 *
 * Security:
 *  - Credentials fetched via service_role RPC only (never from client)
 *  - Token never appears in logs (redactSecrets covers it)
 *  - organization_id boundary validated by callers, not here
 */

import { UazapiClient } from "./uazapi-client.ts";
import type {
  UazapiSenderAdvancedInput,
  UazapiSenderCreateResponse,
  UazapiSenderMessage,
  UazapiSenderResponse,
} from "./uazapi-types.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type WhatsAppInstance = {
  id: string;
  organization_id: string;
  provider: "evolution" | "uazapi" | "meta_cloud";
  instance_name: string;
  // Evolution-only fields
  evolution_api_key?: string | null;
  evolution_instance_name?: string | null;
  // Uazapi-specific metadata in JSONB
  provider_config?: Record<string, unknown>;
};

export type SendTextOptions = {
  number: string;
  text: string;
  delay?: number;
  replyid?: string;
  readchat?: boolean;
  trackSource?: string;
  trackId?: string;
};

export type SendMediaOptions = {
  number: string;
  type: "image" | "video" | "audio" | "document" | "ptt" | "sticker";
  file: string; // base64 or URL
  filename?: string;
  caption?: string;
  delay?: number;
  trackSource?: string;
  trackId?: string;
};

export type InstanceStatus = {
  connected: boolean;
  state: "connecting" | "connected" | "disconnected" | "unknown";
  qrcode?: string;
  paircode?: string;
  /**
   * The connected account's own number as bare digits (no `@s.whatsapp.net`
   * suffix). Best-effort — undefined when the provider payload doesn't expose it.
   */
  owner?: string;
};

export type CreateInstanceInput = {
  instance_id: string; // our UUID in whatsapp_instances
  organization_id: string;
  instance_name: string;
  webhook_url: string;
  webhook_secret: string; // UAZAPI_WEBHOOK_SECRET
};

export type CreateInstanceResult = {
  provider_instance_id: string;
  provider_token?: string; // only Uazapi returns per-instance token
  status: InstanceStatus;
};

export type SendResult = {
  message_id: string;
  status: "sent" | "queued" | "failed";
  timestamp: number;
};

export type SendTemplateOptions = {
  number: string;
  templateName: string;
  language: string;
  /** Graph template components (header/body/button params). Provider passes through. */
  components?: unknown[];
};

export type SendMenuOptions = {
  number: string;
  type: "button" | "list" | "poll" | "carousel";
  text: string;
  choices: string[];
  footer?: string;
  selectableCount?: number;
  delay?: number;
  trackSource?: string;
  trackId?: string;
};

export type SendPixButtonOptions = {
  number: string;
  pixkey: string;
  pixkeyType: "cpf" | "cnpj" | "email" | "phone" | "random";
  amount: number;
  merchantName: string;
  text?: string;
  delay?: number;
  trackSource?: string;
  trackId?: string;
};

// ---------------------------------------------------------------------------
// NotSupportedError
// ---------------------------------------------------------------------------

export class NotSupportedError extends Error {
  override readonly name = "NotSupportedError";

  constructor(
    public readonly provider: string,
    public readonly method: string
  ) {
    super(`${provider} does not support ${method}`);
  }
}

// ---------------------------------------------------------------------------
// MetaWindowClosedError
// ---------------------------------------------------------------------------

/**
 * Thrown by MetaCloudProvider.sendText/sendMedia when the 24h customer-service
 * window is CLOSED (no inbound from the contact within 24h). This is NOT a
 * NotSupportedError — Meta DOES support the send, but only via a pre-approved
 * TEMPLATE while the window is closed. Distinct error type so the caller can
 * surface "send a template" instead of "feature unavailable", and so it never
 * collides with the `isFeatureUnavailable()` "does not support" matcher.
 */
export class MetaWindowClosedError extends Error {
  override readonly name = "MetaWindowClosedError";
  /** Last inbound timestamp (ISO) when known — null when the contact never wrote. */
  readonly lastInboundAt: string | null;
  constructor(lastInboundAt: string | null = null) {
    super(
      "meta_cloud: 24h customer-service window is closed — a pre-approved template is required to message this contact",
    );
    this.lastInboundAt = lastInboundAt;
  }
}

// ---------------------------------------------------------------------------
// WhatsAppProvider interface
// ---------------------------------------------------------------------------

export interface WhatsAppProvider {
  // Instance lifecycle
  createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult>;
  getStatus(): Promise<InstanceStatus>;
  connectQR(phone?: string): Promise<{ qrcode?: string; paircode?: string }>;
  deleteInstance(): Promise<void>;
  logoutInstance(): Promise<void>;

  // Messaging
  sendText(opts: SendTextOptions): Promise<SendResult>;
  sendMedia(opts: SendMediaOptions): Promise<SendResult>;
  setPresence(number: string, state: "composing" | "available"): Promise<void>;
  downloadMedia(messageId: string): Promise<{ base64: string; mimetype: string }>;

  // Meta-only — send a pre-approved template (ignores the 24h window). Absent on
  // Uazapi/Evolution (optional, like sendMenu). Callers feature-detect.
  sendTemplate?(opts: SendTemplateOptions): Promise<SendResult>;

  // Uazapi-only — pre-flight WhatsApp existence check (POST /chat/check).
  // Absent on Evolution/Meta; callers feature-detect and skip gating when
  // unavailable. Returns one verdict per input number.
  checkNumbers?(
    numbers: string[],
  ): Promise<Array<{ number: string; isInWhatsapp: boolean }>>;

  // Uazapi-only (Evolution throws NotSupportedError)
  sendMenu?(opts: SendMenuOptions): Promise<SendResult>;
  sendPixButton?(opts: SendPixButtonOptions): Promise<SendResult>;
  react?(messageId: string, number: string, emoji: string): Promise<void>;
  edit?(messageId: string, number: string, newText: string): Promise<void>;
  pin?(messageId: string, number: string): Promise<void>;
  deleteForAll?(messageId: string, number: string): Promise<void>;
  /** Marca mensagens como lidas. Aceita lote — o endpoint da Uazapi é por array. */
  markRead?(messageIds: string | string[]): Promise<void>;
  listChats?(type?: "all" | "individual" | "group"): Promise<Array<{ id: string; name?: string; isGroup?: boolean; lastMessageTimestamp?: number }>>;
  historySync?(opts: {
    chat_jid?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ messages: unknown[]; nextCursor?: string }>;
  getMessageLimits?(): Promise<{
    current: number;
    limit: number;
    reachout_timelock?: number;
  }>;

  // Mass send / sender (Uazapi-only) — drives Quick Blast + CSV Mass Send.
  // CREATE returns { folder_id, count, status }; GET resolves the campaign via
  // /sender/listfolders into a normalized { status, sent, failed, total }.
  senderAdvanced?(input: UazapiSenderAdvancedInput): Promise<UazapiSenderCreateResponse>;
  senderGet?(folderId: string): Promise<UazapiSenderResponse>;
  /** Per-message folder statuses (POST /sender/listmessages, spike #943/ADR-0016).
   *  Raw rows, fully paginated — consumers parse defensively (doc↔server drift). */
  senderListMessages?(
    folderId: string,
    opts?: { messageStatus?: "Scheduled" | "Sent" | "Failed" }
  ): Promise<UazapiSenderMessage[]>;
  senderPause?(folderId: string): Promise<void>;
  senderResume?(folderId: string): Promise<void>;
  senderStop?(folderId: string): Promise<void>;

  readonly provider: "evolution" | "uazapi" | "meta_cloud";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Resolves the correct WhatsAppProvider for the given instance.
 *
 * For Uazapi: fetches per-instance token via service_role RPC.
 * For Evolution: constructs from instance row fields directly.
 *
 * Throws if credentials are missing or RPC fails — never swallows errors.
 */
export async function getWhatsAppProvider(
  instance: WhatsAppInstance,
  supabaseAdmin: SupabaseClient,
  options?: { bootstrap?: boolean }
): Promise<WhatsAppProvider> {
  // Meta Cloud (cert Rules 3 & 5): resolve FIRST, before the legacy kill-switch.
  // The org-wide `whatsapp_provider_override` only switches between the two
  // legacy providers (Uazapi ⇄ Evolution); it must NEVER coerce a per-instance
  // Meta number into a legacy code path. Returning here also narrows
  // `instance.provider` to "uazapi"|"evolution" for the assignment below.
  if (instance.provider === "meta_cloud") {
    const { MetaCloudProvider } = await import("./whatsapp-providers/meta-cloud-provider.ts");
    return new MetaCloudProvider({
      instanceId: instance.id,
      organizationId: instance.organization_id,
      supabaseAdmin,
    });
  }

  // FAIL-CLOSED on any non-legacy provider, BEFORE the kill-switch reads the
  // org row. Three things at once:
  //   1. It closes the vector where `whatsapp_provider_override` (below) COERCES
  //      a notificame row into uazapi (which would look up `get_uazapi_credentials`
  //      for a row that has no vault entry) or into evolution (which would build an
  //      EvolutionProvider with null keys). That path is reachable via
  //      preferredInstanceId and is NOT covered by the dispatch allowlist.
  //   2. It makes the `let effectiveProvider: "uazapi" | "evolution"` annotation
  //      below HONEST — rows arrive here cast as `any`, so today it lies, and that
  //      lie is the root cause of the hole being born silent.
  //   3. It moves the "Unknown provider" throw ahead of any I/O.
  // Behaviour for legacy rows: identical.
  if (instance.provider !== "uazapi" && instance.provider !== "evolution") {
    throw new Error(`Unknown provider: ${instance.provider}`);
  }

  // Sprint 3 S3.2 — kill-switch: organizations.whatsapp_provider_override
  // takes precedence over instance.provider. Used as panic button during
  // migration rollout if Uazapi has a platform-wide incident.
  let effectiveProvider: "uazapi" | "evolution" = instance.provider;
  try {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("whatsapp_provider_override")
      .eq("id", instance.organization_id)
      .maybeSingle();
    const override = (org as any)?.whatsapp_provider_override as
      | "uazapi"
      | "evolution"
      | null
      | undefined;
    if (override === "uazapi" || override === "evolution") {
      effectiveProvider = override;
    }
  } catch {
    // Never block on override lookup — fall back to instance.provider
  }

  if (effectiveProvider === "evolution") {
    const { EvolutionProvider } = await import("./whatsapp-providers/evolution-provider.ts");
    return new EvolutionProvider(instance);
  }

  if (effectiveProvider === "uazapi") {
    const baseUrl = (Deno as any).env.get("UAZAPI_BASE_URL");
    const adminToken = (Deno as any).env.get("UAZAPI_ADMIN_TOKEN");
    if (!baseUrl || !adminToken) {
      throw new Error("UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN not set");
    }

    const { UazapiProvider } = await import("./whatsapp-providers/uazapi-provider.ts");

    // Bootstrap mode: new instance with no credentials yet (createInstance flow).
    // Uses adminToken only — per-instance token is persisted by createInstance.
    if (options?.bootstrap) {
      return new UazapiProvider({
        baseUrl,
        token: "",
        adminToken,
        instanceId: instance.id,
        organizationId: instance.organization_id,
        supabaseAdmin,
      });
    }

    const { data, error } = await supabaseAdmin.rpc("get_uazapi_credentials", {
      p_instance_id: instance.id,
    });

    if (error) {
      throw new Error(`Failed to fetch uazapi credentials: ${error.message}`);
    }

    if (!data || (Array.isArray(data) && data.length === 0)) {
      throw new Error(`No uazapi credentials found for instance ${instance.id}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const uazapiToken: string = row.uazapi_token;

    if (!uazapiToken) {
      throw new Error(`uazapi_token is null for instance ${instance.id}`);
    }

    return new UazapiProvider({
      baseUrl,
      token: uazapiToken,
      adminToken,
      instanceId: instance.id,
      organizationId: instance.organization_id,
      supabaseAdmin,
    });
  }

  throw new Error(
    `Unknown provider resolved="${effectiveProvider}" for instance ${instance.id}`
  );
}
