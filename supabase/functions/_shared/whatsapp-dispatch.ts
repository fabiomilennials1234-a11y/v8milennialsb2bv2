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
 * `resolveDispatchContext` PREFERE a instância vinculada ao responsável do lead
 * (instance-write-guard). Mas o vínculo é apenas uma PREFERÊNCIA: quando ele não
 * resolve uma instância usável — lead sem responsável (NO_RESPONSIBLE),
 * responsável sem instância (NO_INSTANCE) ou instância do responsável inativa
 * (INSTANCE_INACTIVE) — o envio NÃO falha; cai para a primeira instância
 * CONECTADA da org (fallback). Só LEAD_NOT_FOUND (o lead nem existe) permanece
 * erro real. Quando a flag está OFF ou `lead_id` é omitido, o comportamento
 * legado é preservado byte-a-byte.
 *
 * Hotfix 2026-06-08: antes o caminho estrito LANÇAVA sem fallback, bloqueando
 * todo disparo de lead sem responsável. Decisão do CTO: disparo sempre possível
 * pela instância conectada da org. Trade-off LGPD em `04 — Decisões`.
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
 *
 * Strict-write flag (Etapa B):
 *   - Quando `lead_id` é informado E feature flag `user_write_instance_strict`
 *     está ON na org, PREFERE a instância via responsible_user_id (RPC
 *     get_lead_write_instance). Falhas "soft" do vínculo (NO_RESPONSIBLE,
 *     NO_INSTANCE, INSTANCE_INACTIVE) caem para a primeira instância CONECTADA
 *     da org — o disparo nunca depende de haver responsável. Só LEAD_NOT_FOUND
 *     propaga como DispatchResolutionError("lead_not_found").
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
  // True quando o vínculo estrito foi tentado mas não rendeu instância usável
  // (soft fail) — sinaliza ao fallback legado que deve exigir CONECTADA.
  let strictFellBack = false;

  // ── Caminho ESTRITO: flag ON e lead_id presente ─────────────────────────
  // O vínculo responsável→instância é PREFERÊNCIA, não gate. Soft fails caem
  // para a instância conectada da org; só LEAD_NOT_FOUND é erro real.
  if (input.lead_id) {
    const strict = await isStrictWriteEnabled(supabaseAdmin, input.organization_id);
    if (strict) {
      const result = await resolveLeadWriteInstance(supabaseAdmin, input.lead_id);
      if (result.ok && result.instance) {
        // Carrega o row completo de whatsapp_instances (provider precisa de tudo)
        const { data: full } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("*")
          .eq("id", result.instance.instanceId)
          .maybeSingle();
        if (full) {
          instance = full as WhatsAppInstance;
        } else {
          // Resolveu mas não carregou → trata como soft, cai pro fallback.
          strictFellBack = true;
          console.warn(
            "[whatsapp-dispatch] strict_write_fallback lead=%s code=NO_INSTANCE_LOAD — usando instância conectada da org",
            input.lead_id,
          );
        }
      } else if (result.errorCode === "LEAD_NOT_FOUND") {
        // Hard: o lead nem existe — propaga.
        throw new DispatchResolutionError(
          mapWriteGuardError(result.errorCode),
          `Strict write failed: ${result.errorCode}`,
        );
      } else {
        // Soft (NO_RESPONSIBLE | NO_INSTANCE | INSTANCE_INACTIVE) → fallback.
        strictFellBack = true;
        console.warn(
          "[whatsapp-dispatch] strict_write_fallback lead=%s code=%s — usando instância conectada da org",
          input.lead_id,
          result.errorCode ?? "unknown",
        );
      }
    }
  }

  // ── Caminho LEGADO / FALLBACK ───────────────────────────────────────────
  // flag OFF, lead_id ausente, OU soft fail do strict-write. No fallback do
  // strict-write forçamos requireConnected (o CTO quer a instância CONECTADA);
  // caso contrário honramos o flag do caller (comportamento legado byte-a-byte).
  if (!instance) {
    instance = await resolveInstance(supabaseAdmin, input.organization_id, {
      preferredInstanceId: input.preferred_instance_id,
      requireConnected: strictFellBack ? true : input.require_connected,
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
  opts: { trackSource?: string; trackId?: string; delay?: number; replyId?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    const res = await provider.sendText({
      number: phone,
      text,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
      delay: opts.delay,
      replyid: opts.replyId,
    });
    return { success: true, messageId: res.message_id };
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
  opts: { trackSource?: string; trackId?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    const res = await provider.sendMedia({
      number: phone,
      type: "ptt",
      file: audioUrl,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
    });
    return { success: true, messageId: res.message_id };
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
  opts: { trackSource?: string; trackId?: string; delay?: number } = {}
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
    const res = await provider.sendMenu({
      number: phone,
      type: menu.type,
      text: menu.text,
      choices: menu.choices,
      footer: menu.footer,
      selectableCount: menu.selectableCount,
      delay: opts.delay,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
    });
    return { success: true, messageId: res.message_id };
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
  opts: { trackSource?: string; trackId?: string; delay?: number } = {}
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
    const res = await provider.sendPixButton({
      number: phone,
      pixkey: pix.pixkey,
      pixkeyType: pix.pixkeyType,
      amount: pix.amount,
      merchantName: pix.merchantName,
      text: pix.text,
      delay: opts.delay,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
    });
    return { success: true, messageId: res.message_id };
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
  opts: { trackSource?: string; trackId?: string } = {}
): Promise<SendResultSimple> {
  const phone = normalizeBrazilianPhone(phoneNumber);
  if (!phone) return { success: false, error: "Invalid phone" };
  try {
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    const res = await provider.sendMedia({
      number: phone,
      type: media.type,
      file: media.file,
      filename: media.filename,
      caption: media.caption,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
    });
    return { success: true, messageId: res.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}
