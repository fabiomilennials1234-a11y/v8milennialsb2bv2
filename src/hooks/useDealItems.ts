import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface DealItem {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  total: number;
  sort_order: number;
  notes: string | null;
}

export function useDealItems(dealId: string | null) {
  return useQuery<DealItem[]>({
    queryKey: ["deal-items", dealId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("deal_items")
        .select("*")
        .eq("deal_id", dealId!)
        .order("sort_order");
      if (error) throw error;
      return data as DealItem[];
    },
    enabled: !!dealId,
  });
}

export function useAddDealItem() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      product_id?: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      discount_percent?: number;
    }) => {
      const { data, error } = await (supabase.from as any)("deal_items")
        .insert({
          organization_id: organization!.id,
          deal_id: input.deal_id,
          product_id: input.product_id ?? null,
          product_name: input.product_name,
          quantity: input.quantity,
          unit_price: input.unit_price,
          discount_percent: input.discount_percent ?? 0,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", vars.deal_id] });
    },
  });
}

export function useUpdateDealItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, deal_id, ...updates }: Partial<DealItem> & { id: string; deal_id: string }) => {
      const { error } = await (supabase.from as any)("deal_items")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", vars.deal_id] });
    },
  });
}

export function useDeleteDealItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, deal_id }: { id: string; deal_id: string }) => {
      const { error } = await (supabase.from as any)("deal_items")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["deal-items", vars.deal_id] });
    },
  });
}
