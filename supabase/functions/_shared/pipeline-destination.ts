/**
 * Destino de porta de entrada — SCRUM-641 (ADR-0034 "funil é funil", D4).
 *
 * As portas (webhook-calcom, webhook-new-lead, meta-leadgen-poll,
 * google-calendar-events, lead-webhook origin=cal) paravam de pé sobre os
 * slugs do trio semeado ('whatsapp'/'confirmacao'). Org nova pós-SCRUM-641
 * nasce SEM o trio — nasce com o "Funil de Vendas" como
 * `organizations.default_pipeline_id` e etapas com PAPEL
 * (`stage_role = 'meeting_booked'/'won'/'lost'`).
 *
 * Contrato deste módulo (decisão CTO 2026-09-03):
 *   1. O destino PREFERIDO da porta (o slug histórico, ou a config explícita
 *      da porta) vale ONDE EXISTE — org antiga com o trio se comporta
 *      exatamente como antes, byte a byte.
 *   2. Onde o preferido não existe, o fallback único é o FUNIL PADRÃO da org
 *      (D4). Reunião ancora na etapa com papel `meeting_booked` (nunca em
 *      slug); lead comum ancora na 1ª etapa ativa.
 *   3. Funil padrão sem papel de reunião → 1ª etapa ativa + warn (comportamento
 *      definido e documentado; melhor card visível na entrada do funil do que
 *      reunião invisível).
 *   4. Sem funil padrão → null: o chamador cria o lead SEM card e loga
 *      (mesmo contrato do lead-webhook desde SCRUM-624).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isPipelineResolutionError,
  resolveActiveStageKey,
  resolvePipeline,
} from "./pipeline-adapter.ts";

export interface PipelineDestination {
  /** Ref aceito pelo adapter (id ou slug) — vai direto em upsertPipeEntry.slug. */
  ref: string;
  /** Etapa resolvida (sempre ativa no funil de destino, ou a preferida validável). */
  stageKey: string;
  /** true quando o destino veio do fallback (funil padrão), não do preferido. */
  usedDefaultPipeline: boolean;
}

/** Lê `organizations.default_pipeline_id` (D4). null = org sem funil padrão. */
export async function getOrgDefaultPipelineRef(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("default_pipeline_id")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    console.warn(`[pipeline-destination] leitura de default_pipeline_id falhou para org ${orgId}:`, error.message);
    return null;
  }
  return (data as { default_pipeline_id?: string | null } | null)?.default_pipeline_id ?? null;
}

/**
 * Etapa ATIVA com o papel pedido no funil (menor position). null = o funil
 * não tem etapa ativa com esse papel.
 */
export async function resolveStageKeyByRole(
  supabase: SupabaseClient,
  orgId: string,
  pipelineRef: string,
  role: "meeting_booked" | "meeting_held" | "won" | "lost",
): Promise<string | null> {
  let pipelineId: string;
  try {
    pipelineId = (await resolvePipeline(supabase, orgId, pipelineRef)).id;
  } catch (e) {
    if (isPipelineResolutionError(e)) return null;
    throw e;
  }
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("stage_key")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .eq("stage_role", role)
    .order("position", { ascending: true })
    .limit(1);
  if (error) {
    console.warn(`[pipeline-destination] busca por papel ${role} falhou em ${pipelineRef}@${orgId}:`, error.message);
    return null;
  }
  return (data?.[0] as { stage_key: string } | undefined)?.stage_key ?? null;
}

/** O preferido resolve nesta org? (inexistente/inativo/erro de lookup → false). */
async function preferredResolves(
  supabase: SupabaseClient,
  orgId: string,
  ref: string,
): Promise<boolean> {
  try {
    await resolvePipeline(supabase, orgId, ref);
    return true;
  } catch (e) {
    if (isPipelineResolutionError(e)) return false;
    throw e;
  }
}

/**
 * Destino de LEAD comum (sem reunião): preferido onde existe; senão funil
 * padrão + 1ª etapa ativa.
 */
export async function resolveLeadDestination(
  supabase: SupabaseClient,
  orgId: string,
  preferred?: { ref: string; stageKey?: string | null },
): Promise<PipelineDestination | null> {
  if (preferred && await preferredResolves(supabase, orgId, preferred.ref)) {
    const stageKey = await resolveActiveStageKey(supabase, orgId, preferred.ref, preferred.stageKey ?? null);
    if (stageKey) return { ref: preferred.ref, stageKey, usedDefaultPipeline: false };
  }

  const defaultRef = await getOrgDefaultPipelineRef(supabase, orgId);
  if (!defaultRef) return null;
  const stageKey = await resolveActiveStageKey(supabase, orgId, defaultRef, preferred?.stageKey ?? null);
  if (!stageKey) {
    console.warn(`[pipeline-destination] funil padrão ${defaultRef} da org ${orgId} sem etapas ativas; sem destino.`);
    return null;
  }
  return { ref: defaultRef, stageKey, usedDefaultPipeline: true };
}

/**
 * Destino de REUNIÃO: preferido onde existe (com a etapa literal histórica);
 * senão funil padrão ancorando pela etapa de papel `meeting_booked` — e, se o
 * funil padrão não tiver papel de reunião, 1ª etapa ativa + warn.
 */
export async function resolveMeetingDestination(
  supabase: SupabaseClient,
  orgId: string,
  preferred?: { ref: string; stageKey: string },
): Promise<PipelineDestination | null> {
  if (preferred && await preferredResolves(supabase, orgId, preferred.ref)) {
    return { ref: preferred.ref, stageKey: preferred.stageKey, usedDefaultPipeline: false };
  }

  const defaultRef = await getOrgDefaultPipelineRef(supabase, orgId);
  if (!defaultRef) {
    console.warn(
      `[pipeline-destination] reunião sem destino: org ${orgId} não tem ${preferred ? `o funil "${preferred.ref}" nem ` : ""}funil padrão.`,
    );
    return null;
  }

  const byRole = await resolveStageKeyByRole(supabase, orgId, defaultRef, "meeting_booked");
  if (byRole) return { ref: defaultRef, stageKey: byRole, usedDefaultPipeline: true };

  const first = await resolveActiveStageKey(supabase, orgId, defaultRef, null);
  if (!first) {
    console.warn(`[pipeline-destination] funil padrão ${defaultRef} da org ${orgId} sem etapas ativas; reunião sem card.`);
    return null;
  }
  console.warn(
    `[pipeline-destination] funil padrão ${defaultRef} da org ${orgId} não tem etapa com papel meeting_booked; reunião cai na 1ª etapa ativa "${first}".`,
  );
  return { ref: defaultRef, stageKey: first, usedDefaultPipeline: true };
}
