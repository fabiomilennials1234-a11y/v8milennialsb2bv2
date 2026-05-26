import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";

export interface LeadProduct {
  id: string;
  lead_id: string;
  product_id: string;
  organization_id: string;
  source: "deal" | "manual";
  source_deal_id: string | null;
  quantity_total: number;
  revenue_total: number;
  first_purchased_at: string | null;
  last_purchased_at: string | null;
  purchase_count: number;
  avg_cycle_days: number | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  product?: { id: string; name: string; type: string; ticket: number | null } | null;
}

export function useLeadProducts(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-products", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("lead_products")
        .select(`
          *,
          product:products!product_id(id, name, type, ticket)
        `)
        .eq("lead_id", leadId)
        .order("last_purchased_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as LeadProduct[];
    },
    enabled: !!leadId,
  });
}

export function useAddLeadProduct() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      leadId,
      productId,
      quantity,
      value,
    }: {
      leadId: string;
      productId: string;
      productName: string;
      quantity?: number;
      value?: number;
    }) => {
      if (!organizationId) throw new Error("Org not ready");

      const { data, error } = await supabase
        .from("lead_products")
        .upsert(
          {
            lead_id: leadId,
            product_id: productId,
            organization_id: organizationId,
            source: "manual",
            quantity_total: quantity ?? 0,
            revenue_total: value ?? 0,
            purchase_count: 1,
            first_purchased_at: new Date().toISOString(),
            last_purchased_at: new Date().toISOString(),
            status: "active",
          },
          { onConflict: "lead_id,product_id,organization_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_: unknown, variables: { leadId: string; productId: string; productName: string; quantity?: number; value?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["lead-products", variables.leadId] });
      toast.success("Produto vinculado ao lead");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao vincular produto: ${error.message}`);
    },
  });
}

export function useUpdateLeadProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, leadId, status }: { id: string; leadId: string; status: "active" | "inactive" }) => {
      const { error } = await supabase
        .from("lead_products")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      return { leadId };
    },
    onSuccess: (result: { leadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["lead-products", result.leadId] });
    },
  });
}

export function useRemoveLeadProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, leadId }: { id: string; leadId: string }) => {
      const { error } = await supabase.from("lead_products").delete().eq("id", id);
      if (error) throw error;
      return { leadId };
    },
    onSuccess: (result: { leadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["lead-products", result.leadId] });
      toast.success("Produto removido do lead");
    },
  });
}
