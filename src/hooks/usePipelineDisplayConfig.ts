import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface PipelineDisplayConfig {
  id: string;
  organization_id: string;
  pipe_type: "whatsapp" | "confirmacao" | "propostas" | "upsell";
  display_name: string;
  is_visible: boolean;
  position: number;
}

const DEFAULT_CONFIG: PipelineDisplayConfig[] = [
  { id: "", organization_id: "", pipe_type: "whatsapp", display_name: "Oportunidades", is_visible: true, position: 1 },
  { id: "", organization_id: "", pipe_type: "confirmacao", display_name: "Agendamentos", is_visible: true, position: 2 },
  { id: "", organization_id: "", pipe_type: "propostas", display_name: "Orçamentos", is_visible: true, position: 3 },
  { id: "", organization_id: "", pipe_type: "upsell", display_name: "Carteira", is_visible: true, position: 4 },
];

export function usePipelineDisplayConfig() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline-display-config", organizationId],
    queryFn: async (): Promise<PipelineDisplayConfig[]> => {
      if (!organizationId) return DEFAULT_CONFIG;

      // Ensure config exists
      await supabase.rpc("ensure_pipeline_display_config", { p_org_id: organizationId });

      const { data, error } = await supabase
        .from("pipeline_display_config")
        .select("*")
        .eq("organization_id", organizationId)
        .order("position");

      if (error || !data?.length) return DEFAULT_CONFIG;
      return data as PipelineDisplayConfig[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Get hidden default pipes (for "Criar novo" template list) */
export function useHiddenDefaultPipes() {
  const { data: configs } = usePipelineDisplayConfig();
  if (!configs) return [];
  return configs.filter((c) => !c.is_visible);
}

/** Toggle pipe visibility */
export function useTogglePipeVisibility() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ pipeType, visible }: { pipeType: string; visible: boolean }) => {
      if (!organizationId) throw new Error("No org");
      const { error } = await supabase
        .from("pipeline_display_config")
        .update({ is_visible: visible, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-display-config"] });
    },
  });
}
