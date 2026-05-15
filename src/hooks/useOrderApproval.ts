import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PendingOrder {
  id: string;
  client_id: string;
  client_name: string;
  client_company: string | null;
  product_name: string;
  sale_value: number;
  source: string | null;
  sold_at: string;
  created_at: string;
  items: {
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    unit: string;
  }[];
}

export function usePendingOrders() {
  const { organizationId } = useOrganization();

  return useQuery<PendingOrder[]>({
    queryKey: ["pending-orders", organizationId],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("upsell_orders")
        .select(`
          id, client_id, product_name, sale_value, source, sold_at, created_at,
          upsell_clients!inner(name, company)
        `)
        .eq("organization_id", organizationId!)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const orderIds = (orders ?? []).map((o: any) => o.id);
      let itemsMap: Record<string, any[]> = {};

      if (orderIds.length > 0) {
        const { data: items } = await supabase
          .from("client_purchase_items")
          .select("id, order_id, product_name, quantity, unit_price, unit")
          .in("order_id", orderIds);

        for (const item of items ?? []) {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push(item);
        }
      }

      return (orders ?? []).map((o: any) => ({
        id: o.id,
        client_id: o.client_id,
        client_name: o.upsell_clients.name,
        client_company: o.upsell_clients.company,
        product_name: o.product_name,
        sale_value: o.sale_value,
        source: o.source,
        sold_at: o.sold_at,
        created_at: o.created_at,
        items: itemsMap[o.id] ?? [],
      }));
    },
    enabled: !!organizationId,
  });
}

export function useApproveOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "approved",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido aprovado");
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}

export function useRejectOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderId, comment }: { orderId: string; comment?: string }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "rejected",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
          approval_comment: comment ?? null,
        })
        .eq("id", orderId)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido rejeitado");
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}

export function useBulkApproveOrders() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "approved",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .in("id", orderIds)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(`${vars.orderIds.length} pedidos aprovados`);
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}
