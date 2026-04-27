/**
 * Helpers compartilhados entre handlers de AI Actions.
 * Sem export público — uso interno do módulo actions/.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Upsert do registro do lead em pipe_whatsapp com o status informado.
 * Tolerante a falha (loga warning, não joga).
 */
export async function upsertPipeWhatsapp(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  status: string,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("pipe_whatsapp")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (existing) {
      await supabase.from("pipe_whatsapp").update({ status }).eq("id", existing.id);
    } else {
      await supabase
        .from("pipe_whatsapp")
        .insert({ lead_id: leadId, organization_id: organizationId, status });
    }
  } catch (e) {
    console.warn("[actions/_helpers] Failed to upsert pipe_whatsapp:", e);
  }
}

/**
 * Move o lead para o pipe alvo (confirmacao | propostas) e remove dele do pipe_whatsapp.
 * Mantém o comportamento histórico do executor.
 */
export async function executeMoveToPipe(
  supabase: SupabaseClient,
  leadId: string,
  organizationId: string,
  pipe: string,
  stage: string,
): Promise<void> {
  try {
    if (pipe === "confirmacao") {
      const { data: existing } = await supabase
        .from("pipe_confirmacao")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        await supabase.from("pipe_confirmacao").update({ status: stage }).eq("id", existing.id);
      } else {
        await supabase.from("pipe_confirmacao").insert({
          lead_id: leadId,
          organization_id: organizationId,
          status: stage,
        });
      }
    } else {
      const { data: existing } = await supabase
        .from("pipe_propostas")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        await supabase.from("pipe_propostas").update({ status: stage }).eq("id", existing.id);
      } else {
        await supabase.from("pipe_propostas").insert({
          lead_id: leadId,
          organization_id: organizationId,
          status: stage,
        });
      }
    }

    await supabase.from("pipe_whatsapp").delete().eq("lead_id", leadId);
  } catch (e) {
    console.warn("[actions/_helpers] Failed to execute moveToPipe:", e);
  }
}
