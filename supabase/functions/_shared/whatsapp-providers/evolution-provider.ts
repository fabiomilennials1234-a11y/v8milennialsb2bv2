// deno-lint-ignore-file no-explicit-any

/**
 * EvolutionProvider — WhatsAppProvider implementation backed by Evolution API
 *
 * Wraps existing Evolution API behaviour in the unified WhatsAppProvider
 * interface. Does NOT rewrite Evolution logic — routes to same HTTP endpoints
 * that evolution-api-proxy and outbound-sender already use.
 *
 * Uazapi-only methods throw NotSupportedError.
 * Phase 7 removes this provider entirely.
 */

import {
  NotSupportedError,
  type CreateInstanceInput,
  type CreateInstanceResult,
  type InstanceStatus,
  type SendMediaOptions,
  type SendResult,
  type SendTextOptions,
  type WhatsAppInstance,
  type WhatsAppProvider,
} from "../whatsapp-client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEvolutionBase(): string {
  const url = (Deno as any).env.get("EVOLUTION_API_URL");
  if (!url) throw new Error("EVOLUTION_API_URL env not set");
  return url.replace(/\/$/, "");
}

function getEvolutionKey(): string {
  const key = (Deno as any).env.get("EVOLUTION_API_KEY");
  if (!key) throw new Error("EVOLUTION_API_KEY env not set");
  return key;
}

async function evolutionFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 15_000
): Promise<T> {
  const base = getEvolutionBase();
  const key = getEvolutionKey();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        apikey: key,
        "Content-Type": "application/json",
      },
      body:
        body !== undefined && method !== "GET"
          ? JSON.stringify(body)
          : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg =
        (errBody as any)?.message ||
        (errBody as any)?.error ||
        res.statusText;
      throw Object.assign(new Error(msg), { status: res.status, raw: errBody });
    }

    // 204 No Content
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined as unknown as T;
    }

    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      throw Object.assign(new Error(`Evolution API timeout after ${timeoutMs}ms`), {
        status: 504,
      });
    }
    throw e;
  }
}

function normaliseEvolutionState(raw: string | undefined): InstanceStatus {
  const s = (raw ?? "").toLowerCase();
  if (s === "open" || s === "connected") {
    return { connected: true, state: "connected" };
  }
  if (s === "connecting") {
    return { connected: false, state: "connecting" };
  }
  if (s === "close" || s === "closed" || s === "disconnected") {
    return { connected: false, state: "disconnected" };
  }
  return { connected: false, state: "unknown" };
}

// ---------------------------------------------------------------------------
// EvolutionProvider
// ---------------------------------------------------------------------------

export class EvolutionProvider implements WhatsAppProvider {
  readonly provider = "evolution" as const;

  private readonly instanceName: string;

  constructor(private readonly instance: WhatsAppInstance) {
    // Prefer evolution_instance_name, fall back to instance_name
    this.instanceName =
      instance.evolution_instance_name ?? instance.instance_name;
  }

  // =========================================================================
  // Instance lifecycle
  // =========================================================================

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    const resp = await evolutionFetch<any>("POST", "/instance/create", {
      instanceName: input.instance_name,
      webhook: {
        url: input.webhook_url,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    });

    const status = normaliseEvolutionState(resp?.instance?.status);
    return {
      provider_instance_id: resp?.instance?.instanceName ?? input.instance_name,
      status,
    };
  }

  async getStatus(): Promise<InstanceStatus> {
    const resp = await evolutionFetch<any>(
      "GET",
      `/instance/connectionState/${encodeURIComponent(this.instanceName)}`
    );
    return normaliseEvolutionState(resp?.instance?.state ?? resp?.state);
  }

  async connectQR(
    _phone?: string
  ): Promise<{ qrcode?: string; paircode?: string }> {
    const resp = await evolutionFetch<any>(
      "GET",
      `/instance/connect/${encodeURIComponent(this.instanceName)}`
    );
    return {
      qrcode: resp?.code ?? resp?.qrcode,
      paircode: undefined,
    };
  }

  async deleteInstance(): Promise<void> {
    await evolutionFetch<unknown>(
      "DELETE",
      `/instance/delete/${encodeURIComponent(this.instanceName)}`
    );
  }

  async logoutInstance(): Promise<void> {
    await evolutionFetch<unknown>(
      "DELETE",
      `/instance/logout/${encodeURIComponent(this.instanceName)}`
    );
  }

  // =========================================================================
  // Messaging
  // =========================================================================

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    const resp = await evolutionFetch<any>(
      "POST",
      `/message/sendText/${encodeURIComponent(this.instanceName)}`,
      { number: opts.number, text: opts.text }
    );
    return {
      message_id: resp?.key?.id ?? crypto.randomUUID(),
      status: "sent",
      timestamp: Date.now(),
    };
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    const resp = await evolutionFetch<any>(
      "POST",
      `/message/sendMedia/${encodeURIComponent(this.instanceName)}`,
      {
        number: opts.number,
        mediatype: opts.type,
        media: opts.file,
        fileName: opts.filename,
        caption: opts.caption,
      },
      60_000
    );
    return {
      message_id: resp?.key?.id ?? crypto.randomUUID(),
      status: "sent",
      timestamp: Date.now(),
    };
  }

  async setPresence(
    number: string,
    state: "composing" | "available"
  ): Promise<void> {
    await evolutionFetch<unknown>(
      "POST",
      `/chat/sendPresence/${encodeURIComponent(this.instanceName)}`,
      { number, delay: 500, presence: state === "composing" ? "composing" : "available" }
    ).catch(() => {
      // best-effort — presence failure must not break message flow
    });
  }

  async downloadMedia(
    messageId: string
  ): Promise<{ base64: string; mimetype: string }> {
    const resp = await evolutionFetch<any>(
      "POST",
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.instanceName)}`,
      { id: messageId },
      60_000
    );
    return {
      base64: resp?.base64 ?? resp?.media ?? "",
      mimetype: resp?.mimetype ?? "application/octet-stream",
    };
  }

  // =========================================================================
  // Uazapi-only — always throws NotSupportedError
  // =========================================================================

  sendMenu(): Promise<SendResult> {
    throw new NotSupportedError("evolution", "sendMenu");
  }

  sendPixButton(): Promise<SendResult> {
    throw new NotSupportedError("evolution", "sendPixButton");
  }

  react(): Promise<void> {
    throw new NotSupportedError("evolution", "react");
  }

  edit(): Promise<void> {
    throw new NotSupportedError("evolution", "edit");
  }

  pin(): Promise<void> {
    throw new NotSupportedError("evolution", "pin");
  }

  deleteForAll(): Promise<void> {
    throw new NotSupportedError("evolution", "deleteForAll");
  }

  markRead(): Promise<void> {
    throw new NotSupportedError("evolution", "markRead");
  }

  historySync(): Promise<{ messages: unknown[]; nextCursor?: string }> {
    throw new NotSupportedError("evolution", "historySync");
  }
}
