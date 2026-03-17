import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import type { CampaignTemplate, CampaignTemplateMessageType } from "./useCampaignTemplates";

/**
 * Busca templates de mensagem da org atual filtrados por tipo (text | audio | image | document).
 * Reutiliza a tabela campaign_templates existente.
 */
export function useMessageTemplates(type: CampaignTemplateMessageType) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["message-templates", organizationId, type],
    queryFn: async (): Promise<CampaignTemplate[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("campaign_templates")
        .select("id, organization_id, name, content, message_type, audio_url, image_url, available_variables, times_used, is_active, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("message_type", type)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return (data ?? []) as CampaignTemplate[];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
}
