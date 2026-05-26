import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";

export interface SlaConfig {
  id: string;
  organization_id: string;
  pipeline_type: string;
  stage_id: string | null;
  max_hours: number;
  escalation_action: string;
  escalation_target_user: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useSlaConfigs() {
  const { organizationId, isReady } = useOrganization();

  return useQuery<SlaConfig[]>({
    queryKey: ["sla-configs", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await (supabase.from as any)("sla_configs")
        .select("*")
        .eq("organization_id", organizationId)
        .order("pipeline_type")
        .order("created_at");
      if (error) throw error;
      return data as SlaConfig[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCreateSlaConfig() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      pipeline_type: string;
      stage_id?: string;
      max_hours: number;
      escalation_action: string;
      escalation_target_user?: string;
    }) => {
      const { data, error } = await (supabase.from as any)("sla_configs")
        .insert({
          organization_id: organizationId,
          ...input,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("SLA configurado");
      queryClient.invalidateQueries({ queryKey: ["sla-configs"] });
    },
  });
}

export function useUpdateSlaConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SlaConfig> & { id: string }) => {
      const { error } = await (supabase.from as any)("sla_configs")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sla-configs"] });
    },
  });
}

export function useDeleteSlaConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)("sla_configs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("SLA removido");
      queryClient.invalidateQueries({ queryKey: ["sla-configs"] });
    },
  });
}
