// deno-lint-ignore-file no-explicit-any
/**
 * dispatch-router — decides between Uazapi /sender/* server-side mass send
 * vs our own dispatcher (scheduled_campaign_messages + per-recipient loop).
 *
 * Strategy (Opção 2 Híbrida approved in Fase 0):
 * - Fluxos IA (Copilot, wait_response, change_stage, audio pool, humanizer)
 *   → nosso dispatcher com /send/text unitário Uazapi
 * - Campanhas massa puras (template estático, N >= threshold, sem ações
 *   encadeadas, sem áudio dinâmico) → /sender/advanced Uazapi server-side
 *
 * Returns a DispatchDecision telling the caller which path to take.
 * Caller is responsible for executing the chosen path (this module is
 * purely a policy engine).
 */

import type { WhatsAppInstance } from "./whatsapp-client.ts";
import { getWhatsAppProvider } from "./whatsapp-client.ts";

const DEFAULT_MASS_THRESHOLD = 50;

export type DispatchJobShape = {
  /** number of distinct recipients in the batch */
  recipients: number;
  /** true if message is a static template (no LLM gen, no humanize) */
  isStaticTemplate: boolean;
  /** true if batch contains chained actions (wait_response, change_stage, etc) */
  hasChainedActions: boolean;
  /** true if batch uses dynamic audio pool or TTS */
  hasDynamicAudio: boolean;
  /** override threshold per-org (falls back to DEFAULT_MASS_THRESHOLD) */
  orgMassThreshold?: number;
};

export type DispatchDecision =
  | {
      route: "uazapi_sender";
      reason: string;
    }
  | {
      route: "custom_dispatcher";
      reason: string;
    };

export function decideDispatchRoute(
  job: DispatchJobShape,
  providerName: "evolution" | "uazapi"
): DispatchDecision {
  // Evolution path never gets /sender/* — fall back to our dispatcher
  if (providerName !== "uazapi") {
    return {
      route: "custom_dispatcher",
      reason: "provider is not uazapi",
    };
  }

  if (job.hasChainedActions) {
    return {
      route: "custom_dispatcher",
      reason: "chained actions require per-step orchestration",
    };
  }

  if (job.hasDynamicAudio) {
    return {
      route: "custom_dispatcher",
      reason: "dynamic audio (TTS / pool) must be resolved per-recipient",
    };
  }

  if (!job.isStaticTemplate) {
    return {
      route: "custom_dispatcher",
      reason: "non-template content (LLM gen / humanizer) requires lazy resolve",
    };
  }

  const threshold = job.orgMassThreshold ?? DEFAULT_MASS_THRESHOLD;
  if (job.recipients < threshold) {
    return {
      route: "custom_dispatcher",
      reason: `recipients=${job.recipients} below mass threshold=${threshold}`,
    };
  }

  return {
    route: "uazapi_sender",
    reason: `static template to ${job.recipients} recipients — eligible for /sender/advanced`,
  };
}

// ============================================================================
// Execution: uazapi_sender route
// Delegates to provider.senderAdvanced and persists a tracking row in
// uazapi_sender_jobs for later status polling.
// ============================================================================

export type UazapiSenderInput = {
  recipients: Array<{ number: string; text?: string; type?: string; file?: string; caption?: string }>;
  delayMin?: number;
  delayMax?: number;
  scheduledFor?: string; // ISO 8601
  campaignId?: string | null;
  triggeredByUserId?: string | null;
  triggeredVia?: "ui" | "api" | "cron" | "workflow";
  trackSource?: string;
};

export async function runUazapiSenderJob(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  input: UazapiSenderInput
): Promise<{ sender_job_id: string; uazapi_sender_id: string }> {
  const provider = await getWhatsAppProvider(instance, supabaseAdmin);
  const impl = (provider as any).senderAdvanced as undefined | ((
    p: Record<string, unknown>
  ) => Promise<{ sender_id: string; total: number }>);

  if (!impl) {
    throw new Error("provider does not support senderAdvanced");
  }

  const res = await impl.call(provider, {
    messages: input.recipients,
    delayMin: input.delayMin,
    delayMax: input.delayMax,
    scheduled_for: input.scheduledFor,
    track_source: input.trackSource ?? "dispatch-router-mass",
  });

  // Persist tracking row
  const { data: row, error } = await supabaseAdmin
    .from("uazapi_sender_jobs")
    .insert({
      organization_id: instance.organization_id,
      instance_id: instance.id,
      campaign_id: input.campaignId ?? null,
      uazapi_sender_id: res.sender_id,
      status: "queued",
      total_messages: res.total ?? input.recipients.length,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      triggered_via: input.triggeredVia ?? "api",
      payload: {
        delayMin: input.delayMin,
        delayMax: input.delayMax,
        scheduledFor: input.scheduledFor,
        trackSource: input.trackSource,
        recipients_count: input.recipients.length,
      },
    })
    .select("id")
    .single();

  if (error || !row) {
    throw new Error(
      `Failed to persist uazapi_sender_jobs row: ${error?.message ?? "unknown"}`
    );
  }

  return { sender_job_id: row.id, uazapi_sender_id: res.sender_id };
}
