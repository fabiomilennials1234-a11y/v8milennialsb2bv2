/**
 * Unified pipeline_entries adapter for edge functions.
 *
 * Replaces direct reads/writes to legacy pipe_whatsapp, pipe_confirmacao,
 * pipe_propostas tables. The reverse sync trigger keeps legacy tables
 * in sync during the migration period.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PipeSlug = "whatsapp" | "confirmacao" | "propostas";

export interface PipelineEntry {
  id: string;
  organization_id: string;
  pipeline_id: string;
  lead_id: string;
  stage_key: string;
  assigned_to: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  entered_at: string;
  stage_changed_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

const pipelineIdCache = new Map<string, string>();

/**
 * Resolve a target stage_key against the org's ACTIVE pipeline_stages.
 *
 * Root-cause guard for "ghost stages": external ingest (Make/n8n/Meta) sends a
 * stage slug as a fixed string. If that slug was deactivated/renamed in the org
 * (or is a hardcoded default the org never uses), the lead lands in a stage the
 * Kanban does not render — invisible. This resolver coerces the target to a real
 * active stage so a lead can never enter a ghost stage from ingest.
 *
 * Resolution order:
 *   1. `requested` if it matches an active stage_key → use as-is.
 *   2. else → first active stage (min position).
 *   3. else (org has no active stages — never seeded) → `null`; caller decides
 *      a last-resort fallback (e.g. the static DEFAULT seed slug).
 */
export async function resolveActiveStageKey(
  supabase: SupabaseClient,
  orgId: string,
  slug: PipeSlug,
  requested?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("stage_key, position")
    .eq("organization_id", orgId)
    .eq("pipeline_type", slug)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    console.warn(`[pipeline-adapter] resolveActiveStageKey query failed for ${slug}@${orgId}:`, error);
    // On query failure, trust the requested value rather than dropping the lead.
    return requested ?? null;
  }

  const active = (data ?? []) as { stage_key: string; position: number }[];
  if (active.length === 0) return null;

  if (requested && active.some((s) => s.stage_key === requested)) {
    return requested;
  }

  const fallback = active[0].stage_key;
  if (requested && requested !== fallback) {
    console.warn(
      `[pipeline-adapter] stage "${requested}" not active in ${slug}@${orgId}; remapping to first active stage "${fallback}" (ghost-stage guard).`,
    );
  }
  return fallback;
}

export async function resolvePipelineId(
  supabase: SupabaseClient,
  orgId: string,
  slug: PipeSlug,
): Promise<string | null> {
  const key = `${orgId}:${slug}`;
  const cached = pipelineIdCache.get(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("type", "system")
    .maybeSingle();

  if (error || !data) {
    console.warn(`[pipeline-adapter] resolvePipelineId failed for ${slug}@${orgId}:`, error);
    return null;
  }

  pipelineIdCache.set(key, data.id);
  return data.id;
}

export async function getPipeEntry(
  supabase: SupabaseClient,
  leadId: string,
  orgId: string,
  slug: PipeSlug,
): Promise<PipelineEntry | null> {
  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return null;

  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (error) {
    console.warn("[pipeline-adapter] getPipeEntry error:", error);
    return null;
  }
  return data as PipelineEntry | null;
}

export async function getPipeEntriesByLeads(
  supabase: SupabaseClient,
  leadIds: string[],
  orgId: string,
  slug: PipeSlug,
): Promise<PipelineEntry[]> {
  if (leadIds.length === 0) return [];

  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return [];

  const { data, error } = await supabase
    .from("pipeline_entries")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .in("lead_id", leadIds);

  if (error) {
    console.warn("[pipeline-adapter] getPipeEntriesByLeads error:", error);
    return [];
  }
  return (data || []) as PipelineEntry[];
}

export async function upsertPipeEntry(
  supabase: SupabaseClient,
  params: {
    leadId: string;
    orgId: string;
    slug: PipeSlug;
    stageKey: string;
    metadata?: Record<string, unknown>;
    assignedTo?: string | null;
    notes?: string | null;
  },
): Promise<string | null> {
  const pipelineId = await resolvePipelineId(supabase, params.orgId, params.slug);
  if (!pipelineId) return null;

  const existing = await getPipeEntry(supabase, params.leadId, params.orgId, params.slug);

  if (existing) {
    const up: Record<string, unknown> = { stage_key: params.stageKey };
    if (params.metadata) {
      up.metadata = { ...(existing.metadata || {}), ...params.metadata };
    }
    if (params.assignedTo !== undefined) up.assigned_to = params.assignedTo;
    if (params.notes !== undefined) up.notes = params.notes;

    const { error } = await supabase
      .from("pipeline_entries")
      .update(up)
      .eq("id", existing.id);

    if (error) {
      console.warn("[pipeline-adapter] upsertPipeEntry update error:", error);
      return null;
    }
    return existing.id;
  }

  const { data, error } = await supabase
    .from("pipeline_entries")
    .insert({
      pipeline_id: pipelineId,
      lead_id: params.leadId,
      organization_id: params.orgId,
      stage_key: params.stageKey,
      assigned_to: params.assignedTo ?? null,
      notes: params.notes ?? null,
      metadata: params.metadata || {},
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[pipeline-adapter] upsertPipeEntry insert error:", error);
    return null;
  }
  return data?.id ?? null;
}

export async function updatePipeEntryById(
  supabase: SupabaseClient,
  entryId: string,
  updates: {
    stageKey?: string;
    metadata?: Record<string, unknown>;
    assignedTo?: string | null;
    notes?: string | null;
    closedAt?: string | null;
  },
): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (updates.stageKey !== undefined) payload.stage_key = updates.stageKey;
  if (updates.assignedTo !== undefined) payload.assigned_to = updates.assignedTo;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.closedAt !== undefined) payload.closed_at = updates.closedAt;

  if (updates.metadata !== undefined) {
    const { data: current } = await supabase
      .from("pipeline_entries")
      .select("metadata")
      .eq("id", entryId)
      .single();
    payload.metadata = {
      ...((current?.metadata as Record<string, unknown>) || {}),
      ...updates.metadata,
    };
  }

  if (Object.keys(payload).length === 0) return true;

  const { error } = await supabase
    .from("pipeline_entries")
    .update(payload)
    .eq("id", entryId);

  if (error) {
    console.warn(`[pipeline-adapter] updatePipeEntryById error for ${entryId}:`, error);
    return false;
  }
  return true;
}

export async function deletePipeEntry(
  supabase: SupabaseClient,
  leadId: string,
  orgId: string,
  slug: PipeSlug,
): Promise<boolean> {
  const pipelineId = await resolvePipelineId(supabase, orgId, slug);
  if (!pipelineId) return false;

  const { error } = await supabase
    .from("pipeline_entries")
    .delete()
    .eq("pipeline_id", pipelineId)
    .eq("lead_id", leadId);

  if (error) {
    console.warn("[pipeline-adapter] deletePipeEntry error:", error);
    return false;
  }
  return true;
}
