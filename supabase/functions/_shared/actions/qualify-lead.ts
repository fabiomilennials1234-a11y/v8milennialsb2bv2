/**
 * AI Action handlers — qualificação de lead e automações de pipeline.
 *
 *  - executeUpdateQualificationScore: atualiza qualification_score (0..100)
 *  - executeAutomation: roda actionConfig de qualify/disqualify/need_human
 *    (move stage, adiciona tags, notifica usuário, move pra outro pipe)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { promoveShadowLead } from "../lead-service.ts";
import type { ActionResult } from "./types.ts";
import { executeMoveToPipe, upsertPipeWhatsapp } from "./_helpers.ts";

export async function executeUpdateQualificationScore(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<ActionResult> {
  const leadId = params.lead_id as string;
  const score = Math.min(100, Math.max(0, Number(params.score) || 0));

  if (!leadId) return { success: false, error: "lead_id é obrigatório" };

  await supabase.from("leads").update({ qualification_score: score }).eq("id", leadId);

  return { success: true, message: `Score atualizado: ${score}`, data: { score } };
}

export async function executeAutomation(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  if (!leadId) return { success: false, error: "lead_id é obrigatório para automação" };

  const actionConfig = payload.action_config as Record<string, unknown>;
  const actionType = payload.action_type as string;

  if (!actionConfig) return { success: false, error: "action_config ausente no payload" };

  // Promover shadow lead antes de executar ações
  if (actionType === "qualify" || actionType === "disqualify") {
    const moveToPipe = actionConfig.moveToPipe as { pipe?: string; stage?: string } | undefined;
    const destination =
      moveToPipe && moveToPipe.stage
        ? { pipe: moveToPipe.pipe || "whatsapp", stage: moveToPipe.stage }
        : {
            pipe: "whatsapp",
            stage:
              (actionConfig.moveToStage as string) ||
              (actionType === "qualify" ? "respondeu" : "esfriou"),
          };

    await promoveShadowLead(supabase, leadId, organizationId, destination);
  }

  // Atualizar lead
  const updates: Record<string, unknown> = {};

  if (actionType === "need_human") {
    updates.ai_disabled = true;
    updates.ai_disabled_at = new Date().toISOString();
  }

  if (actionConfig.moveToStage) {
    updates.pipe_whatsapp = actionConfig.moveToStage;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", leadId);
    if (updateError) {
      console.warn("[executeAutomation] Failed to update lead:", updateError);
    } else if (actionConfig.moveToStage) {
      await upsertPipeWhatsapp(
        supabase,
        leadId,
        organizationId,
        actionConfig.moveToStage as string,
      );
    }
  }

  // Adicionar tags
  const addTags = actionConfig.addTags as string[] | undefined;
  if (addTags && addTags.length > 0) {
    for (const tagName of addTags) {
      let { data: tag } = await supabase
        .from("tags")
        .select("id")
        .eq("name", tagName)
        .maybeSingle();

      if (!tag) {
        const { data: newTag } = await supabase
          .from("tags")
          .insert({ name: tagName, color: "#6366f1" })
          .select()
          .single();
        tag = newTag;
      }

      if (tag) {
        await supabase.from("lead_tags").upsert(
          { lead_id: leadId, tag_id: tag.id },
          { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
        );
      }
    }
  }

  // Notificar usuário (apenas para need_human)
  if (actionConfig.notifyUserId && actionType === "need_human") {
    try {
      const { data: lead } = await supabase
        .from("leads")
        .select("name, company")
        .eq("id", leadId)
        .single();
      const leadLabel = lead?.name
        ? lead.company
          ? `${lead.name} - ${lead.company}`
          : lead.name
        : "Lead";

      await supabase.from("notifications").insert({
        organization_id: organizationId,
        user_id: actionConfig.notifyUserId,
        type: "transfer_to_human",
        title: "Lead precisa de atendimento humano",
        description: `${leadLabel} solicitou transferência para um especialista.`,
        lead_id: leadId,
        link: "/pipe-whatsapp",
      });
    } catch (notifErr) {
      console.warn("[executeAutomation] Failed to create notification:", notifErr);
    }
  }

  // Mover para outro pipe
  const moveToPipe = actionConfig.moveToPipe as { pipe?: string; stage?: string } | undefined;
  if (moveToPipe && moveToPipe.stage) {
    if (moveToPipe.pipe === "confirmacao" || moveToPipe.pipe === "propostas") {
      await executeMoveToPipe(supabase, leadId, organizationId, moveToPipe.pipe, moveToPipe.stage);
    } else if (moveToPipe.pipe === "upsell_base") {
      await supabase
        .from("upsell_clients")
        .update({ tipo_cliente_tempo: moveToPipe.stage })
        .eq("lead_id", leadId);
    } else if (moveToPipe.pipe === "upsell_gestao") {
      await supabase
        .from("upsell_clients")
        .update({ gestao_stage: moveToPipe.stage })
        .eq("lead_id", leadId);
    }
  }

  return { success: true, message: `Automação ${actionType} executada` };
}
