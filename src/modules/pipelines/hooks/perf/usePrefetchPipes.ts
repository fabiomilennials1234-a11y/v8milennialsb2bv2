import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { usePipelineId, type PipelineType } from "../model/usePipelineEntries";

const LEAD_SELECT = `
  id, name, company, email, phone, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  responsible:team_members!leads_responsible_id_fkey(id, name),
  sdr:team_members!leads_sdr_id_fkey(id, name),
  closer:team_members!leads_closer_id_fkey(id, name),
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
  lead_tags(tag:tags(id, name, color))
`;

export function usePrefetchPipes() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: whatsappPipelineId } = usePipelineId("whatsapp");
  const { data: confirmacaoPipelineId } = usePipelineId("confirmacao");
  const { data: propostasPipelineId } = usePipelineId("propostas");

  const prefetch = useCallback(() => {
    if (!organizationId) return;

    const pipelineIds: Record<PipelineType, string | null | undefined> = {
      whatsapp: whatsappPipelineId,
      confirmacao: confirmacaoPipelineId,
      propostas: propostasPipelineId,
    };

    for (const slug of ["whatsapp", "confirmacao", "propostas"] as PipelineType[]) {
      const pipelineId = pipelineIds[slug];
      if (!pipelineId) continue;

      queryClient.prefetchQuery({
        queryKey: ["pipeline_entries", slug, organizationId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("pipeline_entries")
            .select(`*, lead:leads!pipeline_entries_lead_id_fkey(${LEAD_SELECT})`)
            .eq("pipeline_id", pipelineId)
            .order("created_at", { ascending: false });
          if (error) throw error;
          return data ?? [];
        },
        staleTime: 10 * 60 * 1000,
      });
    }
  }, [queryClient, organizationId, whatsappPipelineId, confirmacaoPipelineId, propostasPipelineId]);

  return prefetch;
}
