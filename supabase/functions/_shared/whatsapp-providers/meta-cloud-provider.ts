// deno-lint-ignore-file no-explicit-any require-await
/**
 * MetaCloudProvider — WhatsApp via the official Meta Cloud API (Graph).
 *
 * Slice 1 = ISOLATION SKELETON. It exists so that `provider='meta_cloud'`
 * rows resolve to a real, *contained* provider instead of hitting the factory's
 * "unknown provider" throw — which keeps the system safe the instant the DB
 * CHECK is widened. It does NOT yet send: real Graph calls, the 24h-window
 * guard, template selection, media upload, and Embedded-Signup provisioning
 * arrive in later slices.
 *
 * Contract obligations honored here (see docs/meta-cloud-cert/CERTIFICATION.md):
 *  - Rule 7: Uazapi-only capability methods throw NotSupportedError, whose
 *    message carries the literal "does not support" substring so the frontend
 *    `isFeatureUnavailable()` matcher surfaces the correct toast (mirrors
 *    EvolutionProvider exactly).
 *  - Meta has no QR pairing / instance-init: connectQR + createInstance are
 *    genuinely unsupported (connection happens via Embedded Signup, a separate
 *    entry point — NOT this factory).
 *  - Credentials are resolved lazily, fail-closed, via a service-role RPC
 *    (later slice). Nothing is fetched until a send path is implemented, so the
 *    skeleton never touches the Uazapi credential RPC.
 */

import {
  NotSupportedError,
  type CreateInstanceInput,
  type CreateInstanceResult,
  type InstanceStatus,
  type SendMediaOptions,
  type SendResult,
  type SendTextOptions,
  type WhatsAppProvider,
} from "../whatsapp-client.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface MetaCloudProviderConfig {
  instanceId: string;
  organizationId: string;
  supabaseAdmin: SupabaseClient;
}

/** Thrown by core methods that Meta supports but slice 1 has not built yet. */
export class MetaNotImplementedError extends Error {
  override readonly name = "MetaNotImplementedError";
  constructor(method: string) {
    super(`meta_cloud provider: ${method} not implemented yet (slice 1 skeleton)`);
  }
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly provider = "meta_cloud" as const;

  // Stored for the lazy, fail-closed credential fetch added in a later slice.
  protected readonly instanceId: string;
  protected readonly organizationId: string;
  protected readonly supabaseAdmin: SupabaseClient;

  constructor(config: MetaCloudProviderConfig) {
    this.instanceId = config.instanceId;
    this.organizationId = config.organizationId;
    this.supabaseAdmin = config.supabaseAdmin;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────
  // Meta Cloud has no QR pairing and no instance-init endpoint; numbers are
  // provisioned through Embedded Signup. These are genuinely unsupported here.
  createInstance(_input: CreateInstanceInput): Promise<CreateInstanceResult> {
    throw new NotSupportedError("meta_cloud", "createInstance (use Embedded Signup)");
  }

  connectQR(_phone?: string): Promise<{ qrcode?: string; paircode?: string }> {
    throw new NotSupportedError("meta_cloud", "connectQR (use Embedded Signup)");
  }

  // ── Core messaging — supported by Meta, built in later slices ─────────────
  getStatus(): Promise<InstanceStatus> {
    throw new MetaNotImplementedError("getStatus");
  }

  deleteInstance(): Promise<void> {
    throw new MetaNotImplementedError("deleteInstance");
  }

  logoutInstance(): Promise<void> {
    throw new MetaNotImplementedError("logoutInstance");
  }

  sendText(_opts: SendTextOptions): Promise<SendResult> {
    throw new MetaNotImplementedError("sendText");
  }

  sendMedia(_opts: SendMediaOptions): Promise<SendResult> {
    throw new MetaNotImplementedError("sendMedia");
  }

  setPresence(_number: string, _state: "composing" | "available"): Promise<void> {
    throw new MetaNotImplementedError("setPresence");
  }

  downloadMedia(_messageId: string): Promise<{ base64: string; mimetype: string }> {
    throw new MetaNotImplementedError("downloadMedia");
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
