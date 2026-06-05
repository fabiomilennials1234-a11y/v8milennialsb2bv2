// deno-lint-ignore-file no-explicit-any

/**
 * UazapiProvider — WhatsAppProvider implementation backed by UazapiClient
 *
 * Translates the unified WhatsAppProvider interface into Uazapi API calls.
 * All Uazapi-specific methods are fully implemented.
 *
 * createInstance also persists the per-instance token via set_uazapi_credentials RPC.
 */

import { UazapiClient } from "../uazapi-client.ts";
import { extractOwnerNumber } from "../whatsapp-owner.ts";
import type {
  CreateInstanceInput,
  CreateInstanceResult,
  InstanceStatus,
  SendMediaOptions,
  SendMenuOptions,
  SendPixButtonOptions,
  SendResult,
  SendTextOptions,
  WhatsAppProvider,
} from "../whatsapp-client.ts";
import type {
  UazapiSenderAdvancedInput,
  UazapiSenderResponse,
} from "../uazapi-types.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Normalise Uazapi status string → InstanceStatus
// ---------------------------------------------------------------------------

function normaliseStatus(raw: {
  status?: string | { connected?: boolean; loggedIn?: boolean };
  connected?: boolean;
  qrcode?: string;
  paircode?: string;
  owner?: string;
}): InstanceStatus {
  const rawStatus = raw.status;
  // Uazapi /instance/init returns status as object {connected, loggedIn, jid},
  // while /instance/status returns a string. Handle both.
  const statusObj = typeof rawStatus === "object" && rawStatus !== null ? rawStatus : null;
  const s = (typeof rawStatus === "string" ? rawStatus : "").toLowerCase();

  let state: InstanceStatus["state"] = "unknown";
  if (statusObj) {
    state = statusObj.connected ? "connected" : "disconnected";
  } else if (s === "connected") state = "connected";
  else if (s === "connecting") state = "connecting";
  else if (s === "disconnected" || s === "closed") state = "disconnected";

  const isConnected = statusObj?.connected ?? raw.connected ?? state === "connected";

  return {
    connected: isConnected,
    state,
    qrcode: raw.qrcode,
    paircode: raw.paircode,
    owner: raw.owner,
  };
}

// ---------------------------------------------------------------------------
// UazapiProvider config
// ---------------------------------------------------------------------------

export interface UazapiProviderConfig {
  baseUrl: string;
  token: string;
  adminToken: string;
  instanceId: string;
  organizationId: string;
  supabaseAdmin: SupabaseClient;
}

// ---------------------------------------------------------------------------
// UazapiProvider
// ---------------------------------------------------------------------------

export class UazapiProvider implements WhatsAppProvider {
  readonly provider = "uazapi" as const;

  private readonly client: UazapiClient;
  private readonly baseUrl: string;
  private readonly instanceId: string;
  private readonly organizationId: string;
  private readonly supabaseAdmin: SupabaseClient;

  constructor(config: UazapiProviderConfig) {
    this.client = new UazapiClient({
      baseUrl: config.baseUrl,
      token: config.token,
      adminToken: config.adminToken,
    });
    this.baseUrl = config.baseUrl;
    this.instanceId = config.instanceId;
    this.organizationId = config.organizationId;
    this.supabaseAdmin = config.supabaseAdmin;
  }

  // =========================================================================
  // Instance lifecycle
  // =========================================================================

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    // Webhook auth: Uazapi has no HMAC / customHeaders. Secret is embedded
    // as a path segment; edge function validates with timingSafeCompare.
    if (!input.webhook_secret) {
      throw new Error("UazapiProvider.createInstance: webhook_secret required");
    }
    const webhookUrl = `${input.webhook_url.replace(/\/$/, "")}/${input.webhook_secret}`;

    const resp = await this.client.initInstance({
      name: input.instance_name,
      adminField01: input.organization_id,
      adminField02: input.instance_id,
      webhookUrl,
      // Fase 2 scope: messages + messages_update + connection. Other events
      // (presence, history, call, groups) remain off to reduce ingress volume.
      webhookEvents: ["messages", "messages_update", "connection"],
      // Echo elimination at source (Uazapi server-side). Defense in depth:
      // UPSERT idempotent preserved in whatsapp-webhook (contract from 3066b5e).
      webhookExcludeMessages: ["wasSentByApi"],
      // Append /<event> to webhook URL — future routing to split workers.
      webhookAddUrlEvents: true,
      webhookAddUrlTypesMessages: false,
    });

    // Extract from nested response: instance.id, instance.token, top-level status object
    const instanceId = resp.instance?.id ?? (resp as any).id;
    const instanceToken = resp.instance?.token ?? resp.token;

    // Persist token via RPC — service_role only
    const { error: rpcError } = await this.supabaseAdmin.rpc(
      "set_uazapi_credentials",
      {
        p_instance_id: input.instance_id,
        p_organization_id: input.organization_id,
        p_uazapi_instance_id: instanceId,
        p_uazapi_token: instanceToken,
      }
    );

    if (rpcError) {
      throw new Error(
        `Failed to persist uazapi credentials via RPC: ${rpcError.message}`
      );
    }

    // /instance/init may ignore inline webhook fields — explicitly configure
    // via /instance/updateWebhook using the newly obtained instance token.
    const instanceClient = new UazapiClient({
      baseUrl: this.baseUrl,
      token: instanceToken,
    });
    await instanceClient.updateWebhook({
      url: webhookUrl,
      events: ["messages", "messages_update", "connection"],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: true,
      addUrlTypesMessages: false,
    });

    return {
      provider_instance_id: instanceId,
      provider_token: instanceToken,
      status: normaliseStatus({
        status: resp.status ?? resp.instance?.status,
        qrcode: resp.instance?.qrcode ?? (resp as any).qrcode,
        paircode: resp.instance?.paircode ?? (resp as any).paircode,
        owner: extractOwnerNumber(resp),
      }),
    };
  }

  async getStatus(): Promise<InstanceStatus> {
    const raw: any = await this.client.getInstanceStatus();
    const inst = raw.instance ?? raw;
    return normaliseStatus({
      status: inst.status,
      connected: inst.connected ?? raw.connected,
      qrcode: inst.qrcode,
      paircode: inst.paircode,
      owner: extractOwnerNumber(raw),
    });
  }

  async connectQR(
    phone?: string
  ): Promise<{ qrcode?: string; paircode?: string }> {
    const raw: any = await this.client.connectInstance(phone);
    return {
      qrcode: raw.instance?.qrcode || raw.qrcode,
      paircode: raw.instance?.paircode || raw.paircode,
    };
  }

  async deleteInstance(): Promise<void> {
    await this.client.deleteInstance();
  }

  async logoutInstance(): Promise<void> {
    await this.client.logoutInstance();
  }

  // =========================================================================
  // Messaging
  // =========================================================================

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    const resp = await this.client.sendText({
      number: opts.number,
      text: opts.text,
      delay: opts.delay,
      replyid: opts.replyid,
      readchat: opts.readchat,
      track_source: opts.trackSource,
      track_id: opts.trackId,
    });
    return {
      message_id: resp.id,
      status: resp.status,
      timestamp: resp.timestamp,
    };
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    const resp = await this.client.sendMedia({
      number: opts.number,
      type: opts.type as any,
      file: opts.file,
      filename: opts.filename,
      caption: opts.caption,
      delay: opts.delay,
      track_source: opts.trackSource,
      track_id: opts.trackId,
    });
    return {
      message_id: resp.id,
      status: resp.status,
      timestamp: resp.timestamp,
    };
  }

  // =========================================================================
  // Sender (mass send) — delegates to UazapiClient /sender/* (Uazapi-only)
  // =========================================================================

  async senderAdvanced(
    input: UazapiSenderAdvancedInput
  ): Promise<UazapiSenderResponse> {
    return this.client.senderAdvanced(input);
  }

  async senderGet(senderId: string): Promise<UazapiSenderResponse> {
    return this.client.senderGet(senderId);
  }

  async senderPause(senderId: string): Promise<void> {
    await this.client.senderPause(senderId);
  }

  async senderResume(senderId: string): Promise<void> {
    await this.client.senderResume(senderId);
  }

  async senderStop(senderId: string): Promise<void> {
    await this.client.senderStop(senderId);
  }

  async setPresence(
    number: string,
    state: "composing" | "available"
  ): Promise<void> {
    const presence =
      state === "composing" ? "composing" : "available";
    await this.client.setPresence({ number, presence });
  }

  async downloadMedia(
    messageId: string
  ): Promise<{ base64: string; mimetype: string }> {
    const resp = await this.client.downloadMedia(messageId);
    return { base64: resp.base64, mimetype: resp.mimetype };
  }

  // =========================================================================
  // Uazapi-only methods (fully implemented)
  // =========================================================================

  async sendMenu(opts: SendMenuOptions): Promise<SendResult> {
    const resp = await this.client.sendMenu({
      number: opts.number,
      type: opts.type,
      text: opts.text,
      choices: opts.choices,
    });
    return {
      message_id: resp.id,
      status: resp.status,
      timestamp: resp.timestamp,
    };
  }

  async sendPixButton(opts: SendPixButtonOptions): Promise<SendResult> {
    const resp = await this.client.sendPixButton({
      number: opts.number,
      pixkey: opts.pixkey,
      pixkeyType: opts.pixkeyType as any,
      merchantName: opts.merchantName,
      amount: opts.amount,
      text: opts.text,
    });
    return {
      message_id: resp.id,
      status: resp.status,
      timestamp: resp.timestamp,
    };
  }

  async react(
    messageId: string,
    number: string,
    emoji: string
  ): Promise<void> {
    await this.client.react(messageId, number, emoji);
  }

  async edit(
    messageId: string,
    number: string,
    newText: string
  ): Promise<void> {
    await this.client.edit(messageId, number, newText);
  }

  async pin(messageId: string, number: string): Promise<void> {
    await this.client.pin(messageId, number);
  }

  async deleteForAll(messageId: string, number: string): Promise<void> {
    await this.client.deleteForAll(messageId, number);
  }

  async markRead(messageId: string, number: string): Promise<void> {
    await this.client.markRead(messageId, number);
  }

  async listChats(type: "all" | "individual" | "group" = "all"): Promise<Array<{ id: string; name?: string; isGroup?: boolean; lastMessageTimestamp?: number }>> {
    return this.client.listChats(type);
  }

  async historySync(opts: {
    chat_jid?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ messages: unknown[]; nextCursor?: string }> {
    const number = opts.chat_jid ?? "";
    return this.client.historySync({ number, limit: opts.limit, cursor: opts.cursor });
  }

  async getMessageLimits(): Promise<{
    current: number;
    limit: number;
    reachout_timelock?: number;
  }> {
    return this.client.getMessageLimits();
  }

  async reconfigureWebhook(webhookUrl: string): Promise<void> {
    await this.client.updateWebhook({
      url: webhookUrl,
      events: ["messages", "messages_update", "connection"],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: true,
      addUrlTypesMessages: false,
    });
  }
}
