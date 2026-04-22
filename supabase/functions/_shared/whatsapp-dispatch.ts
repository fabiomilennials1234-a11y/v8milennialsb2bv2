// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-dispatch — shared helpers consumed by senders/dispatchers.
 *
 * Bridges the org/agent/instance lookup layer into the WhatsAppProvider
 * adapter. Callers (outbound-sender, audio-sender, followup-sender,
 * ai-action-executor, campaign-rule-dispatch, etc.) pass an
 * organization_id + (optional) agent_id and receive a ready provider
 * + normalized phone string.
 *
 * Centralizes:
 * - Instance resolution precedence (agent.whatsapp_instance_id → first
 *   connected instance of the org)
 * - Phone normalization (Brazilian 55 prefix)
 * - Provider factory with error wrapping
 */

import {
  getWhatsAppProvider,
  type WhatsAppInstance,
  type WhatsAppProvider,
} from "./whatsapp-client.ts";

export type ResolveOptions = {
  /** Preferred instance id from agent.whatsapp_instance_id */
  preferredInstanceId?: string | null;
  /** If true, requires status='open' or 'connected'. Default false (tolerant). */
  requireConnected?: boolean;
};

export type ResolvedDispatchContext = {
  provider: WhatsAppProvider;
  instance: WhatsAppInstance;
  /** Normalized phone ready to send (55xx...). */
  normalizedPhone: string;
};

export class DispatchResolutionError extends Error {
  override readonly name = "DispatchResolutionError";
  constructor(
    public readonly code:
      | "missing_phone"
      | "no_instance"
      | "provider_init_failed",
    message: string
  ) {
    super(message);
  }
}

/**
 * Normalize phone to Brazilian format. Adds 55 if missing. Strips non-digits.
 */
export function normalizeBrazilianPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let phone = String(raw).replace(/\D/g, "");
  if (phone.length === 0) return null;
  if (!phone.startsWith("55")) phone = "55" + phone;
  return phone;
}

/**
 * Resolve instance by org, optionally preferring an agent's instance.
 * Returns the canonical WhatsAppInstance row with provider field.
 */
export async function resolveInstance(
  supabaseAdmin: any,
  organizationId: string,
  opts: ResolveOptions = {}
): Promise<WhatsAppInstance | null> {
  // 1) Preferred (e.g. agent.whatsapp_instance_id)
  if (opts.preferredInstanceId) {
    const { data } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", opts.preferredInstanceId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data) return data as WhatsAppInstance;
  }

  // 2) First connected instance of the org
  const query = supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (opts.requireConnected) {
    // status 'open' (Evolution) or 'connected' (Uazapi)
    query.in("status", ["open", "connected"]);
  }

  const { data } = await query.maybeSingle();
  return (data ?? null) as WhatsAppInstance | null;
}

/**
 * Resolve instance + provider + normalized phone in one call.
 * Throws DispatchResolutionError with actionable code on failure.
 */
export async function resolveDispatchContext(
  supabaseAdmin: any,
  input: {
    organization_id: string;
    phone: string | null | undefined;
    preferred_instance_id?: string | null;
    require_connected?: boolean;
  }
): Promise<ResolvedDispatchContext> {
  const normalizedPhone = normalizeBrazilianPhone(input.phone);
  if (!normalizedPhone) {
    throw new DispatchResolutionError("missing_phone", "Lead has no phone");
  }

  const instance = await resolveInstance(supabaseAdmin, input.organization_id, {
    preferredInstanceId: input.preferred_instance_id,
    requireConnected: input.require_connected,
  });

  if (!instance) {
    throw new DispatchResolutionError(
      "no_instance",
      "No WhatsApp instance available for org"
    );
  }

  let provider: WhatsAppProvider;
  try {
    provider = await getWhatsAppProvider(instance, supabaseAdmin);
  } catch (e) {
    throw new DispatchResolutionError(
      "provider_init_failed",
      `Provider init failed: ${(e as Error).message}`
    );
  }

  return { provider, instance, normalizedPhone };
}
