/**
 * Workflow Trigger — central module for firing workflow triggers from Edge Functions
 *
 * Used by edge functions that need to fire triggers not handled by PG triggers:
 * - lead_replied (from agent-message)
 * - lead_no_reply (from pg_cron check)
 * - meeting_not_confirmed (from pg_cron check)
 * - followup_overdue (from pg_cron check)
 * - webhook_received (from process-webhook-deliveries)
 * - cron (from process-workflow-executions cron_triggers mode)
 * - stage_changed (migrated from frontend)
 *
 * PG triggers handle: lead_created, tag_added, score_reached, lead_assigned,
 * field_changed, meeting_confirmed, proposal_accepted, proposal_lost,
 * campaign_status_changed
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeTriggerDedupKey } from "./workflow-trigger-dedup.ts";

interface FireTriggerParams {
  supabase: SupabaseClient;
  organizationId: string;
  triggerType: string;
  leadId: string;
  context?: Record<string, unknown>;
  source?: string;
}

/**
 * Finds active workflows matching the trigger type, validates trigger_config,
 * and creates workflow_execution records.
 *
 * Returns the number of executions created.
 */
export async function fireTrigger(params: FireTriggerParams): Promise<number> {
  const { supabase, organizationId, triggerType, leadId, context, source } = params;

  try {
    const selectFields = source === "copilot" ? "id, trigger_config, definition" : "id, trigger_config";
    const { data: workflows, error } = await supabase
      .from("workflows")
      .select(selectFields)
      .eq("organization_id", organizationId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true);

    if (error || !workflows?.length) return 0;

    // Filter by trigger_config match
    let matching = workflows.filter((w: { id: string; trigger_config: Record<string, unknown> }) =>
      matchesTriggerConfig(triggerType, w.trigger_config, context || {}),
    );

    // Origin guard: skip workflows with copilot nodes when triggered by copilot
    if (source === "copilot" && matching.length > 0) {
      const before = matching.length;
      matching = matching.filter((w: Record<string, unknown>) => !workflowHasCopilotNode(w.definition as { nodes: { type: string }[] } | null));
      if (matching.length < before) {
        console.log(`[workflow-trigger] Origin guard: skipped ${before - matching.length} copilot-containing workflows (source=copilot)`);
      }
    }

    if (matching.length === 0) return 0;

    // ── Dedup / Auto-cancel ──
    const matchingIds = matching.map((w: { id: string }) => w.id);
    const { data: activeExecs } = await supabase
      .from("workflow_executions")
      .select("id, workflow_id")
      .eq("lead_id", leadId)
      .in("workflow_id", matchingIds)
      .in("status", ["running", "processing", "waiting_response", "paused"]);

    // ── Dedup: SKIP workflows that already have an in-flight execution for this
    // lead. Applies to ALL trigger types, including stage_changed.
    //
    // stage_changed previously CANCELLED the active execution and started a fresh
    // one from the trigger node — which re-ran every send node, re-dispatching the
    // whole flow (text + audio + image) on each re-entry into the triggering stage.
    // A user re-dropping a lead into a "disparo" column (or the workflow's own
    // stage moves) therefore blasted the lead 7-12× (incident 2026-07-03, Motor 100).
    //
    // `activeExecs` is already filtered to `matchingIds` — i.e. executions of the
    // very workflows about to fire — so an active exec here is always the SAME
    // workflow re-triggering. Cancel-and-restart never protected a distinct flow;
    // skipping is strictly safer. If a genuine re-dispatch is wanted, the prior
    // execution must reach a terminal state first.
    const activeWorkflowIds = new Set((activeExecs ?? []).map((e: { workflow_id: string }) => e.workflow_id));
    const deduped = matching.filter((w: { id: string }) => !activeWorkflowIds.has(w.id));

    if (deduped.length === 0) {
      console.log(`[workflow-trigger] All ${matching.length} workflows already active for lead ${leadId}, skipping (no re-dispatch)`);
      return 0;
    }

    if (deduped.length < matching.length) {
      console.log(`[workflow-trigger] Dedup: ${matching.length - deduped.length} workflows already active for lead ${leadId}, firing ${deduped.length}`);
    }

    // Atomic dedup key (closes the check-then-insert race the skip above cannot):
    // N near-simultaneous stage_changed events for the same lead compute the SAME
    // key within the window bucket, so the partial-window unique index
    // (workflow_id, lead_id, trigger_dedup_key) lets only the first insert win.
    // stage_changed uses a 300s window (re-dispatching the same lead within 5min is
    // never intended); other triggers use 60s. leadId-less triggers get a null key
    // (never deduped) — distinct NULLs, so they always insert.
    const dedupWindowSeconds = triggerType === "stage_changed" ? 300 : 60;
    const now = new Date();
    const executions = await Promise.all(
      deduped.map(async (w: { id: string }) => ({
        workflow_id: w.id,
        organization_id: organizationId,
        lead_id: leadId,
        status: "running",
        context: { trigger_type: triggerType, ...(context || {}) },
        trigger_dedup_key: leadId
          ? await computeTriggerDedupKey({
              triggerType,
              payload: context || {},
              now,
              windowSeconds: dedupWindowSeconds,
            })
          : null,
      })),
    );

    // ON CONFLICT DO NOTHING (ignoreDuplicates) → concurrent identical fires that
    // computed the same key collapse to a single row at the DB. The returned count
    // is the ATTEMPTED count; the unique index is the actual guarantee.
    const { error: insertError } = await supabase
      .from("workflow_executions")
      .upsert(executions, {
        onConflict: "workflow_id,lead_id,trigger_dedup_key",
        ignoreDuplicates: true,
      });

    if (insertError) {
      console.warn("[workflow-trigger] Insert failed:", insertError.message);
      return 0;
    }

    console.log(`[workflow-trigger] Fired ${deduped.length} workflows for ${triggerType} (dedup-keyed)`);
    return deduped.length;
  } catch (err) {
    console.warn("[workflow-trigger] Error:", err);
    return 0;
  }
}

/**
 * Validates that the trigger context matches the workflow's trigger_config.
 */
export function matchesTriggerConfig(
  triggerType: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  switch (triggerType) {
    case "stage_changed": {
      if (config.pipe_type && context.pipe_type && config.pipe_type !== context.pipe_type) return false;
      if (config.pipeline_id && context.pipeline_id && config.pipeline_id !== context.pipeline_id) return false;
      if (config.campanha_id && context.campanha_id && config.campanha_id !== context.campanha_id) return false;
      if (config.from_stage && context.from_stage && config.from_stage !== context.from_stage) return false;
      const stages = config.stages as string[] | undefined;
      const toStage = context.to_stage as string;
      if (stages && stages.length > 0 && toStage) {
        if (!stages.includes(toStage)) return false;
      } else if (config.to_stage && toStage) {
        if (config.to_stage !== toStage) return false;
      }
      return true;
    }

    case "lead_created": {
      if (config.filter_origin && context.origin && config.filter_origin !== context.origin) return false;
      // filter_pipe: e.g. "pipe_whatsapp", "pipe_confirmacao", "pipe_propostas"
      const ctxPipe = (context.pipe ?? context.pipe_type) as string | undefined;
      if (config.filter_pipe && ctxPipe && config.filter_pipe !== ctxPipe) return false;
      // Custom pipeline filtering
      if (config.filter_pipeline_id && context.pipeline_id) {
        if (config.filter_pipeline_id !== context.pipeline_id) return false;
      } else if (!config.filter_pipeline_id && context.pipeline_id) {
        // Fired from custom pipeline entry — skip workflows without pipeline filter to avoid duplicates
        return false;
      }
      return true;
    }

    case "tag_added": {
      if (config.tag_id && context.tag_id && config.tag_id !== context.tag_id) return false;
      if (config.tag_name && context.tag_name) {
        if (String(config.tag_name).toLowerCase() !== String(context.tag_name).toLowerCase()) return false;
      }
      return true;
    }

    case "score_reached": {
      const minScore = Number(config.min_score) || 0;
      const currentScore = Number(context.score) || 0;
      return currentScore >= minScore;
    }

    case "lead_replied": {
      if (config.channel && config.channel !== "any" && context.channel && config.channel !== context.channel) return false;
      if (config.contains_text && context.message) {
        return String(context.message).toLowerCase().includes(String(config.contains_text).toLowerCase());
      }
      return true;
    }

    case "lead_no_reply": {
      // Timeout is checked by the caller; config match is always true
      return true;
    }

    case "meeting_confirmed": {
      if (config.pipe_type && context.pipe_type && config.pipe_type !== context.pipe_type) return false;
      return true;
    }

    case "meeting_not_confirmed": {
      // hours_before is checked by the caller
      return true;
    }

    case "proposal_accepted":
    case "proposal_lost": {
      return true;
    }

    case "followup_overdue": {
      return true;
    }

    case "webhook_received": {
      if (config.webhook_key && context.webhook_key && config.webhook_key !== context.webhook_key) return false;
      return true;
    }

    case "lead_assigned": {
      if (config.role && config.role !== "any" && context.role && config.role !== context.role) return false;
      return true;
    }

    case "campaign_status_changed":
    case "lead_added_to_campaign":
    case "lead_removed_from_campaign":
    case "campaign_lead_replied":
    case "campaign_lead_no_reply":
    case "campaign_completed": {
      if (config.campaign_id && context.campanha_id && config.campaign_id !== context.campanha_id) return false;
      return true;
    }

    case "field_changed": {
      if (config.field_name && context.field_name && config.field_name !== context.field_name) return false;
      if (config.new_value && context.new_value && config.new_value !== context.new_value) return false;
      return true;
    }

    case "cron": {
      // Cron matching is done by the caller
      return true;
    }

    default:
      return true;
  }
}

/**
 * Fire stage_changed trigger — replacement for frontend workflowTrigger.ts
 */
export async function fireStageChangedTrigger(params: {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  fromStage?: string;
  toStage: string;
}): Promise<number> {
  return fireTrigger({
    supabase: params.supabase,
    organizationId: params.organizationId,
    triggerType: "stage_changed",
    leadId: params.leadId,
    context: {
      trigger: "stage_changed",
      pipe_type: params.pipeType || null,
      pipeline_id: params.pipelineId || null,
      from_stage: params.fromStage || null,
      to_stage: params.toStage,
    },
  });
}

/**
 * Process cron-type workflow triggers.
 * Called every minute by pg_cron. Checks each cron workflow's expression
 * against the current minute.
 */
export async function processCronTriggers(supabase: SupabaseClient): Promise<number> {
  const { data: cronWorkflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("trigger_type", "cron")
    .eq("is_active", true);

  if (error || !cronWorkflows?.length) return 0;

  let count = 0;
  const now = new Date();

  for (const wf of cronWorkflows) {
    const config = wf.trigger_config as { cron_expression?: string };
    if (!config.cron_expression) continue;

    if (matchesCronExpression(config.cron_expression, now)) {
      // Cron workflows don't have a specific lead — they run org-wide
      // The workflow definition should have its own logic for selecting leads
      const { error: insertError } = await supabase.from("workflow_executions").insert({
        workflow_id: wf.id,
        organization_id: wf.organization_id,
        lead_id: null,
        status: "running",
        context: { trigger_type: "cron", cron_expression: config.cron_expression },
      });

      if (!insertError) count++;
    }
  }

  return count;
}

/**
 * Simple cron expression matcher (minute hour day month weekday)
 */
function matchesCronExpression(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;

  return (
    matchesCronField(minExpr, date.getMinutes()) &&
    matchesCronField(hourExpr, date.getHours()) &&
    matchesCronField(dayExpr, date.getDate()) &&
    matchesCronField(monthExpr, date.getMonth() + 1) &&
    matchesCronField(weekdayExpr, date.getDay())
  );
}

function matchesCronField(expr: string, value: number): boolean {
  if (expr === "*") return true;

  // Handle */N
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.substring(2));
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // Handle comma-separated values
  const parts = expr.split(",");
  for (const part of parts) {
    // Handle range N-M
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) return true;
    } else {
      if (parseInt(part) === value) return true;
    }
  }

  return false;
}

function workflowHasCopilotNode(definition: { nodes: { type: string }[] } | null | undefined): boolean {
  if (!definition?.nodes) return false;
  return definition.nodes.some((n) => n.type === "copilot");
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduled_date — trigger "Antes de uma data"
//
// Dispara o workflow uma vez por lead em momentos relativos à data da reunião
// marcada de cada lead (`pipeline_entries.metadata->>'meeting_date'`). Toda a
// regra de decisão vive na função pura `planScheduledDateDispatches` (sem I/O);
// a casca `processScheduledDateTriggers` faz o I/O e roda no loop do pg_cron.
// PRD: issue #895. Fatia 1 (#896): apenas o âncora `antes_da_reuniao`.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SCHEDULED_TZ = "America/Sao_Paulo";
const DEFAULT_SEND_TIME = "09:00";
/** Teto do catch-up em segundos: tolera atraso do cron/outage sem disparar janelas perdidas. */
const SCHEDULED_GRACE_CAP_SECONDS = 3600;
/**
 * Piso do catch-up em segundos. Sem ele, dispatches de offset curto/zero (ex.: "no dia
 * da reunião", offset 0 → grace 0) teriam janela de largura zero e o cron de ~1 min
 * nunca acertaria o disparo. 120s (~2 ticks do cron) garante que disparem de forma
 * confiável sem reabrir janelas legitimamente perdidas.
 */
const SCHEDULED_GRACE_FLOOR_SECONDS = 120;

export type ScheduledDispatchUnit = "days" | "hours" | "minutes";

export interface ScheduledDispatchItem {
  anchor: "ao_marcar" | "antes_da_reuniao";
  value?: number;
  unit?: ScheduledDispatchUnit;
  send_time?: string;
}

/** Workflow scheduled_date já resolvido pela casca (pipeline_id concreto + tz da org). */
export interface ScheduledDateWorkflow {
  id: string;
  organization_id: string;
  /** pipeline alvo resolvido (de pipe_type/sistema ou pipeline_id/custom). */
  pipeline_id: string;
  stages: string[];
  filter_origin?: string | null;
  dispatches: ScheduledDispatchItem[];
  timezone?: string;
}

/** Reunião marcada de um lead, candidata da audiência. */
export interface LeadMeeting {
  organization_id: string;
  lead_id: string;
  pipeline_id: string;
  stage_key: string;
  meeting_date: string; // ISO timestamptz
  origin?: string | null;
}

export interface ScheduledFiredLogEntry {
  workflow_id: string;
  lead_id: string;
  meeting_date: string;
  item_key: string;
}

export interface PlannedScheduledDispatch {
  workflow_id: string;
  organization_id: string;
  lead_id: string;
  meeting_date: string;
  item_key: string;
}

const UNIT_SECONDS: Record<ScheduledDispatchUnit, number> = {
  days: 86_400,
  hours: 3_600,
  minutes: 60,
};

/** Offset do timezone (ms) num dado instante — via Intl, sem libs externas. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - date.getTime();
}

/** Converte um "relógio de parede" (Y/M/D HH:MM no fuso `tz`) para epoch ms. */
function zonedWallTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Dupla-correção cobre a maioria dos casos de DST (BR não usa DST desde 2019).
  const offset1 = tzOffsetMs(timeZone, new Date(naiveUTC));
  const offset2 = tzOffsetMs(timeZone, new Date(naiveUTC - offset1));
  return naiveUTC - offset2;
}

/**
 * Calcula o instante (epoch ms) em que um item deve disparar.
 * Retorna `null` se o âncora ainda não é suportado nesta fatia.
 */
function computeFireAt(item: ScheduledDispatchItem, meetingMs: number, tz: string): number | null {
  if (item.anchor === "antes_da_reuniao") {
    const unit = item.unit ?? "days";
    const value = Number(item.value) || 0;
    const offsetMs = value * UNIT_SECONDS[unit] * 1000;
    const target = meetingMs - offsetMs;
    if (unit === "days") {
      // Para "dias antes", o disparo sai no horário do dia `send_time` no fuso da org.
      const sendTime = item.send_time || DEFAULT_SEND_TIME;
      const [hh, mm] = sendTime.split(":").map((n) => Number(n));
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts = dtf.formatToParts(new Date(target));
      const map: Record<string, number> = {};
      for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
      return zonedWallTimeToEpoch(map.year, map.month, map.day, hh || 0, mm || 0, tz);
    }
    return target;
  }
  // ao_marcar — Fatia 2 (#897). Não dispara nesta fatia.
  return null;
}

/** Chave de dedup canônica — normaliza meeting_date (formatos ISO variados) por epoch. */
function dedupKey(workflowId: string, leadId: string, meetingDate: string, itemKey: string): string {
  const ms = new Date(meetingDate).getTime();
  return `${workflowId}|${leadId}|${ms}|${itemKey}`;
}

/** item_key estável por posição na lista — editar o valor de um item não re-arma o já disparado. */
export function scheduledItemKey(index: number): string {
  return `item-${index}`;
}

/**
 * Função PURA: dado o instante atual, os workflows scheduled_date, as reuniões
 * candidatas e o log de disparos já feitos, retorna os disparos a fazer agora.
 *
 * Regras:
 *  - Audiência: org + pipeline + etapa(s) (vazio = qualquer) + origem (se configurada).
 *  - Ignora lead sem `meeting_date`.
 *  - Nunca dispara reunião já passada (`now > meeting_date`).
 *  - `antes_da_reuniao`: dispara quando `now ≥ meeting_date − offset` (no `send_time` p/ dias).
 *  - Janela perdida: pula se `now − fireAt` excede o grace (antecedência não coube / outage longo).
 *  - Dedup: nada re-dispara para (workflow, lead, meeting_date, item_key) já logado.
 */
export function planScheduledDateDispatches(
  now: Date,
  workflows: ScheduledDateWorkflow[],
  leadMeetings: LeadMeeting[],
  firedLog: ScheduledFiredLogEntry[],
): PlannedScheduledDispatch[] {
  const nowMs = now.getTime();
  const fired = new Set(
    firedLog.map((f) => dedupKey(f.workflow_id, f.lead_id, f.meeting_date, f.item_key)),
  );
  const planned: PlannedScheduledDispatch[] = [];
  const emitted = new Set<string>();

  for (const wf of workflows) {
    const tz = wf.timezone || DEFAULT_SCHEDULED_TZ;
    const stages = wf.stages || [];

    for (const lm of leadMeetings) {
      // ── Audiência ──
      if (lm.organization_id !== wf.organization_id) continue;
      if (lm.pipeline_id !== wf.pipeline_id) continue;
      if (stages.length > 0 && !stages.includes(lm.stage_key)) continue;
      if (wf.filter_origin && lm.origin && wf.filter_origin !== lm.origin) continue;
      if (wf.filter_origin && !lm.origin) continue;
      if (!lm.meeting_date) continue;

      const meetingMs = new Date(lm.meeting_date).getTime();
      if (isNaN(meetingMs)) continue;
      if (nowMs > meetingMs) continue; // reunião passada — nunca dispara

      wf.dispatches.forEach((item, index) => {
        const fireAt = computeFireAt(item, meetingMs, tz);
        if (fireAt === null) return;
        if (nowMs < fireAt) return; // ainda não chegou a hora

        // Janela perdida: grace pequeno o suficiente p/ rejeitar antecedência que não coube.
        const offsetMs =
          item.anchor === "antes_da_reuniao"
            ? (Number(item.value) || 0) * UNIT_SECONDS[item.unit ?? "days"] * 1000
            : 0;
        const graceMs = Math.min(
          Math.max(offsetMs / 2, SCHEDULED_GRACE_FLOOR_SECONDS * 1000),
          SCHEDULED_GRACE_CAP_SECONDS * 1000,
        );
        if (nowMs - fireAt > graceMs) return; // janela perdida

        const itemKey = scheduledItemKey(index);
        const key = dedupKey(wf.id, lm.lead_id, lm.meeting_date, itemKey);
        if (fired.has(key) || emitted.has(key)) return; // dedup

        emitted.add(key);
        planned.push({
          workflow_id: wf.id,
          organization_id: wf.organization_id,
          lead_id: lm.lead_id,
          meeting_date: lm.meeting_date,
          item_key: itemKey,
        });
      });
    }
  }

  return planned;
}

/**
 * Casca fina (I/O) do trigger scheduled_date — espelha `processCronTriggers`.
 * Chamada a cada ~1 min pelo loop do `process-workflow-executions`.
 */
export async function processScheduledDateTriggers(supabase: SupabaseClient): Promise<number> {
  const { data: rawWorkflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("trigger_type", "scheduled_date")
    .eq("is_active", true);

  if (error || !rawWorkflows?.length) return 0;

  // Resolve o pipeline alvo de cada workflow (sistema via slug, ou custom via pipeline_id).
  const resolved: ScheduledDateWorkflow[] = [];
  for (const wf of rawWorkflows) {
    const config = (wf.trigger_config || {}) as {
      pipe_type?: string;
      pipeline_id?: string;
      stages?: string[];
      filter_origin?: string;
      dispatches?: ScheduledDispatchItem[];
    };
    if (!config.dispatches?.length) continue;

    let pipelineId = config.pipeline_id || null;
    if (!pipelineId && config.pipe_type) {
      const slug = config.pipe_type.replace(/^pipe_/, "");
      pipelineId = await resolveScheduledPipelineId(supabase, wf.organization_id, slug);
    }
    if (!pipelineId) continue;

    resolved.push({
      id: wf.id,
      organization_id: wf.organization_id,
      pipeline_id: pipelineId,
      stages: config.stages || [],
      filter_origin: config.filter_origin || null,
      dispatches: config.dispatches,
      timezone: DEFAULT_SCHEDULED_TZ,
    });
  }

  if (resolved.length === 0) return 0;

  // Candidatos: entradas dos pipelines alvo que têm meeting_date.
  const pipelineIds = [...new Set(resolved.map((w) => w.pipeline_id))];
  const { data: entries } = await supabase
    .from("pipeline_entries")
    .select("organization_id, lead_id, pipeline_id, stage_key, metadata")
    .in("pipeline_id", pipelineIds)
    .limit(2000);

  const leadMeetings: LeadMeeting[] = (entries || [])
    .map((e: Record<string, unknown>) => {
      const meta = (e.metadata || {}) as Record<string, unknown>;
      const meetingDate = meta.meeting_date as string | undefined;
      if (!meetingDate) return null;
      return {
        organization_id: e.organization_id as string,
        lead_id: e.lead_id as string,
        pipeline_id: e.pipeline_id as string,
        stage_key: e.stage_key as string,
        meeting_date: meetingDate,
        origin: null,
      } as LeadMeeting;
    })
    .filter((x): x is LeadMeeting => x !== null);

  if (leadMeetings.length === 0) return 0;

  // Log de disparos já feitos para esses workflows.
  const workflowIds = resolved.map((w) => w.id);
  const { data: logRows } = await supabase
    .from("scheduled_date_dispatch_log")
    .select("workflow_id, lead_id, meeting_date, item_key")
    .in("workflow_id", workflowIds);

  const firedLog: ScheduledFiredLogEntry[] = (logRows || []).map((r: Record<string, unknown>) => ({
    workflow_id: r.workflow_id as string,
    lead_id: r.lead_id as string,
    meeting_date: r.meeting_date as string,
    item_key: r.item_key as string,
  }));

  const planned = planScheduledDateDispatches(new Date(), resolved, leadMeetings, firedLog);

  let count = 0;
  for (const d of planned) {
    // Grava o ledger primeiro: a unicidade (workflow,lead,meeting_date,item) é o guard
    // anti-corrida contra ticks sobrepostos. Conflito ⇒ já disparou ⇒ pula a execução.
    const { error: logErr } = await supabase.from("scheduled_date_dispatch_log").insert({
      organization_id: d.organization_id,
      workflow_id: d.workflow_id,
      lead_id: d.lead_id,
      meeting_date: d.meeting_date,
      item_key: d.item_key,
    });
    if (logErr) continue;

    const { error: execErr } = await supabase.from("workflow_executions").insert({
      workflow_id: d.workflow_id,
      organization_id: d.organization_id,
      lead_id: d.lead_id,
      status: "running",
      context: {
        trigger_type: "scheduled_date",
        meeting_date: d.meeting_date,
        item_key: d.item_key,
      },
    });
    if (!execErr) count++;
  }

  return count;
}

/** Resolve pipeline de sistema por slug. Inline para não acoplar a casca ao pipeline-adapter. */
async function resolveScheduledPipelineId(
  supabase: SupabaseClient,
  orgId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("type", "system")
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}
