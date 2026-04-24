/**
 * useLeadCreateHandler — handler de criação de lead via WhatsApp.
 *
 * Onda 3.1, C12. Extrai handleCreateLead do shell LeadDetailContent.
 * Encapsula: criação, move para stage específico, update campos extras, log.
 */

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCreateLeadFromWhatsApp } from "@/hooks/useWhatsAppLeadIntegration";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import type { CreateLeadPayload } from "@/components/lead/create/LeadCreateForm";

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

  const create = async (payload: CreateLeadPayload) => {
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

    if (payload.stageId && result.leadId) {
      const tableMap: Record<string, string> = {
        qualificacao: "pipe_whatsapp",
        confirmacao: "pipe_confirmacao",
        propostas: "pipe_propostas",
      };
      const table = tableMap[payload.destination];
      if (table) {
        await supabase
          .from(table)
          .update({ status: payload.stageId })
          .eq("lead_id", result.leadId);
      }
    }

    if (result.isNew && (payload.company || payload.email || payload.notes)) {
      await updateLead.mutateAsync({
        id: result.leadId,
        company: payload.company || null,
        email: payload.email || null,
        notes: payload.notes || null,
        rating: payload.rating || null,
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
