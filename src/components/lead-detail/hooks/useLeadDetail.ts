import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrackView } from "@/hooks/useTrackView";

export function useLeadDetail(leadId: string | null, isOpen: boolean) {
  const leadQuery = useQuery({
    queryKey: ["lead-detail", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
          lead_tags(
            tag:tags(id, name, color)
          )
        `)
        .eq("id", leadId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leadId && isOpen,
  });

  const pipelineQuery = useQuery({
    queryKey: ["lead-pipes", leadId],
    queryFn: async () => {
      if (!leadId) return null;
      const [whatsapp, confirmacao, propostas, customEntries, followUps] = await Promise.all([
        supabase.from("pipe_whatsapp").select("*").eq("lead_id", leadId),
        supabase.from("pipe_confirmacao").select("*").eq("lead_id", leadId),
        supabase.from("pipe_propostas").select("*").eq("lead_id", leadId),
        supabase
          .from("custom_pipe_entries")
          .select("*, stage:custom_pipeline_stages(name, color), pipeline:custom_pipelines(name)")
          .eq("lead_id", leadId),
        supabase.from("follow_ups").select("*").eq("lead_id", leadId),
      ]);
      return {
        whatsapp: whatsapp.data || [],
        confirmacao: confirmacao.data || [],
        propostas: propostas.data || [],
        customEntries: customEntries.data || [],
        followUps: followUps.data || [],
      };
    },
    enabled: !!leadId && isOpen,
  });

  useTrackView(
    isOpen && leadId ? "lead" : undefined,
    isOpen ? (leadId ?? undefined) : undefined,
    leadQuery.data?.name,
  );

  return {
    lead: leadQuery.data,
    isLoading: leadQuery.isLoading,
    pipelineData: pipelineQuery.data,
    refetchLead: leadQuery.refetch,
  };
}
