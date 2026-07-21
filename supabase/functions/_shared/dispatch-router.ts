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
import { governSend, isSkippedSend } from "./send-governor/gate.ts";
import type { GovernorSupabaseClient } from "./send-governor/types.ts";

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
  recipients: Array<{ number: string; type: "text" | "image"; text?: string; file?: string; caption?: string }>;
  delayMin?: number;
  delayMax?: number;
  scheduledFor?: string; // ISO 8601 — converted to epoch ms for Uazapi
  campaignId?: string | null;
  triggeredByUserId?: string | null;
  triggeredVia?: "ui" | "api" | "cron" | "workflow";
  trackSource?: string;
  /** Dispatch provenance (ADR-0016 §3): the Blast Plan + lot that originated this
   *  job. Persisted into the payload jsonb as {plan_id, lot_index} so the
   *  mass-send-status poll can trace a provider folder back to its
   *  blast_plan_recipients. Only the blast-plan paths set these — Quick Blast
   *  avulso / campaign jobs never carry them (payload unchanged). */
  planId?: string;
  lotIndex?: number;
};

/**
 * Uazapi expects `scheduled_for` as epoch milliseconds. Our callers pass an
 * ISO 8601 string (or nothing, for immediate send). Convert here; an undefined
 * or unparseable value resolves to undefined (immediate send).
 */
function toEpochMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Server-side floor for the Uazapi /sender inter-message delay (anti-ban
 *  Onda 0). All /sender/advanced exits converge on runUazapiSenderJob, so a
 *  single clamp here covers Quick Blast, Blast Plan and Mass Send regardless
 *  of what the client sent (stale frontend, direct API, 0/0, omitted). */
export const MIN_SENDER_DELAY_MS = 3_000;

/**
 * Clamp the inter-message delay pair: delayMin ≥ MIN_SENDER_DELAY_MS and
 * delayMax ≥ delayMin. Missing/invalid values (undefined, NaN, negative)
 * resolve to the floor instead of passing through to Uazapi's unknown
 * server-side default.
 */
export function clampSenderDelays(
  delayMin?: number,
  delayMax?: number,
): { delayMin: number; delayMax: number } {
  const rawMin = typeof delayMin === "number" && Number.isFinite(delayMin) ? Math.floor(delayMin) : 0;
  const rawMax = typeof delayMax === "number" && Number.isFinite(delayMax) ? Math.floor(delayMax) : 0;
  const min = Math.max(MIN_SENDER_DELAY_MS, rawMin);
  const max = Math.max(min, rawMax);
  return { delayMin: min, delayMax: max };
}

export async function runUazapiSenderJob(
  supabaseAdmin: any,
  instance: WhatsAppInstance,
  input: UazapiSenderInput
): Promise<{ sender_job_id: string; uazapi_sender_id: string }> {
  const provider = await getWhatsAppProvider(instance, supabaseAdmin);
  const impl = (provider as any).senderAdvanced as undefined | ((
    p: Record<string, unknown>
  ) => Promise<{ folder_id?: string; count?: number; status?: string }>);

  if (!impl) {
    throw new Error("provider does not support senderAdvanced");
  }

  // Effective (clamped) delays — never trust the caller for the floor.
  const { delayMin, delayMax } = clampSenderDelays(input.delayMin, input.delayMax);

  // ── Send Governor P3 reputation gate (category 'mass') ────────────────────
  // Mass only consults the P3 quarantine disjuntor here — volume caps stay owned
  // by the existing blast_* ledgers (do NOT re-implement them). FAIL-OPEN is
  // guaranteed by governSend: any governor error lets the send through, so the
  // governor can never become a single point of failure for a blast. In
  // SHADOW/off (all of PR-0) the effective action is ALWAYS 'allow', so the
  // provider call runs EXACTLY ONCE and its result is returned byte-for-byte;
  // only a future ENFORCE mode can skip a quarantined number. No recipientPhone
  // is passed — a blast fans out to many numbers and the mass path never
  // consults the cold gate (automation-only).
  const governed = await governSend(
    supabaseAdmin as GovernorSupabaseClient,
    {
      orgId: instance.organization_id,
      instanceId: instance.id,
      category: "mass",
      trackSource: input.trackSource,
    },
    () =>
      impl.call(provider, {
        messages: input.recipients,
        delayMin,
        delayMax,
        scheduled_for: toEpochMs(input.scheduledFor),
        track_source: input.trackSource ?? "dispatch-router-mass",
      }),
  );

  // Forward-safe narrowing. Unreachable in SHADOW/off (the send always runs);
  // under a future ENFORCE mode a quarantined instance would skip the send —
  // fail loud rather than persist an unpollable "queued" row that never had any
  // messages accepted (mirrors the fail-loud contract below).
  if (isSkippedSend(governed)) {
    throw new Error(
      `governor_blocked_mass_send: instance ${instance.id} ${governed.action} (${governed.reason})`,
    );
  }
  const res = governed;

  // CREATE contract (verified live 2026-06-15): { folder_id, count, status }.
  // `folder_id` is the campaign id (persisted as uazapi_sender_id); `count` is
  // the number of messages Uazapi ACCEPTED. Fail loud rather than persist an
  // unpollable row: a missing folder_id or count===0 means nothing went out
  // (e.g. items dispatched without `type`) — surface it instead of leaving the
  // job stuck in "queued" forever.
  const folderId = res?.folder_id;
  const count = typeof res?.count === "number" ? res.count : undefined;
  if (!folderId || count === 0) {
    throw new Error(
      `uazapi_no_messages_accepted: Uazapi accepted ${count ?? 0} messages (folder_id=${folderId ?? "missing"})`
    );
  }

  const totalMessages = count ?? input.recipients.length;

  // Persist tracking row
  const { data: row, error } = await supabaseAdmin
    .from("uazapi_sender_jobs")
    .insert({
      organization_id: instance.organization_id,
      instance_id: instance.id,
      campaign_id: input.campaignId ?? null,
      uazapi_sender_id: folderId,
      status: "queued",
      total_messages: totalMessages,
      triggered_by_user_id: input.triggeredByUserId ?? null,
      triggered_via: input.triggeredVia ?? "api",
      payload: {
        // Effective values sent to Uazapi (post-clamp), not the raw client input.
        delayMin,
        delayMax,
        scheduledFor: input.scheduledFor,
        trackSource: input.trackSource,
        recipients_count: input.recipients.length,
        // Dispatch provenance (ADR-0016 §3) — blast-plan origin only. `!= null`
        // (not truthiness): lot_index 0 is the creation lot and must persist.
        ...(input.planId != null
          ? { plan_id: input.planId, lot_index: input.lotIndex }
          : {}),
      },
    })
    .select("id")
    .single();

  if (error || !row) {
    throw new Error(
      `Failed to persist uazapi_sender_jobs row: ${error?.message ?? "unknown"}`
    );
  }

  return { sender_job_id: row.id, uazapi_sender_id: folderId };
}
