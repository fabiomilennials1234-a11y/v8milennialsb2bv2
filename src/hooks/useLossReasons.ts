import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
export interface LossReason {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  category: string | null;
  is_system: boolean;
  display_order: number;
  created_at: string;
}

export function useLossReasons() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["loss_reasons", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("loss_reasons")
        .select("*")
        .order("display_order");
      if (error) throw error;
      return data as LossReason[];
    },
    enabled: !!organizationId,
  });
}

export function useCreateLossReason() {
  const qc = useQueryClient();
  const { organizationId } = useAuth();
  return useMutation({
    mutationFn: async (input: { name: string; slug: string; category?: string }) => {
      const { data, error } = await (supabase.from as any)("loss_reasons")
        .insert({ ...input, organization_id: organizationId })
        .select()
        .single();
      if (error) throw error;
      return data as LossReason;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loss_reasons"] }),
  });
}

export function useDeleteLossReason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)("loss_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loss_reasons"] }),
  });
}
