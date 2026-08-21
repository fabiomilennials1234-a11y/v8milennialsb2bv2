/**
 * Hook da integração com o ERP Toth (camada multi-ERP provider-neutral, ADR-0020).
 *
 * - Status:      query direta a toth_connections (RLS: membro lê a própria org)
 * - Connect:     Edge Function toth-connect (faz login real antes de gravar)
 * - Disconnect:  Edge Function toth-disconnect (apaga o segredo, não só o status)
 * - Sync:        toth-sync-clientes e toth-sync-cobrancas
 * - Sync mode:   update direto (RLS: admin da org)
 *
 * Usuário e senha nunca voltam ao navegador — ficam no cofre deny-all
 * `toth_connection_secrets`, acessível só por service_role. O que o status
 * devolve é configuração: endereço, transporte do token e o aceite de tráfego
 * sem TLS.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";
import { tothConnectionsTable, type TothConnectionRow } from "../lib/toth-table";

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

// ─── Types ──────────────────────────────────────────────────────────────────

export type TothSyncMode = "off" | "enrich_only" | "canonical";
export type TothTokenTransport = "query" | "header";

export interface TothConnectionStatus {
  connected: boolean;
  base_url: string | null;
  token_transport: TothTokenTransport;
  /** Conexão trafega sem TLS — a tela mantém o aviso enquanto for verdade. */
  insecure_transport: boolean;
  connected_at: string | null;
  erp_sync_mode: TothSyncMode;
  /** Janela em dias que define cliente ativo. null = base inteira. */
  clientes_dias_compras: number | null;
  /**
   * Empresa do grupo a sincronizar. O Toth devolve as empresas do grupo na
   * mesma resposta e não aceita filtro por empresa — separar é trabalho nosso.
   * null = trazer todas.
   */
  clientes_empresa: string | null;
  /** Trazer também quem não tem atendimento em empresa nenhuma. */
  clientes_incluir_sem_empresa: boolean;
  last_clientes_sync_at: string | null;
  last_cobrancas_sync_at: string | null;
  last_error: string | null;
}

const DISCONNECTED: TothConnectionStatus = {
  connected: false,
  base_url: null,
  token_transport: "query",
  insecure_transport: false,
  connected_at: null,
  erp_sync_mode: "enrich_only",
  clientes_dias_compras: null,
  clientes_empresa: null,
  clientes_incluir_sem_empresa: false,
  last_clientes_sync_at: null,
  last_cobrancas_sync_at: null,
  last_error: null,
};

// ─── Status ─────────────────────────────────────────────────────────────────

export function useTothStatus() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["toth-status", organizationId],
    queryFn: async (): Promise<TothConnectionStatus> => {
      if (!organizationId) return DISCONNECTED;

      const { data, error } = await tothConnectionsTable()
        .select(
          "base_url, token_transport, allow_insecure_transport, connected_at, status, erp_sync_mode, " +
            "clientes_dias_compras, clientes_empresa, clientes_incluir_sem_empresa, " +
            "last_clientes_sync_at, last_cobrancas_sync_at, last_error",
        )
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      const row = data as TothConnectionRow | null;
      if (!row || row.status !== "connected") return DISCONNECTED;

      const baseUrl = row.base_url ?? null;
      return {
        connected: true,
        base_url: baseUrl,
        token_transport: (row.token_transport as TothTokenTransport) ?? "query",
        // Deriva do endereço real, não só da coluna de aceite: o que importa
        // exibir é se o tráfego ESTÁ em claro agora, não se um dia foi aceito.
        insecure_transport: !!baseUrl && baseUrl.startsWith("http://"),
        connected_at: row.connected_at,
        erp_sync_mode: (row.erp_sync_mode as TothSyncMode) ?? "enrich_only",
        clientes_dias_compras: row.clientes_dias_compras ?? null,
        clientes_empresa: row.clientes_empresa ?? null,
        clientes_incluir_sem_empresa: row.clientes_incluir_sem_empresa === true,
        last_clientes_sync_at: row.last_clientes_sync_at,
        last_cobrancas_sync_at: row.last_cobrancas_sync_at,
        last_error: row.last_error,
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
  });
}

// ─── Connect ────────────────────────────────────────────────────────────────

export interface TothConnectInput {
  baseUrl: string;
  user: string;
  password: string;
  tokenTransport?: TothTokenTransport;
  /** Aceite explícito de tráfego sem TLS. */
  allowInsecureTransport?: boolean;
}

export function useConnectToth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TothConnectInput) => {
      const { data, error } = await supabase.functions.invoke("toth-connect", {
        body: {
          base_url: input.baseUrl,
          user: input.user,
          password: input.password,
          token_transport: input.tokenTransport ?? "query",
          allow_insecure_transport: input.allowInsecureTransport ?? false,
        },
      });
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; base_url: string; insecure_transport: boolean };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
      if (data?.insecure_transport) {
        toast.warning("Toth conectado sem criptografia", {
          description: "A senha do ERP trafega em texto claro. Peça HTTPS ao responsável pela rede.",
        });
      } else {
        toast.success("Toth conectado com sucesso!");
      }
    },
    onError: (error: Error) => {
      toast.error("Erro ao conectar o Toth", { description: error.message });
    },
  });
}

// ─── Disconnect ─────────────────────────────────────────────────────────────

export function useDisconnectToth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("toth-disconnect", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
      toast.success("Toth desconectado");
    },
    onError: (error: Error) => {
      toast.error("Erro ao desconectar", { description: error.message });
    },
  });
}

// ─── Sync ───────────────────────────────────────────────────────────────────

interface SyncClientesResult {
  success?: boolean;
  stop_reason?: string;
  stats?: { rows: number; created: number; enriched: number; failed: number };
  mapping_errors?: string[];
}

export function useSyncTothClientes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("toth-sync-clientes", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as SyncClientesResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
      const s = data?.stats;
      toast.success(
        s
          ? `Clientes: ${s.enriched} enriquecidos, ${s.created} criados`
          : "Sincronização concluída",
        // Linha que não pode sumir: registro que não mapeou não entrou, e sem
        // isso o número de sucesso parece cobertura total.
        s?.failed
          ? { description: `${s.failed} registro(s) sem identificador foram ignorados.` }
          : undefined,
      );
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar clientes", { description: error.message });
    },
  });
}

interface SyncCobrancasResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  hint?: string;
  truncated?: boolean;
  stats?: { clients: number; titulos: number; created: number; updated: number };
}

export function useSyncTothCobrancas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("toth-sync-cobrancas", {});
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as SyncCobrancasResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
      queryClient.invalidateQueries({ queryKey: ["titulos-receber"] });

      if (data?.skipped) {
        toast.info("Nenhuma cobrança buscada", {
          description: data.hint ?? "Sincronize os clientes primeiro.",
        });
        return;
      }
      const s = data?.stats;
      toast.success(
        s ? `Cobranças: ${s.created} novas, ${s.updated} atualizadas` : "Sincronização concluída",
        data?.truncated
          ? { description: "Teto de clientes por execução atingido — rode de novo para continuar." }
          : undefined,
      );
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar cobranças", { description: error.message });
    },
  });
}

// ─── Simulação (dry-run) ────────────────────────────────────────────────────

export interface TothDryRunResult {
  dry_run: true;
  escreveu: false;
  modo: TothSyncMode;
  janela_dias_compras: number | null;
  empresa: string | null;
  incluir_sem_empresa: boolean;
  /** Quem o filtro de empresa deixou de fora, e de quem eram. */
  fora_do_filtro_de_empresa: {
    total: number;
    sem_empresa: number;
    por_empresa: Record<string, number>;
  };
  linhas_recebidas: number;
  sem_identificador: number;
  totais: {
    mapped: number;
    wouldCreate: number;
    wouldEnrich: number;
    wouldSkip: number;
    withCnpj: number;
    withPhone: number;
    withEmail: number;
  };
  adocao_de_conversas: {
    mensagens: number;
    conversas: number;
    telefones_que_casariam: number;
  };
  amostra: Array<Record<string, unknown>>;
  erros_de_mapeamento: string[];
}

/**
 * Ensaio: lê do ERP, mapeia e relata **sem escrever nada**.
 *
 * Não invalida query alguma de propósito — nada mudou no banco, e invalidar
 * daria a impressão de que mudou.
 */
export function useSimulateTothClientes() {
  return useMutation({
    mutationFn: async (params?: { maxClients?: number }) => {
      const { data, error } = await supabase.functions.invoke("toth-sync-clientes", {
        body: {
          dry_run: true,
          ...(params?.maxClients ? { max_clients: params.maxClients } : {}),
        },
      });
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as TothDryRunResult;
    },
    onError: (error: Error) => {
      toast.error("Erro ao simular", { description: error.message });
    },
  });
}

// ─── Janela de cliente ativo ────────────────────────────────────────────────

/**
 * Grava a janela que define "cliente ativo" (vira `diasCompras` no ERP).
 *
 * Fica na conexão porque é regra de negócio da organização: precisa valer igual
 * no botão da tela e no cron. `null` traz a base inteira.
 */
export function useUpdateTothActiveWindow() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dias: number | null) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await tothConnectionsTable()
        .update({ clientes_dias_compras: dias })
        .eq("organization_id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao salvar a janela de cliente ativo", { description: error.message });
    },
  });
}

// ─── Empresa do grupo ───────────────────────────────────────────────────────

/**
 * Grava qual empresa do grupo a sincronização traz.
 *
 * O Toth devolve TODAS as empresas do grupo na mesma resposta de `/clientes` e
 * não aceita filtro por empresa — na base da Café Jurerê são quatro. Sem esta
 * escolha, a carteira de uma organização recebe cliente que é de outra empresa.
 *
 * `null` volta a trazer todas, que é o comportamento anterior.
 */
export function useUpdateTothEmpresa() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { empresa: string | null; incluirSemEmpresa: boolean }) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await tothConnectionsTable()
        .update({
          clientes_empresa: params.empresa,
          clientes_incluir_sem_empresa: params.incluirSemEmpresa,
        })
        .eq("organization_id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao salvar a empresa do grupo", { description: error.message });
    },
  });
}

// ─── Sync mode ──────────────────────────────────────────────────────────────

export function useUpdateTothSyncMode() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mode: TothSyncMode) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await tothConnectionsTable()
        .update({ erp_sync_mode: mode })
        .eq("organization_id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar modo de sincronização", { description: error.message });
    },
  });
}
