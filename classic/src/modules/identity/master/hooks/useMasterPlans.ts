/**
 * useMasterPlans — hook de CRUD para subscription_plans no contexto Master.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Plan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  // Legacy pricing (kept for backward compat)
  price_monthly: number;
  price_yearly: number;
  // New Torque pricing model
  price_per_user_monthly: number | null;
  base_price_monthly: number | null;
  min_users: number;
  included_users: number;
  included_copilots: number;
  extra_user_price: number;
  // Discounts
  discount_semester_pct: number;
  discount_annual_pct: number;
  discount_volume_pct: number;
  discount_volume_min: number;
  // Features & limits
  features: Record<string, boolean>;
  limits: Record<string, number>;
  is_active: boolean;
  is_default: boolean;
  position: number;
}

const QUERY_KEY = ["master-plans"];

export function useMasterPlans() {
  return useQuery<Plan[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("position");
      if (error) throw error;
      return data as unknown as Plan[];
    },
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Partial<Plan> & { id: string }) => {
      const { id, ...rest } = payload;
      const { error } = await supabase
        .from("subscription_plans")
        .update(rest as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Plano atualizado!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao atualizar plano");
    },
  });
}
