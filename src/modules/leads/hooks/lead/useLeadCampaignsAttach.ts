/**
 * useLeadCampaignsAttach — attach de lead a campanha ativa.
 *
 * Onda 3.1, C11. Extrai handleAddToCampanha do shell LeadDetailContent.
 * Gerencia: query de campanhas ativas, seleção, mutation de insert em campanha_leads.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCampanhas, useCampanhaStages } from "@/modules/campaigns/hooks/useCampanhas";
import { useCurrentTeamMember } from "@/modules/identity";
interface UseLeadCampaignsAttachResult {
  activeCampanhas: { id: string; name: string; is_active: boolean }[];
  selectedCampanhaId: string | null;
  onSelectCampanha: (id: string) => void;
  attach: (leadId: string) => Promise<void>;
  isAttaching: boolean;
  hasStages: boolean;
}

export function useLeadCampaignsAttach(): UseLeadCampaignsAttachResult {
  const [selectedCampanhaId, setSelectedCampanhaId] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);

  const qc = useQueryClient();
  const { data: campanhas = [] } = useCampanhas();
  const { data: campanhaStages = [] } = useCampanhaStages(selectedCampanhaId ?? undefined);
  const { data: teamMember } = useCurrentTeamMember();

  const activeCampanhas = campanhas.filter((c) => c.is_active);

  const attach = async (leadId: string) => {
    if (!selectedCampanhaId || !campanhaStages.length) return;
    setIsAttaching(true);
    try {
      const firstStage = campanhaStages.sort((a, b) => a.position - b.position)[0];

      const { data: existing } = await supabase
        .from("campanha_leads")
        .select("id")
        .eq("campanha_id", selectedCampanhaId)
        .eq("lead_id", leadId)
        .maybeSingle();

      if (existing) {
        toast.info("Lead já está nesta campanha");
        return;
      }

      const { error } = await supabase.from("campanha_leads").insert({
        campanha_id: selectedCampanhaId,
        lead_id: leadId,
        stage_id: firstStage.id,
        responsible_id: teamMember?.id || null,
        sdr_id: teamMember?.id || null,
      });

      if (error) throw error;

      toast.success("Lead adicionado à campanha!");
      qc.invalidateQueries({ queryKey: ["campanha_leads"] });
      setSelectedCampanhaId(null);
    } finally {
      setIsAttaching(false);
    }
  };

  return {
    activeCampanhas,
    selectedCampanhaId,
    onSelectCampanha: setSelectedCampanhaId,
    attach,
    isAttaching,
    hasStages: campanhaStages.length > 0,
  };
}
