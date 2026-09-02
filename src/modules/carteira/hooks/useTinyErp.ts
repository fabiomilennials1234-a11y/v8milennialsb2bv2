/**
 * Hook para integração com TinyERP
 *
 * - Status:       query direta ao banco (tinyerp_connections)
 * - Connect:      Edge Function tinyerp-connect
 * - Disconnect:   Edge Function tinyerp-disconnect
 * - Sync:         Edge Function tinyerp-sync-products
 * - Push Order:   Edge Function tinyerp-push-order
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";
import { invalidateProductQueries } from "./useProducts";

/**
 * Extracts the actual error message from a Supabase FunctionsHttpError.
 * The default message is generic ("Edge Function returned a non-2xx status code"),
 * but the real error is in the response body.
 */
async function extractFunctionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return new Error(body.error);
    } catch {
      // Response body not JSON — try text
      try {
        const text = await error.context.text();
        if (text) return new Error(text);
      } catch {}
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TinyErpConnectionStatus {
  connected: boolean;
  account_name: string | null;
  cnpj: string | null;
  connected_at: string | null;
  auto_sync_products: boolean;
  auto_push_orders: boolean;
  last_product_sync_at: string | null;
  last_error: string | null;
}

export interface TinyErpSyncLog {
  id: string;
  operation: string;
  status: string;
  error_message: string | null;
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_failed: number;
  initiated_by: string;
  created_at: string;
}

// ─── Status ─────────────────────────────────────────────────────────────────

export function useTinyErpStatus() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["tinyerp-status", organizationId],
    queryFn: async (): Promise<TinyErpConnectionStatus> => {
      if (!organizationId) {
        return { connected: false, account_name: null, cnpj: null, connected_at: null, auto_sync_products: false, auto_push_orders: false, last_product_sync_at: null, last_error: null };
      }

      const { data, error } = await supabase
        .from("tinyerp_connections")
        .select("tiny_account_name, tiny_cnpj, connected_at, status, auto_sync_products, auto_push_orders, last_product_sync_at, last_error")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;

      if (!data || data.status !== "connected") {
        return { connected: false, account_name: null, cnpj: null, connected_at: null, auto_sync_products: false, auto_push_orders: false, last_product_sync_at: null, last_error: null };
      }

      return {
        connected: true,
        account_name: data.tiny_account_name,
        cnpj: data.tiny_cnpj,
        connected_at: data.connected_at,
        auto_sync_products: data.auto_sync_products ?? false,
        auto_push_orders: data.auto_push_orders ?? false,
        last_product_sync_at: data.last_product_sync_at,
        last_error: data.last_error,
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
  });
}

// ─── Connect ────────────────────────────────────────────────────────────────

export function useConnectTinyErp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (apiToken: string) => {
      const { data, error } = await supabase.functions.invoke("tinyerp-connect", {
        body: { api_token: apiToken },
      });

      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tinyerp-status"] });
      toast.success("TinyERP conectado com sucesso!");
    },
    onError: (error: Error) => {
      toast.error("Erro ao conectar TinyERP", { description: error.message });
    },
  });
}

// ─── Disconnect ─────────────────────────────────────────────────────────────

export function useDisconnectTinyErp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("tinyerp-disconnect", {});

      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tinyerp-status"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
      toast.success("TinyERP desconectado");
    },
    onError: (error: Error) => {
      toast.error("Erro ao desconectar", { description: error.message });
    },
  });
}

// ─── Sync Products ──────────────────────────────────────────────────────────

export function useTinyErpSyncProducts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("tinyerp-sync-products", {});

      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      invalidateProductQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["tinyerp-status"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
      const created = data?.items_created || 0;
      const updated = data?.items_updated || 0;
      toast.success(`Produtos sincronizados: ${created} criados, ${updated} atualizados`);
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar produtos", { description: error.message });
    },
  });
}

// ─── Push Order ─────────────────────────────────────────────────────────────

export function useTinyErpPushOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pipePropostaId: string) => {
      const { data, error } = await supabase.functions.invoke("tinyerp-push-order", {
        body: { pipe_proposta_id: pipePropostaId },
      });

      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mappings"] });
      toast.success("Pedido enviado para o TinyERP!");
    },
    onError: (error: Error) => {
      toast.error("Erro ao enviar pedido", { description: error.message });
    },
  });
}

// ─── Sync Logs ──────────────────────────────────────────────────────────────

export function useTinyErpSyncLogs(limit = 20) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["tinyerp-sync-logs", organizationId, limit],
    queryFn: async (): Promise<TinyErpSyncLog[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("tinyerp_sync_logs")
        .select("id, operation, status, error_message, items_processed, items_created, items_updated, items_failed, initiated_by, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    },
    enabled: isReady && !!organizationId,
  });
}

// ─── Update Settings ────────────────────────────────────────────────────────

export function useUpdateTinyErpSettings() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: { auto_sync_products?: boolean; auto_push_orders?: boolean }) => {
      if (!organizationId) throw new Error("Sem organização");

      const { error } = await supabase
        .from("tinyerp_connections")
        .update(settings)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tinyerp-status"] });
    },
  });
}

// ─── Order Mapping ───────────────────────────────────────────────────────────

export function useTinyErpOrderMapping(pipePropostaId: string | null) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["tinyerp-order-mapping", pipePropostaId],
    queryFn: async () => {
      if (!pipePropostaId || !organizationId) return null;

      const { data, error } = await supabase
        .from("tinyerp_order_mappings")
        .select("tiny_order_id, tiny_order_number, tiny_nfe_id, tiny_nfe_status, last_synced_at, nfe_link, nfe_numero, nfe_chave, nfe_status, nfe_updated_at")
        .eq("pipe_proposta_id", pipePropostaId)
        .maybeSingle();

      if (error) return null;
      return data;
    },
    enabled: !!pipePropostaId && !!organizationId,
  });
}

// ─── Fetch NF-e (manual trigger) ─────────────────────────────────────────────

export function useTinyErpFetchNfe() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tinyOrderId, idNotaFiscal }: { tinyOrderId: string; idNotaFiscal?: string }) => {
      if (!organizationId) throw new Error("Sem organização");

      const { data, error } = await supabase.functions.invoke("tinyerp-fetch-nfe", {
        body: {
          organizationId,
          tinyOrderId,
          idNotaFiscal: idNotaFiscal || tinyOrderId,
        },
      });

      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mapping"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });
      if (data?.nfe_link) {
        toast.success("NF-e encontrada!", { description: `NF-e #${data.nfe_numero || ""}` });
      } else {
        toast.info("NF-e ainda não disponível", { description: "Tente novamente mais tarde" });
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao buscar NF-e", { description: error.message });
    },
  });
}
