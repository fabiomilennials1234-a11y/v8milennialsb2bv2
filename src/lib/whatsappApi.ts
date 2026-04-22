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

async function callProxy<T = unknown>(
  action: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<ProxyResponse<T>>(
    "whatsapp-api-proxy",
    { body: { action, ...body } }
  );
  if (error) throw new Error(`whatsapp-api-proxy: ${error.message}`);
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
};

export async function createWhatsAppInstance(
  instanceName: string
): Promise<{ instance_id: string; result: CreateInstanceResult }> {
  const { data, error } = await supabase.functions.invoke<ProxyResponse<CreateInstanceResult>>(
    "whatsapp-api-proxy",
    { body: { action: "createInstance", payload: { instance_name: instanceName } } }
  );
  if (error) throw new Error(`whatsapp-api-proxy: ${error.message}`);
  if (!data?.ok || !data.result || !data.instance_id) {
    throw new Error(data?.error ?? "createInstance returned invalid response");
  }
  return { instance_id: data.instance_id, result: data.result };
}

export async function getInstanceStatus(instanceId: string): Promise<InstanceStatus> {
  return await callProxy<InstanceStatus>("getStatus", { instance_id: instanceId });
}

export async function connectInstanceQR(
  instanceId: string,
  phone?: string
): Promise<{ qrcode?: string; paircode?: string }> {
  return await callProxy<{ qrcode?: string; paircode?: string }>("connectQR", {
    instance_id: instanceId,
    payload: phone ? { phone } : {},
  });
}

export async function deleteWhatsAppInstance(instanceId: string): Promise<void> {
  await callProxy("deleteInstance", { instance_id: instanceId });
}

export async function logoutWhatsAppInstance(instanceId: string): Promise<void> {
  await callProxy("logoutInstance", { instance_id: instanceId });
}
