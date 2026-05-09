/**
 * Helpers compartilhados entre handlers de AI Actions.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertPipeEntry, deletePipeEntry } from "../pipeline-adapter.ts";
import type { PipeSlug } from "../pipeline-adapter.ts";

/**
 * Upsert do registro do lead no pipeline unificado com o status informado.
 * Tolerante a falha (loga warning, não joga).
 */
export async function upsertPipeWhatsapp(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  status: string,
): Promise<void> {
  try {
    await upsertPipeEntry(supabase, {
      leadId,
      orgId: organizationId,
      slug: "whatsapp",
      stageKey: status,
    });
  } catch (e) {
    console.warn("[actions/_helpers] Failed to upsert pipe entry (whatsapp):", e);
  }
}

/**
 * Move o lead para o pipe alvo (confirmacao | propostas) e remove do whatsapp.
 */
export async function executeMoveToPipe(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  pipe: string,
  stage: string,
): Promise<void> {
  try {
    const slug = pipe as PipeSlug;
    await upsertPipeEntry(supabase, {
      leadId,
      orgId: organizationId,
      slug,
      stageKey: stage,
    });

    await deletePipeEntry(supabase, leadId, organizationId, "whatsapp");
  } catch (e) {
    console.warn("[actions/_helpers] Failed to execute moveToPipe:", e);
  }
}
