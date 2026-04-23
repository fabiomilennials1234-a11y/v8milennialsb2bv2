// deno-lint-ignore-file no-explicit-any
/**
 * EvolutionProvider — legacy WhatsApp provider restored for Sprint 3
 * migration flow (kill-switch fallback).
 *
 * Only implemented methods cover the path required during Evolution→Uazapi
 * migration rollback:
 *  - createInstance, getStatus, connectQR, deleteInstance, logoutInstance
 *  - sendText, sendMedia, setPresence, downloadMedia
 *
 * Uazapi-only methods (sendMenu, sendPixButton, react/edit/pin/delete/
 * markRead, historySync) throw NotSupportedError — caller must detect
 * via isFeatureUnavailable helper and toast.
 *
 * Deleted in Fase 7, reinstated minimally in Sprint 3 per approved
 * panic-button policy.
 */

import {
  NotSupportedError,
  type WhatsAppInstance,
  type WhatsAppProvider,
  type SendTextOptions,
  type SendMediaOptions,
  type SendResult,
  type InstanceStatus,
  type CreateInstanceInput,
  type CreateInstanceResult,
} from "../whatsapp-client.ts";

function resolveEvolutionUrl(): string {
  const url = (Deno as any).env.get("EVOLUTION_API_URL");
  if (!url) throw new Error("EVOLUTION_API_URL env not set");
  return url.replace(/\/$/, "");
}

function resolveEvolutionKey(): string {
  const key = (Deno as any).env.get("EVOLUTION_API_KEY");
  if (!key) throw new Error("EVOLUTION_API_KEY env not set");
  return key;
}

async function evolutionRequest<T>(
  path: string,
  opts: { method: "GET" | "POST" | "DELETE"; body?: unknown }
): Promise<T> {
  const url = `${resolveEvolutionUrl()}${path}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      apikey: resolveEvolutionKey(),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Evolution ${opts.method} ${path} HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export class EvolutionProvider implements WhatsAppProvider {
  readonly provider = "evolution" as const;
  private instanceName: string;

  constructor(instance: WhatsAppInstance) {
    this.instanceName = instance.instance_name;
  }

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceResult> {
    const resp = await evolutionRequest<{ instance?: { instanceName?: string }; qrcode?: { base64?: string; code?: string } }>(
      `/instance/create`,
      {
        method: "POST",
        body: {
          instanceName: input.instance_name,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
        },
      }
    );
    const status: InstanceStatus = {
      connected: false,
      state: "connecting",
      qrcode: resp.qrcode?.base64 ?? resp.qrcode?.code,
    };
    return {
      provider_instance_id: resp.instance?.instanceName ?? input.instance_name,
      status,
    };
  }

  async getStatus(): Promise<InstanceStatus> {
    const resp = await evolutionRequest<{ instance?: { state?: string } }>(
      `/instance/connectionState/${encodeURIComponent(this.instanceName)}`,
      { method: "GET" }
    );
    const state = resp.instance?.state ?? "unknown";
    return {
      connected: state === "open",
      state: state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected",
    };
  }

  async connectQR(): Promise<{ qrcode?: string; paircode?: string }> {
    const resp = await evolutionRequest<{ base64?: string; code?: string }>(
      `/instance/connect/${encodeURIComponent(this.instanceName)}`,
      { method: "GET" }
    );
    return { qrcode: resp.base64 ?? resp.code };
  }

  async deleteInstance(): Promise<void> {
    await evolutionRequest(`/instance/delete/${encodeURIComponent(this.instanceName)}`, {
      method: "DELETE",
    });
  }

  async logoutInstance(): Promise<void> {
    await evolutionRequest(`/instance/logout/${encodeURIComponent(this.instanceName)}`, {
      method: "DELETE",
    });
  }

  async sendText(opts: SendTextOptions): Promise<SendResult> {
    const resp = await evolutionRequest<{ key?: { id?: string } }>(
      `/message/sendText/${encodeURIComponent(this.instanceName)}`,
      {
        method: "POST",
        body: { number: opts.number, text: opts.text },
      }
    );
    return {
      message_id: resp.key?.id ?? `ev_${crypto.randomUUID()}`,
      status: "sent",
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async sendMedia(opts: SendMediaOptions): Promise<SendResult> {
    const body: Record<string, unknown> = {
      number: opts.number,
      mediatype: opts.type === "ptt" ? "audio" : opts.type,
      media: opts.file,
    };
    if (opts.caption) body.caption = opts.caption;
    if (opts.filename) body.fileName = opts.filename;

    // PTT vai via endpoint dedicado
    const path =
      opts.type === "ptt"
        ? `/message/sendWhatsAppAudio/${encodeURIComponent(this.instanceName)}`
        : `/message/sendMedia/${encodeURIComponent(this.instanceName)}`;

    if (opts.type === "ptt") {
      body.audio = opts.file;
      delete body.media;
      delete body.mediatype;
    }

    const resp = await evolutionRequest<{ key?: { id?: string } }>(path, {
      method: "POST",
      body,
    });
    return {
      message_id: resp.key?.id ?? `ev_${crypto.randomUUID()}`,
      status: "sent",
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async setPresence(number: string, state: "composing" | "available"): Promise<void> {
    await evolutionRequest(
      `/chat/sendPresence/${encodeURIComponent(this.instanceName)}`,
      {
        method: "POST",
        body: { number, delay: 500, presence: state },
      }
    );
  }

  async downloadMedia(messageId: string): Promise<{ base64: string; mimetype: string }> {
    const resp = await evolutionRequest<{ base64?: string; mimetype?: string }>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.instanceName)}`,
      { method: "POST", body: { message: { id: messageId } } }
    );
    return { base64: resp.base64 ?? "", mimetype: resp.mimetype ?? "application/octet-stream" };
  }

  // Uazapi-only methods — throw NotSupportedError
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
