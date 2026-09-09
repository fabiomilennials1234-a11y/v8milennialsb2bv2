/**
 * useLeadCreateHandler — handler de criação de lead via WhatsApp.
 *
 * Onda 3.1, C12. Extrai handleCreateLead do shell LeadDetailContent.
 * Encapsula: criação, move para stage específico, update campos extras, log.
 */

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateSystemPipelineEntry } from "@/integrations/supabase/pipeline-entry-rpc";
import { useCreateLeadFromWhatsApp } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { useUpdateLead } from "../useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useCurrentTeamMember } from "@/modules/identity";
import type { CreateLeadPayload } from "../../components/lead/create/LeadCreateForm";

interface UseLeadCreateHandlerOptions {
  pushName?: string | null;
  onSuccess?: () => void;
}

interface UseLeadCreateHandlerResult {
  create: (payload: CreateLeadPayload) => Promise<void>;
  isPending: boolean;
}

export function useLeadCreateHandler({ pushName, onSuccess }: UseLeadCreateHandlerOptions): UseLeadCreateHandlerResult {
  const createLead = useCreateLeadFromWhatsApp();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const { data: teamMember } = useCurrentTeamMember();

  const create = async (payload: CreateLeadPayload) => {
    try {
      await criar(payload);
    } catch (e) {
      // ⚠️ SEM ISTO, O BOTÃO NÃO DIZ NADA.
      //
      // Este handler não tratava erro, e nenhum chamador tratava por ele: a
      // promessa rejeitava e a tela ficava exatamente como estava. Medido em
      // produção (19/08): um master em shadow clicava "Criar Lead" e nada
      // acontecia — o insert era recusado porque o id do membro virtual não
      // existe em `team_members`, e a recusa morria no vazio.
      //
      // Falha visível é o mínimo. A mensagem do servidor entra na descrição
      // porque "violação de chave estrangeira" e "sem permissão" pedem reações
      // diferentes, e um texto genérico as achataria numa só.
      toast.error("Não foi possível criar o lead", {
        description: e instanceof Error ? e.message : undefined,
      });
      throw e;
    }
  };

  const criar = async (payload: CreateLeadPayload) => {
    const result = await createLead.mutateAsync({
      phone: payload.phone,
      pushName: payload.name || pushName,
      origin: payload.origin,
      sdrId: payload.sdrId,
      destination: payload.destination,
      campanhaId: payload.campanhaId,
      customPipelineId: payload.customPipelineId,
      customStageId: payload.customStageId,
    });

    const targetStageKey = payload.stageId;
    if (targetStageKey && result.leadId) {
      const slug = payload.destination === "qualificacao"
        ? "whatsapp"
        : payload.destination === "confirmacao" || payload.destination === "propostas"
          ? payload.destination
          : null;
      if (slug) {
        if (!teamMember?.organization_id) {
          throw new Error("Organização ativa não encontrada para mover a etapa do lead");
        }
        const { data: entries, error } = await supabase
          .from("negocio_projetado")
          .select("id")
          .eq("organization_id", teamMember.organization_id)
          .eq("lead_id", result.leadId)
          .eq("funil_sistema", slug)
          .order("closed_at", { ascending: true, nullsFirst: true })
          .order("stage_changed_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        if (entries?.[0]?.id) {
          await updateSystemPipelineEntry(entries[0].id, { stage_key: targetStageKey });
        }
      }
    }

    if (result.isNew && (payload.company || payload.email || payload.notes)) {
      await updateLead.mutateAsync({
        id: result.leadId,
        company: payload.company || null,
        email: payload.email || null,
        notes: payload.notes || null,
      });
    }

    logAction({
      leadId: result.leadId,
      action: "lead_created",
      description: `Lead "${payload.name}" criado via WhatsApp`,
    });
    toast.success("Lead criado com sucesso!");
    onSuccess?.();
  };

  return { create, isPending: createLead.isPending };
}
