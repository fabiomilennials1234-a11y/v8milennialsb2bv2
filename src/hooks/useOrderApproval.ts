import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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

export interface PendingOrdersResponse {
  rows: PendingOrder[];
  total: number;
  total_value: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function usePendingOrders(page = 1, pageSize = 20) {
  const { organizationId } = useOrganization();

  return useQuery<PendingOrdersResponse>({
    queryKey: ["pending-orders", organizationId, { page, pageSize }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pending_orders", {
        p_org_id: organizationId!,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as PendingOrdersResponse;
    },
    enabled: !!organizationId,
    placeholderData: keepPreviousData,
  });
}

export function usePendingOrdersCount() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["pending-orders-count", organizationId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("upsell_orders")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!)
        .eq("approval_status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });
}

function useInvalidateApproval() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return () => {
    queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["pending-orders-count", organizationId] });
    queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
  };
}

export function useApproveOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const invalidate = useInvalidateApproval();

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
    onMutate: async ({ orderId }) => {
      await queryClient.cancelQueries({ queryKey: ["pending-orders", organizationId] });
      const queries = queryClient.getQueriesData<PendingOrdersResponse>({
        queryKey: ["pending-orders", organizationId],
      });
      for (const [key, data] of queries) {
        if (data) {
          queryClient.setQueryData<PendingOrdersResponse>(key, {
            ...data,
            rows: data.rows.filter((o) => o.id !== orderId),
            total: data.total - 1,
            total_value: data.total_value - (data.rows.find((o) => o.id === orderId)?.sale_value ?? 0),
          });
        }
      }
      return { queries };
    },
    onError: (_err, _vars, context) => {
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Erro ao aprovar pedido");
    },
    onSuccess: () => {
      toast.success("Pedido aprovado");
    },
    onSettled: invalidate,
  });
}

export function useRejectOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const invalidate = useInvalidateApproval();

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
    onMutate: async ({ orderId }) => {
      await queryClient.cancelQueries({ queryKey: ["pending-orders", organizationId] });
      const queries = queryClient.getQueriesData<PendingOrdersResponse>({
        queryKey: ["pending-orders", organizationId],
      });
      for (const [key, data] of queries) {
        if (data) {
          queryClient.setQueryData<PendingOrdersResponse>(key, {
            ...data,
            rows: data.rows.filter((o) => o.id !== orderId),
            total: data.total - 1,
            total_value: data.total_value - (data.rows.find((o) => o.id === orderId)?.sale_value ?? 0),
          });
        }
      }
      return { queries };
    },
    onError: (_err, _vars, context) => {
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Erro ao rejeitar pedido");
    },
    onSuccess: () => {
      toast.success("Pedido rejeitado");
    },
    onSettled: invalidate,
  });
}

export function useBulkApproveOrders() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const invalidate = useInvalidateApproval();

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
    onMutate: async ({ orderIds }) => {
      await queryClient.cancelQueries({ queryKey: ["pending-orders", organizationId] });
      const queries = queryClient.getQueriesData<PendingOrdersResponse>({
        queryKey: ["pending-orders", organizationId],
      });
      const idSet = new Set(orderIds);
      for (const [key, data] of queries) {
        if (data) {
          const removedValue = data.rows
            .filter((o) => idSet.has(o.id))
            .reduce((s, o) => s + o.sale_value, 0);
          queryClient.setQueryData<PendingOrdersResponse>(key, {
            ...data,
            rows: data.rows.filter((o) => !idSet.has(o.id)),
            total: data.total - orderIds.length,
            total_value: data.total_value - removedValue,
          });
        }
      }
      return { queries };
    },
    onError: (_err, _vars, context) => {
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
      toast.error("Erro ao aprovar pedidos");
    },
    onSuccess: (_, vars) => {
      toast.success(`${vars.orderIds.length} pedidos aprovados`);
    },
    onSettled: invalidate,
  });
}
