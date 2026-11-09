/** Resolve somente o destino informado pela porta de entrada; não há funil padrão da organização. */

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
  /** Compatibilidade com consumidores legados: nunca há fallback da organização. */
  usedDefaultPipeline: boolean;
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

/** Sem destino válido informado, cria-se apenas o lead, sem card. */
export async function resolveLeadDestination(
  supabase: SupabaseClient,
  orgId: string,
  preferred?: { ref: string; stageKey?: string | null },
): Promise<PipelineDestination | null> {
  if (preferred && await preferredResolves(supabase, orgId, preferred.ref)) {
    const stageKey = await resolveActiveStageKey(supabase, orgId, preferred.ref, preferred.stageKey ?? null);
    if (stageKey) return { ref: preferred.ref, stageKey, usedDefaultPipeline: false };
  }

  return null;
}

/** Reuniões também exigem um destino informado pela integração. */
export async function resolveMeetingDestination(
  supabase: SupabaseClient,
  orgId: string,
  preferred?: { ref: string; stageKey: string },
): Promise<PipelineDestination | null> {
  if (preferred && await preferredResolves(supabase, orgId, preferred.ref)) {
    return { ref: preferred.ref, stageKey: preferred.stageKey, usedDefaultPipeline: false };
  }

  return null;
}
