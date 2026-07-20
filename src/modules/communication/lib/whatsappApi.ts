/**
 * whatsappApi — provider-agnostic client for WhatsApp instance operations.
 *
 * Calls the whatsapp-api-proxy edge function (JWT-authenticated, tenant-
 * bounded, rate-limited). The proxy selects the backend (Evolution or
 * Uazapi) based on whatsapp_instances.provider. Tokens never transit via
 * the browser.
 *
 * Replaces the Evolution-only src/lib/evolutionApi.ts which is kept as a
 * deprecated shim during the transition (removed in Fase 7).
 */

import { supabase } from "@/integrations/supabase/client";

type ProxyResponse<T> = {
  ok?: boolean;
  result?: T;
  instance_id?: string;
  error?: string;
};

async function extractFunctionError(error: any): Promise<string> {
  // supabase-js v2 wraps non-2xx responses in FunctionsHttpError; the real
  // payload lives on error.context (a Response). Read it so we surface the
  // edge function's actual error message instead of the generic
  // "non-2xx status code" string.
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    }
    if (ctx && typeof ctx.text === "function") {
      const text = await ctx.text();
      if (text) return text.slice(0, 500);
    }
  } catch {
    // ignore parse errors and fall back to error.message
  }
  return error?.message ?? "Unknown proxy error";
}

async function callProxy<T = unknown>(
  action: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const resolvedBody: Record<string, unknown> = { action, ...body };
  if (!resolvedBody.organization_id) {
    const storedOrg = localStorage.getItem("selected_org_id");
    if (storedOrg) resolvedBody.organization_id = storedOrg;
  }
  const { data, error } = await supabase.functions.invoke<ProxyResponse<T>>(
    "whatsapp-api-proxy",
    { body: resolvedBody }
  );
  if (error) {
    const msg = await extractFunctionError(error);
    throw new Error(`whatsapp-api-proxy: ${msg}`);
  }
  if (!data?.ok) throw new Error(data?.error ?? "Unknown proxy error");
  // createInstance puts instance_id at top level and result inside
  return (data.result ?? (data as unknown as T)) as T;
}

// ============================================================================
// Instance lifecycle
// ============================================================================

export type CreateInstanceResult = {
  provider_instance_id: string;
  provider_token?: string;
  status: InstanceStatus;
};

export type InstanceStatus = {
  connected: boolean;
  state: "connecting" | "connected" | "disconnected" | "unknown";
  qrcode?: string;
  paircode?: string;
  /** Connected account's own number as bare digits. Best-effort from provider. */
  owner?: string;
};

export async function createWhatsAppInstance(
  instanceName: string,
  organizationId?: string
): Promise<{ instance_id: string; result: CreateInstanceResult }> {
  const { data, error } = await supabase.functions.invoke<ProxyResponse<CreateInstanceResult>>(
    "whatsapp-api-proxy",
    {
      body: {
        action: "createInstance",
        organization_id: organizationId,
        payload: { instance_name: instanceName },
      },
    }
  );
  if (error) {
    const msg = await extractFunctionError(error);
    throw new Error(`whatsapp-api-proxy: ${msg}`);
  }
  if (!data?.ok || !data.result || !data.instance_id) {
    throw new Error(data?.error ?? "createInstance returned invalid response");
  }
  return { instance_id: data.instance_id, result: data.result };
}

export async function getInstanceStatus(
  instanceId: string,
  organizationId?: string
): Promise<InstanceStatus> {
  return await callProxy<InstanceStatus>("getStatus", {
    instance_id: instanceId,
    organization_id: organizationId,
  });
}

export async function connectInstanceQR(
  instanceId: string,
  phone?: string,
  organizationId?: string
): Promise<{ qrcode?: string; paircode?: string }> {
  return await callProxy<{ qrcode?: string; paircode?: string }>("connectQR", {
    instance_id: instanceId,
    organization_id: organizationId,
    payload: phone ? { phone } : {},
  });
}

export async function deleteWhatsAppInstance(
  instanceId: string,
  organizationId?: string
): Promise<void> {
  await callProxy("deleteInstance", {
    instance_id: instanceId,
    organization_id: organizationId,
  });
}

export async function logoutWhatsAppInstance(
  instanceId: string,
  organizationId?: string
): Promise<void> {
  await callProxy("logoutInstance", {
    instance_id: instanceId,
    organization_id: organizationId,
  });
}

// ============================================================================
// Message actions — Uazapi-only. Evolution instances return a provider error
// which the caller should surface as a feature-unavailable toast.
// ============================================================================

export async function reactToMessage(
  instanceId: string,
  messageId: string,
  number: string,
  emoji: string
): Promise<void> {
  await callProxy("react", {
    instance_id: instanceId,
    payload: { message_id: messageId, number, emoji },
  });
}

export async function editMessage(
  instanceId: string,
  messageId: string,
  number: string,
  text: string
): Promise<void> {
  await callProxy("editMessage", {
    instance_id: instanceId,
    payload: { message_id: messageId, number, text },
  });
}

export async function pinMessage(
  instanceId: string,
  messageId: string,
  number: string
): Promise<void> {
  await callProxy("pinMessage", {
    instance_id: instanceId,
    payload: { message_id: messageId, number },
  });
}

export async function deleteMessage(
  instanceId: string,
  messageId: string,
  number: string
): Promise<void> {
  await callProxy("deleteMessage", {
    instance_id: instanceId,
    payload: { message_id: messageId, number },
  });
}

export async function markMessageRead(
  instanceId: string,
  messageId: string,
  number: string
): Promise<void> {
  await callProxy("markRead", {
    instance_id: instanceId,
    payload: { message_id: messageId, number },
  });
}

// ============================================================================
// Rich send — Uazapi-only
// ============================================================================

export type MenuChoice = { title: string; description?: string };

export async function sendMenu(
  instanceId: string,
  number: string,
  type: "list" | "button",
  text: string,
  choices: MenuChoice[]
): Promise<{ message_id: string; status: string; timestamp: number }> {
  return callProxy("sendMenu", {
    instance_id: instanceId,
    payload: { number, type, text, choices },
  });
}

export async function sendPixButton(
  instanceId: string,
  number: string,
  pixkey: string,
  merchantName: string,
  amount: number,
  opts?: { pixkeyType?: "cpf" | "cnpj" | "phone" | "email" | "random"; text?: string }
): Promise<{ message_id: string; status: string; timestamp: number }> {
  return callProxy("sendPixButton", {
    instance_id: instanceId,
    payload: { number, pixkey, merchantName, amount, ...opts },
  });
}

// ============================================================================
// Presence, media download, history sync, limits — Uazapi-only
// ============================================================================

export async function setPresence(
  instanceId: string,
  number: string,
  state: "composing" | "available"
): Promise<void> {
  await callProxy("setPresence", {
    instance_id: instanceId,
    payload: { number, state },
  });
}

export async function downloadMedia(
  instanceId: string,
  messageId: string
): Promise<{ base64: string; mimetype: string }> {
  return callProxy("downloadMedia", {
    instance_id: instanceId,
    payload: { message_id: messageId },
  });
}

export async function syncHistory(
  instanceId: string,
  opts?: { chatJid?: string; limit?: number; cursor?: string }
): Promise<{ messages: unknown[]; nextCursor?: string }> {
  return callProxy("historySync", {
    instance_id: instanceId,
    payload: {
      chat_jid: opts?.chatJid,
      limit: opts?.limit,
      cursor: opts?.cursor,
    },
  });
}

export async function getMessageLimits(
  instanceId: string,
  organizationId?: string
): Promise<{ current: number; limit: number; reachout_timelock?: number }> {
  return callProxy("getMessageLimits", {
    instance_id: instanceId,
    organization_id: organizationId,
  });
}
