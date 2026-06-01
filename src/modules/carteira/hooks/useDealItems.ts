import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DealItemRow } from "./useDeals";

export type DealItemInsert = {
  deal_id: string;
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  sort_order?: number;
  notes?: string | null;
  organization_id: string;
};

export type DealItemUpdate = Partial<Omit<DealItemInsert, "deal_id" | "organization_id">> & { id: string };

export function useDealItems(dealId: string | null) {
  return useQuery({
    queryKey: ["deal-items", dealId],
    queryFn: async () => {
      if (!dealId) return [];
      const { data, error } = await supabase
        .from("deal_items")
        .select("*")
        .eq("deal_id", dealId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DealItemRow[];
    },
    enabled: !!dealId,
  });
}

export function useCreateDealItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: DealItemInsert) => {
      const { data, error } = await supabase
        .from("deal_items")
        .insert(item)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", variables.deal_id] });
      queryClient.invalidateQueries({ queryKey: ["deal", variables.deal_id] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao adicionar produto: ${error.message}`);
    },
  });
}

export function useUpdateDealItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: DealItemUpdate) => {
      const { data, error } = await supabase
        .from("deal_items")
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", data.deal_id] });
      queryClient.invalidateQueries({ queryKey: ["deal", data.deal_id] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
    },
  });
}

export function useDeleteDealItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dealId }: { id: string; dealId: string }) => {
      const { error } = await supabase.from("deal_items").delete().eq("id", id);
      if (error) throw error;
      return { dealId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", result.dealId] });
      queryClient.invalidateQueries({ queryKey: ["deal", result.dealId] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
    },
  });
}
