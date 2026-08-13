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
 *
 * ─── Bifurcação por flag user_write_instance_strict (Etapa B) ───────────────
 * Quando o caller informa `lead_id` E a flag está ATIVA na organização,
 * `resolveDispatchContext` resolve a instância via instance-write-guard
 * (vínculo responsável→instância). Em caso de erro propaga
 * `DispatchResolutionError` com code `lead_no_instance` etc — NÃO faz fallback
 * para a primeira instância da org. Quando a flag está OFF ou `lead_id` é
 * omitido, o comportamento legado é preservado byte-a-byte.
 */

import {
  getWhatsAppProvider,
  type WhatsAppInstance,
  type WhatsAppProvider,
} from "./whatsapp-client.ts";
import {
  isStrictWriteEnabled,
  resolveLeadWriteInstance,
  type WriteInstanceErrorCode,
} from "./instance-write-guard.ts";
import { governSend, isSkippedSend } from "./send-governor/gate.ts";
import { deriveCategory } from "./send-governor/core.ts";

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

export type DispatchResolutionErrorCode =
  | "missing_phone"
  | "no_instance"
  | "provider_init_failed"
  // Strict-write outcomes (flag user_write_instance_strict ON)
  | "lead_not_found"
  | "lead_no_responsible"
  | "lead_no_instance"
  | "lead_instance_inactive";

export class DispatchResolutionError extends Error {
  override readonly name = "DispatchResolutionError";
  constructor(
    public readonly code: DispatchResolutionErrorCode,
    message: string
  ) {
    super(message);
  }
}

/**
 * Mapeia error_code do instance-write-guard para code do DispatchResolutionError.
 * Mantido como função local para preservar contrato público.
 */
function mapWriteGuardError(
  code: WriteInstanceErrorCode | undefined,
): DispatchResolutionErrorCode {
  switch (code) {
    case "LEAD_NOT_FOUND":
      return "lead_not_found";
    case "NO_RESPONSIBLE":
      return "lead_no_responsible";
    case "NO_INSTANCE":
      return "lead_no_instance";
    case "INSTANCE_INACTIVE":
      return "lead_instance_inactive";
    default:
      return "no_instance";
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

  // 2) First connected instance of the org.
  //
  // Provider-scoped (Meta Cloud isolation, Rule 1): this provider-BLIND
  // fallback feeds legacy auto-dispatch (copilot/follow-up/campaign/pipe). A
  // Meta Cloud number is gated by Meta's 24h window + templates and must NEVER
  // be picked here, or a free-form Uazapi-intended reply mis-routes through the
  // Meta API. meta_cloud instances are reachable only via an explicit
  // preferredInstanceId (step 1) or the strict-write binding. Filtering to the
  // legacy providers is a no-op for current orgs (all uazapi/evolution).
  const query = supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .in("provider", ["uazapi", "evolution"])
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
 * selectSendableInstance — org-wide pick for automation senders that used a
 * bare `status IN (open, connected) LIMIT 1`, which can grab a ZOMBIE: a row
 * whose status froze at 'connected' after a remote logout (session_dead_since
 * is the real verdict, stamped by whatsapp-session-watchdog).
 *
 * PREFER-LIVE-WITH-FALLBACK (anti-ban Onda 0 QW5) — chat-safety contract:
 *   1. Prefer a live session: not session-dead, most recently connected.
 *      Provider-scoped to uazapi/evolution (Meta Cloud isolation, Rule 1 —
 *      same rationale as resolveInstance above): a meta_cloud row is always
 *      "live" here (the watchdog only audits uazapi rows) and would otherwise
 *      deterministically win the recency ordering, mis-routing free-form
 *      copilot replies through the Meta API.
 *   2. FALLBACK: the legacy query, MINUS one predicate only — it drops the
 *      liveness filter (session_dead_since can be a stale false-positive of the
 *      10-min watchdog cycle, and a hard filter would silence the copilot) but
 *      KEEPS the provider allowlist. It relaxes liveness, never provider. This
 *      NEVER returns null where a LEGACY-PROVIDER row existed.
 *
 * PROVIDER ALLOWLIST, NOT A DENYLIST — both queries are scoped to
 * ['uazapi','evolution']. This function hands its row to `getWhatsAppProvider`,
 * which assumes a session-based chip; every non-legacy provider (meta_cloud
 * today, notificame next) is template/window-gated and must never receive a
 * free-form automation message picked here. An allowlist makes the 5th provider
 * born excluded — a denylist of the known names would leave the hole open.
 * The only caller, copilot-batch-processor, already treats null as the
 * retryable `no_active_instance`, so the fail-closed exit path exists.
 */
export async function selectSendableInstance(
  supabaseAdmin: any,
  organizationId: string,
): Promise<WhatsAppInstance | null> {
  const { data: live } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .in("provider", ["uazapi", "evolution"])
    .in("status", ["open", "connected"])
    .is("session_dead_since", null)
    .order("last_connection_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (live) return live as WhatsAppInstance;

  // Liveness fallback — the legacy selection minus the session_dead_since
  // filter. The provider allowlist stays (see the contract above).
  const { data: fallback } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("organization_id", organizationId)
    .in("provider", ["uazapi", "evolution"])
    .in("status", ["open", "connected"])
    .limit(1)
    .maybeSingle();
  return (fallback ?? null) as WhatsAppInstance | null;
}

/**
 * Resolve instance + provider + normalized phone in one call.
 * Throws DispatchResolutionError with actionable code on failure.
 *
 * Strict-write flag (Etapa B):
 *   - Quando `lead_id` é informado E feature flag `user_write_instance_strict`
 *     está ON na org, resolve a instância via responsible_user_id (RPC
 *     get_lead_write_instance). Erros NÃO caem para a primeira instância da
 *     org; propagam como DispatchResolutionError com code específico.
 *   - Quando flag OFF ou `lead_id` ausente, comportamento legado: precedência
 *     `preferred_instance_id` → primeira instância da org (filtro
 *     status=open|connected quando require_connected=true).
 */
export async function resolveDispatchContext(
  supabaseAdmin: any,
  input: {
    organization_id: string;
    phone: string | null | undefined;
    preferred_instance_id?: string | null;
    require_connected?: boolean;
    /**
     * Optional. Quando informado E a flag user_write_instance_strict está ON
     * na org, força resolução pelo vínculo responsável→instância. Caller
     * propaga o lead_id sempre que conhecido — ignorado de forma transparente
     * quando flag OFF.
     */
    lead_id?: string | null;
  }
): Promise<ResolvedDispatchContext> {
  const normalizedPhone = normalizeBrazilianPhone(input.phone);
  if (!normalizedPhone) {
    throw new DispatchResolutionError("missing_phone", "Lead has no phone");
  }

  let instance: WhatsAppInstance | null = null;

  // ── Caminho ESTRITO: flag ON e lead_id presente ─────────────────────────
  if (input.lead_id) {
    const strict = await isStrictWriteEnabled(supabaseAdmin, input.organization_id);
    if (strict) {
      const result = await resolveLeadWriteInstance(supabaseAdmin, input.lead_id);
      if (!result.ok || !result.instance) {
        throw new DispatchResolutionError(
          mapWriteGuardError(result.errorCode),
          `Strict write failed: ${result.errorCode ?? "unknown"}`,
        );
      }
      // Carrega o row completo de whatsapp_instances (provider precisa de tudo)
      const { data: full } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("*")
        .eq("id", result.instance.instanceId)
        .maybeSingle();
      if (!full) {
        throw new DispatchResolutionError(
          "lead_no_instance",
          "Strict write resolved instance not loadable",
        );
      }
      instance = full as WhatsAppInstance;
    }
  }

  // ── Caminho LEGADO: flag OFF ou lead_id ausente ─────────────────────────
  if (!instance) {
    instance = await resolveInstance(supabaseAdmin, input.organization_id, {
      preferredInstanceId: input.preferred_instance_id,
      requireConnected: input.require_connected,
    });
  }

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

// ============================================================================
// Convenience send helpers — consumed by legacy dispatchers
// (pipe-rule-dispatch, campaign-rule-dispatch, semi-automatic-dispatch)
// Wrap provider calls and normalize phone so call sites don't duplicate.
// ============================================================================

export type SendResultSimple = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export async function sendTextViaInstance(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  phoneNumber: string,
  text: string,
  opts: { trackSource?: string; trackId?: string; delay?: number; replyId?: string; idempotencyKey?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    // Send Governor (SHADOW seam). doSend runs exactly once; in shadow/off it
    // ALWAYS runs and `governed` is exactly the provider response (shape byte-
    // for-byte preserved). isSkippedSend is dormant here (only enforce skips).
    // content/idempotencyKey alimentam o dedup conversacional DENTRO do governSend (#1156).
    const governed = await governSend(
      supabaseAdmin,
      {
        orgId: instance.organization_id,
        instanceId: instance.id,
        category: deriveCategory(opts.trackSource),
        recipientPhone: phone,
        trackSource: opts.trackSource,
        content: text,
        idempotencyKey: opts.idempotencyKey,
      },
      () =>
        provider.sendText({
          number: phone,
          text,
          trackSource: opts.trackSource,
          trackId: opts.trackId,
          delay: opts.delay,
          replyid: opts.replyId,
        }),
    );
    if (isSkippedSend(governed)) {
      return { success: false, error: `governor_${governed.action}:${governed.reason}` };
    }
    return { success: true, messageId: governed.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}

export async function sendAudioViaInstance(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  phoneNumber: string,
  audioUrl: string,
  opts: { trackSource?: string; trackId?: string; idempotencyKey?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    // Send Governor (SHADOW seam) — see sendTextViaInstance for the contract.
    const governed = await governSend(
      supabaseAdmin,
      {
        orgId: instance.organization_id,
        instanceId: instance.id,
        category: deriveCategory(opts.trackSource),
        recipientPhone: phone,
        trackSource: opts.trackSource,
        content: audioUrl,
        idempotencyKey: opts.idempotencyKey,
      },
      () =>
        provider.sendMedia({
          number: phone,
          type: "ptt",
          file: audioUrl,
          trackSource: opts.trackSource,
          trackId: opts.trackId,
        }),
    );
    if (isSkippedSend(governed)) {
      return { success: false, error: `governor_${governed.action}:${governed.reason}` };
    }
    return { success: true, messageId: governed.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}

export async function sendMenuViaInstance(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  phoneNumber: string,
  menu: {
    type: "button" | "list" | "poll" | "carousel";
    text: string;
    choices: string[];
    footer?: string;
    selectableCount?: number;
  },
  opts: { trackSource?: string; trackId?: string; delay?: number; idempotencyKey?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    if (!provider.sendMenu) {
      return {
        success: false,
        error: `${provider.provider} does not support interactive menus`,
      };
    }
    // Send Governor (SHADOW seam) — see sendTextViaInstance for the contract.
    const sendMenu = provider.sendMenu.bind(provider);
    const governed = await governSend(
      supabaseAdmin,
      {
        orgId: instance.organization_id,
        instanceId: instance.id,
        category: deriveCategory(opts.trackSource),
        recipientPhone: phone,
        trackSource: opts.trackSource,
        content: menu.text,
        idempotencyKey: opts.idempotencyKey,
      },
      () =>
        sendMenu({
          number: phone,
          type: menu.type,
          text: menu.text,
          choices: menu.choices,
          footer: menu.footer,
          selectableCount: menu.selectableCount,
          delay: opts.delay,
          trackSource: opts.trackSource,
          trackId: opts.trackId,
        }),
    );
    if (isSkippedSend(governed)) {
      return { success: false, error: `governor_${governed.action}:${governed.reason}` };
    }
    return { success: true, messageId: governed.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}

export async function sendPixButtonViaInstance(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  phoneNumber: string,
  pix: {
    pixkey: string;
    pixkeyType: "cpf" | "cnpj" | "email" | "phone" | "random";
    amount: number;
    merchantName: string;
    text?: string;
  },
  opts: { trackSource?: string; trackId?: string; delay?: number; idempotencyKey?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    if (!provider.sendPixButton) {
      return {
        success: false,
        error: `${provider.provider} does not support PIX button`,
      };
    }
    // Send Governor (SHADOW seam) — see sendTextViaInstance for the contract.
    const sendPixButton = provider.sendPixButton.bind(provider);
    const governed = await governSend(
      supabaseAdmin,
      {
        orgId: instance.organization_id,
        instanceId: instance.id,
        category: deriveCategory(opts.trackSource),
        recipientPhone: phone,
        trackSource: opts.trackSource,
        content: pix.text ?? "",
        idempotencyKey: opts.idempotencyKey,
      },
      () =>
        sendPixButton({
          number: phone,
          pixkey: pix.pixkey,
          pixkeyType: pix.pixkeyType,
          amount: pix.amount,
          merchantName: pix.merchantName,
          text: pix.text,
          delay: opts.delay,
          trackSource: opts.trackSource,
          trackId: opts.trackId,
        }),
    );
    if (isSkippedSend(governed)) {
      return { success: false, error: `governor_${governed.action}:${governed.reason}` };
    }
    return { success: true, messageId: governed.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}

export async function sendMediaViaInstance(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  phoneNumber: string,
  media: {
    type: "image" | "video" | "document" | "audio" | "sticker";
    file: string;
    filename?: string;
    caption?: string;
  },
  opts: { trackSource?: string; trackId?: string; idempotencyKey?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    // Send Governor (SHADOW seam) — see sendTextViaInstance for the contract.
    const governed = await governSend(
      supabaseAdmin,
      {
        orgId: instance.organization_id,
        instanceId: instance.id,
        category: deriveCategory(opts.trackSource),
        recipientPhone: phone,
        trackSource: opts.trackSource,
        content: media.caption && media.caption.trim().length > 0 ? media.caption : media.file,
        idempotencyKey: opts.idempotencyKey,
      },
      () =>
        provider.sendMedia({
          number: phone,
          type: media.type,
          file: media.file,
          filename: media.filename,
          caption: media.caption,
          trackSource: opts.trackSource,
          trackId: opts.trackId,
        }),
    );
    if (isSkippedSend(governed)) {
      return { success: false, error: `governor_${governed.action}:${governed.reason}` };
    }
    return { success: true, messageId: governed.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}
