import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { UazapiClient } from "./uazapi-client.ts";
import { assertLegacyWebhookWriteAllowed } from "./uazapi-ingress-write-guard.ts";

export const UAZAPI_WEBHOOK_EVENTS = ["messages", "messages_update", "connection"];

export function normalizeWebhook(raw: unknown) {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const wrapped = obj.webhook ?? obj.value ?? obj.data ?? obj;
  // More than one endpoint is ambiguous; never verify the first entry as the whole policy.
  const node = Array.isArray(wrapped) ? (wrapped.length === 1 ? wrapped[0] : {}) : wrapped;
  const data = node && typeof node === "object" ? node as Record<string, unknown> : {};
  const strings = (value: unknown): string[] | null => Array.isArray(value) && value.every(v => typeof v === "string") ? value : null;
  return {
    url: typeof data.url === "string" && data.url.trim() ? data.url : null,
    enabled: typeof data.enabled === "boolean" ? data.enabled : null,
    events: strings(data.events),
    excludeMessages: strings(data.excludeMessages),
    addUrlEvents: typeof data.addUrlEvents === "boolean" ? data.addUrlEvents : null,
    addUrlTypesMessages: typeof data.addUrlTypesMessages === "boolean" ? data.addUrlTypesMessages : null,
    raw,
  };
}

function sameSet(actual: string[] | null, expected: string[]) {
  return actual !== null && actual.length === expected.length && new Set(actual).size === expected.length && expected.every(v => actual.includes(v));
}

/** All managed writers share one lease, including creation and flag-off removal. */
export async function configureUazapiWebhook(
  client: Pick<UazapiClient, "updateWebhook" | "getWebhook">,
  admin: SupabaseClient,
  instanceId: string,
  organizationId: string,
  url: string,
) {
  assertLegacyWebhookWriteAllowed(instanceId);
  const { data: intent, error } = await admin.rpc("prepare_uazapi_group_webhook", {
    p_instance_id: instanceId,
    p_organization_id: organizationId,
    p_filter_enabled: Deno.env.get("UAZAPI_GROUP_SOURCE_FILTER_ENABLED") === "true",
  });
  if (error) throw new Error("Unable to reserve webhook policy reconciliation");
  const exclusions = intent?.exclude_groups === true ? ["wasSentByApi", "isGroupYes"] : ["wasSentByApi"];
  // An uncertain write intentionally retains its lease. Do not automatically retry/release it.
  await client.updateWebhook({ url, enabled: true, events: UAZAPI_WEBHOOK_EVENTS, excludeMessages: exclusions, addUrlEvents: true, addUrlTypesMessages: false }, { noRetry: !!intent });
  if (!intent) return; // Legacy flag-off policy, unchanged provider readback requirements.
  const readback = normalizeWebhook(await client.getWebhook());
  if (readback.url !== url || readback.enabled !== true || !sameSet(readback.events, UAZAPI_WEBHOOK_EVENTS)
    || !sameSet(readback.excludeMessages, exclusions) || readback.addUrlEvents !== true || readback.addUrlTypesMessages !== false) {
    throw new Error("Webhook policy readback is inconclusive; reconciliation remains locked");
  }
  const { error: finishError } = await admin.rpc("finish_uazapi_group_webhook", {
    p_instance_id: instanceId, p_organization_id: organizationId,
    p_token: intent.token, p_revision: intent.revision, p_excluded: intent.exclude_groups === true,
  });
  if (finishError) throw new Error("Webhook policy confirmation failed; reconciliation remains uncertain");
}

/** Caller identity and resolved tenant must come from the authenticated endpoint. */
export async function requestGroupCapture(
  admin: SupabaseClient, userId: string, organizationId: string, isMaster: boolean, capture: unknown,
) {
  if (typeof capture !== "boolean") return { status: 400, error: "capture_groups must be boolean" };
  if (!isMaster) {
    const { data, error } = await admin.from("team_members").select("id")
      .eq("organization_id", organizationId).eq("user_id", userId).eq("is_active", true).eq("role", "admin").maybeSingle();
    if (error || !data) return { status: 403, error: "Organization admin required" };
  }
  const { data, error } = await admin.rpc("request_uazapi_group_capture", { p_organization_id: organizationId, p_capture: capture });
  if (error) return { status: 409, error: "Reconciliation is busy or uncertain; inspect existing operation" };
  return { status: data?.reconciliation_required === false ? 200 : 202, desired_capture: capture, reconciliation_required: data?.reconciliation_required !== false };
}
