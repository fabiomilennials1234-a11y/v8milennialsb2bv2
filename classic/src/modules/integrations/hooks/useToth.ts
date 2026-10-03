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
   * Códigos de marca repassados ao ERP (ex.: "1,2,3,4,5,6").
   *
   * 🔑 É o que LIGA a janela de dias: medido em 25/08, `diasCompras=60` sozinho
   * devolve 12.633 clientes (a base inteira) e, acompanhado das marcas, devolve
   * 550. Sem marcas, a janela é decorativa.
   */
  clientes_marcas: string | null;
  /** Deixar de fora quem nunca faturou nada (sem data de último pedido). */
  clientes_somente_com_compra: boolean;
  /**
   * Empresa do grupo a sincronizar. O Toth devolve as empresas do grupo na
   * mesma resposta e não aceita filtro por empresa — separar é trabalho nosso.
   * null = trazer todas.
   */
  clientes_empresa: string | null;
  /** Trazer também quem não tem atendimento em empresa nenhuma. */
  clientes_incluir_sem_empresa: boolean;
  /**
   * Endereço do serviço **Flow** (pedidos). `null` = não configurado.
   *
   * 🔴 É outro servidor, não outro caminho do mesmo: porta 3000, login por
   * `client_id`/`client_secret`, token em Bearer e leitura por POST JSON.
   * Tratar como "o `/pedidos` do Toth" foi o que manteve a sincronização
   * batendo num 404 que nenhum ajuste nosso resolveria.
   */
  flow_base_url: string | null;
  /** Dias relidos a cada sincronização de pedidos. null = padrão do servidor. */
  pedidos_janela_dias: number | null;
  /** Piso do backfill de pedidos (`aaaa-mm-dd`). Vence a janela enquanto existir. */
  pedidos_data_inicial: string | null;
  last_clientes_sync_at: string | null;
  last_cobrancas_sync_at: string | null;
  last_pedidos_sync_at: string | null;
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
  clientes_marcas: null,
  clientes_somente_com_compra: false,
  clientes_empresa: null,
  clientes_incluir_sem_empresa: false,
  flow_base_url: null,
  pedidos_janela_dias: null,
  pedidos_data_inicial: null,
  last_clientes_sync_at: null,
  last_cobrancas_sync_at: null,
  last_pedidos_sync_at: null,
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
            "clientes_dias_compras, clientes_marcas, clientes_somente_com_compra, " +
            "clientes_empresa, clientes_incluir_sem_empresa, " +
            "flow_base_url, pedidos_janela_dias, pedidos_data_inicial, " +
            "last_clientes_sync_at, last_cobrancas_sync_at, last_pedidos_sync_at, last_error",
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
        clientes_marcas: row.clientes_marcas ?? null,
        clientes_somente_com_compra: row.clientes_somente_com_compra === true,
        clientes_empresa: row.clientes_empresa ?? null,
        clientes_incluir_sem_empresa: row.clientes_incluir_sem_empresa === true,
        flow_base_url: row.flow_base_url ?? null,
        pedidos_janela_dias: row.pedidos_janela_dias ?? null,
        pedidos_data_inicial: row.pedidos_data_inicial ?? null,
        last_clientes_sync_at: row.last_clientes_sync_at,
        last_cobrancas_sync_at: row.last_cobrancas_sync_at,
        last_pedidos_sync_at: row.last_pedidos_sync_at ?? null,
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
  /**
   * Serviço de pedidos (Flow). Opcional, mas **tudo ou nada**: os três juntos
   * ou nenhum. O servidor recusa meio par — configuração pela metade produz
   * uma tela que diz "pedidos ligados" e uma sincronização que falha calada.
   */
  flowBaseUrl?: string;
  flowClientId?: string;
  flowClientSecret?: string;
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
          ...(input.flowBaseUrl
            ? {
                flow_base_url: input.flowBaseUrl,
                flow_client_id: input.flowClientId ?? "",
                flow_client_secret: input.flowClientSecret ?? "",
              }
            : {}),
        },
      });
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.error);
      return data as {
        success: boolean;
        base_url: string;
        flow_base_url: string | null;
        insecure_transport: boolean;
      };
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

// ─── Pedidos ────────────────────────────────────────────────────────────────

export interface SyncPedidosResult {
  success?: boolean;
  stats?: {
    pages: number;
    rows: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    items: number;
    clientNotSynced: number;
    pending: number;
  };
  incompleto?: boolean;
  /** Intervalo efetivamente pedido ao serviço — a resposta não deixa deduzir. */
  janela?: { dataInicial: string; dataFinal: string; origem: string; dias: number };
  documentos_filtrados?: number;
  /** O host aceitou a conexão e fechou sem responder — publicação, não credencial. */
  servico_mudo?: boolean;
  /** A org não tem o serviço Flow configurado. */
  nao_configurado?: boolean;
  hint?: string;
  skipped?: boolean;
}

export interface SyncPedidosInput {
  /** Sobrepõem a janela configurada. `aaaa-mm-dd`. */
  dataInicial?: string;
  dataFinal?: string;
  /** Restringe a chamada a estes documentos. Vazio = sem filtro. */
  numeroInscricao?: string[];
  /** Lê e relata sem escrever. */
  dryRun?: boolean;
}

/**
 * Puxa os pedidos de venda do serviço **Flow**.
 *
 * 🔴 Serviço separado do `/toth/services` — outra porta, outra credencial. A
 * chamada exige janela de datas; sem configuração, o servidor usa 90 dias.
 *
 * ⚠️ Nunca exercitado contra o serviço real: em 28/08 a porta 3000 aceita a
 * conexão e fecha sem responder de fora da rede do cliente. Enquanto isso,
 * `servico_mudo` é a resposta esperada — e ela aponta para a GON, não para a
 * credencial.
 */
export function useSyncTothPedidos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SyncPedidosInput = {}) => {
      const { data, error } = await supabase.functions.invoke("toth-sync-pedidos", {
        body: {
          ...(input.dataInicial ? { data_inicial: input.dataInicial } : {}),
          ...(input.dataFinal ? { data_final: input.dataFinal } : {}),
          ...(input.numeroInscricao?.length
            ? { numero_inscricao: input.numeroInscricao }
            : {}),
          ...(input.dryRun ? { dry_run: true } : {}),
        },
      });
      if (error) throw await extractFunctionError(error);
      if (data?.error) throw new Error(data.hint ? `${data.error} ${data.hint}` : data.error);
      return data as SyncPedidosResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["toth-status"] });
      // Pedido do ERP entra na Carteira: a lista de pedidos e a saúde do
      // cliente derivam dele.
      queryClient.invalidateQueries({ queryKey: ["upsell-orders"] });
      queryClient.invalidateQueries({ queryKey: ["upsell-clients"] });

      const s = data?.stats;
      toast.success(
        s ? `Pedidos: ${s.created} novos, ${s.updated} atualizados` : "Sincronização concluída",
        data?.incompleto
          ? { description: "Teto de páginas por execução atingido — rode de novo para continuar." }
          : s?.clientNotSynced
            ? {
                description: `${s.clientNotSynced} pedido(s) de cliente fora da carteira — confira o recorte de marcas e empresa.`,
              }
            : undefined,
      );
    },
    onError: (error: Error) => {
      toast.error("Erro ao sincronizar pedidos", { description: error.message });
    },
  });
}

// ─── Simulação (dry-run) ────────────────────────────────────────────────────

export interface TothDryRunResult {
  dry_run: true;
  escreveu: false;
  modo: TothSyncMode;
  janela_dias_compras: number | null;
  marcas: string | null;
  /** Janela gravada sem marcas: o ERP devolve a base inteira mesmo assim. */
  janela_inerte: boolean;
  somente_com_compra: boolean;
  /** Clientes sem data de último pedido faturado — recebidos e descartados. */
  sem_ultima_compra: { recebidos: number; descartados: number };
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
 * Grava o recorte de cliente ativo: janela em dias, marcas e o corte estrito de
 * quem já faturou.
 *
 * Os três andam juntos porque **a janela sozinha não filtra nada**. Medido
 * contra o ERP em 25/08: `diasCompras=60` sem `marcas` devolve a base inteira
 * (12.633); com as seis marcas, devolve 550. Salvar em chamadas separadas
 * deixaria a tela num estado em que o número está gravado e não vale.
 *
 * Fica na conexão porque é regra de negócio da organização: precisa valer igual
 * no botão da tela e no cron.
 */
export interface TothActiveWindowInput {
  /** Janela em dias. `null` traz a base inteira. */
  dias: number | null;
  /** Códigos de marca, separados por vírgula. `null` não manda o parâmetro. */
  marcas: string | null;
  /** Deixar de fora quem não tem último pedido faturado. */
  somenteComCompra: boolean;
}

export function useUpdateTothActiveWindow() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TothActiveWindowInput) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await tothConnectionsTable()
        .update({
          clientes_dias_compras: input.dias,
          clientes_marcas: input.marcas,
          clientes_somente_com_compra: input.somenteComCompra,
        })
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
