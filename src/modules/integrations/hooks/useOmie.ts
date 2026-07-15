/**
 * Hook para integração com o ERP Omie (camada multi-ERP provider-neutral, ADR-0020).
 *
 * - Status:      query direta a omie_connections (RLS: membro lê a própria org)
 * - Connect:     Edge Function omie-connect (valida app_key/app_secret na Omie)
 * - Disconnect:  Edge Function omie-disconnect
 * - Sync mode:   update direto (RLS: admin da org)
 *
 * Os segredos (app_key/app_secret) nunca trafegam de volta ao cliente — ficam no
 * cofre deny-all omie_connection_secrets, acessível só por service_role.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";

/** Extrai a mensagem real de erro do corpo de uma FunctionsHttpError. */
async function extractFunctionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return new Error(body.error);
    } catch {
      try {
        const text = await error.context.text();
        if (text) return new Error(text);
      } catch {
        /* ignore */
      }
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

// ─── Types ────────────────────────────────────────────────────────────────

export type OmieSyncMode = "off" | "enrich_only" | "canonical";

export interface OmieConnectionStatus {
  connected: boolean;
  account_name: string | null;
  connected_at: string | null;
  erp_sync_mode: OmieSyncMode;
  last_clientes_sync_at: string | null;
  last_pedidos_sync_at: string | null;
  last_financeiro_sync_at: string | null;
  last_error: string | null;
}

const DISCONNECTED: OmieConnectionStatus = {
  connected: false,
  account_name: null,
  connected_at: null,
  erp_sync_mode: "enrich_only",
  last_clientes_sync_at: null,
  last_pedidos_sync_at: null,
  last_financeiro_sync_at: null,
  last_error: null,
};

// ─── Status ─────────────────────────────────────────────────────────────────

export function useOmieStatus() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["omie-status", organizationId],
    queryFn: async (): Promise<OmieConnectionStatus> => {
      if (!organizationId) return DISCONNECTED;

      const { data, error } = await supabase
        .from("omie_connections")
        .select(
          "omie_account_name, connected_at, status, erp_sync_mode, last_clientes_sync_at, last_pedidos_sync_at, last_financeiro_sync_at, last_error",
        )
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      if (!data || data.status !== "connected") return DISCONNECTED;

      return {
        connected: true,
        account_name: data.omie_account_name,
        connected_at: data.connected_at,
        erp_sync_mode: (data.erp_sync_mode as OmieSyncMode) ?? "enrich_only",
        last_clientes_sync_at: data.last_clientes_sync_at,
        last_pedidos_sync_at: data.last_pedidos_sync_at,
        last_financeiro_sync_at: data.last_financeiro_sync_at,
        last_error: data.last_error,
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
  });
}

// ─── Connect ────────────────────────────────────────────────────────────────

export function useConnectOmie() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (creds: { appKey: string; appSecret: string }) => {
      const { data, error } = await supabase.functions.invoke("omie-connect", {
        body: { app_key: creds.appKey, app_secret: creds.appSecret },
      });
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["omie-status"] });
      toast.success("Omie conectado com sucesso!");
    },
    onError: (error: Error) => {
      toast.error("Erro ao conectar o Omie", { description: error.message });
    },
  });
}

// ─── Disconnect ─────────────────────────────────────────────────────────────

export function useDisconnectOmie() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-disconnect", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["omie-status"] });
      toast.success("Omie desconectado");
    },
    onError: (error: Error) => {
      toast.error("Erro ao desconectar", { description: error.message });
    },
  });
}

// ─── Sync mode ────────────────────────────────────────────────────────────────

// ─── Sync clientes (on-demand) ──────────────────────────────────────────────

export function useSyncOmieClientes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-sync-clientes", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as { ok: boolean; stats?: { enriched: number; created: number; seen: number } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["omie-status"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
      const s = data?.stats;
      if (s) {
        toast.success(
          `Clientes sincronizados: ${s.enriched} enriquecidos, ${s.created} criados`,
        );
      } else {
        toast.success("Sincronização concluída");
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar clientes", { description: error.message });
    },
  });
}

export function useSyncOmiePedidos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-sync-pedidos", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as { ok: boolean; stats?: { created: number; updated: number } };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["omie-status"] });
      queryClient.invalidateQueries({ queryKey: ["upsell-orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
      const s = data?.stats;
      if (s) {
        toast.success(`Pedidos sincronizados: ${s.created} novos, ${s.updated} atualizados`);
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar pedidos", { description: error.message });
    },
  });
}

export function useUpdateOmieSyncMode() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mode: OmieSyncMode) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await supabase
        .from("omie_connections")
        .update({ erp_sync_mode: mode })
        .eq("organization_id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["omie-status"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar modo de sincronização", { description: error.message });
    },
  });
}
