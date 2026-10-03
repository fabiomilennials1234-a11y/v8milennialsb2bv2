/**
 * ERP provider capability resolution (S6, ADR-0020) — pure, no React.
 *
 * The frontend twin of the backend ERPProvider contract: a fine-grained,
 * UI-action capability manifest per provider, plus a resolver that picks the
 * org's active ERP from the two connection statuses and exposes a `can()` gate.
 * Surfaces render off `can(capability)`, so a provider that doesn't support a
 * feature simply hides it — no runtime failures, no dead buttons.
 */

import type { OmieSyncMode } from "../hooks/useOmie";

export type ErpProviderId = "omie" | "toth" | "tiny";

export interface ErpCapabilities {
  /** Push a closed sale INTO the ERP. */
  pushOrder: boolean;
  /** Pull the product catalog FROM the ERP. */
  syncProducts: boolean;
  /** Retrieve NF-e for an order. */
  fetchNfe: boolean;
  /** Pull/enrich Carteira clients. */
  syncClientes: boolean;
  /** Pull pedidos into upsell_orders. */
  syncPedidos: boolean;
  /** ERP is the source of truth for client fields (derived from sync mode). */
  canonicalMode: boolean;
  /** Títulos / contas a receber — declared false today; flips in S8/S9. */
  receivables: boolean;
}

// Static per-provider caps, grounded in the frontend hooks that exist TODAY.
// canonicalMode + receivables are overridden at resolve time.
export const TINY_CAPABILITIES: ErpCapabilities = {
  pushOrder: true, // useTinyErpPushOrder → tinyerp-push-order
  syncProducts: true, // useTinyErpSyncProducts → tinyerp-sync-products
  fetchNfe: true, // useTinyErpFetchNfe → tinyerp-fetch-nfe (read)
  syncClientes: false, // contact sync is cron-only, no user-facing hook
  syncPedidos: false, // order pull is cron-only, no user-facing hook
  canonicalMode: false, // Tiny has no erp_sync_mode
  receivables: false,
};

export const OMIE_CAPABILITIES: ErpCapabilities = {
  pushOrder: false, // Omie is pull-dominant today
  syncProducts: false, // S12
  fetchNfe: false, // S7
  syncClientes: true, // useSyncOmieClientes → omie-sync-clientes
  syncPedidos: true, // useSyncOmiePedidos → omie-sync-pedidos
  canonicalMode: false, // derived from erp_sync_mode below
  receivables: false, // S8/S9
};

/**
 * Toth (SCRUM-229) — ERP on-premise. É o PRIMEIRO provider com `receivables`
 * de verdade: `POST /cobrancas` existe e `toth-sync-cobrancas` grava em
 * `titulos_receber`. Os outros dois declaram false porque o endpoint ainda não
 * foi construído, não porque a tabela não exista.
 *
 * O resto é false por ausência de endpoint no ERP do cliente, não por decisão
 * nossa: não há pedidos, produtos nem NF-e publicados. O fornecedor se ofereceu
 * a construí-los; quando chegarem, é aqui que viram `true` — depois de mapeados
 * e testados, nunca antes.
 */
export const TOTH_CAPABILITIES: ErpCapabilities = {
  pushOrder: false, // integração é somente leitura
  syncProducts: false, // sem endpoint de produtos
  fetchNfe: false, // sem endpoint de NF-e
  syncClientes: true, // useSyncTothClientes → toth-sync-clientes
  syncPedidos: false, // sem endpoint de pedidos
  canonicalMode: false, // derivado de erp_sync_mode
  receivables: true, // useSyncTothCobrancas → toth-sync-cobrancas
};

// Ordem determinística de desempate. A ADR-0020 §3 diz que uma org conecta NO
// MÁXIMO um ERP, então esta lista existe para um estado que não deveria
// acontecer — e é justamente por isso que ela não pode depender de qual
// manifesto é mais rico: seria um convite a "conectar o segundo pra ganhar a
// capacidade". Quem estiver em mais de um recebe `multipleConnected` para poder
// avisar.
const ERP_PRIORITY: ErpProviderId[] = ["omie", "toth", "tiny"];

export interface ErpProviderManifest {
  id: ErpProviderId;
  label: string;
  accountName: string | null;
  connectedAt: string | null;
  lastError: string | null;
  /** Omie e Toth têm modo de reconciliação; Tiny não — null. */
  syncMode: OmieSyncMode | null;
  /**
   * O ERP responde sem TLS. Só o Toth pode ser `true` (é on-premise e o
   * endereço vem do cliente); Omie e Tiny são SaaS em https fixo. Existe aqui
   * para que qualquer superfície que mostre dado vindo do ERP possa avisar,
   * não só a tela de conexão.
   */
  insecureTransport: boolean;
  capabilities: ErpCapabilities;
}

export interface ResolvedErp {
  provider: ErpProviderManifest | null;
  providerId: ErpProviderId | null;
  can: (cap: keyof ErpCapabilities) => boolean;
  /**
   * Mais de um ERP conectado — configuração que a ADR-0020 §3 não prevê. Era
   * `bothConnected` quando existiam dois providers; com três, "ambos" mentiria.
   */
  multipleConnected: boolean;
}

// Minimal structural shapes — the real statuses are assignable to these.
interface TinyStatusLike {
  connected: boolean;
  account_name: string | null;
  connected_at: string | null;
  last_error: string | null;
}
interface OmieStatusLike extends TinyStatusLike {
  erp_sync_mode: OmieSyncMode;
}
interface TothStatusLike {
  connected: boolean;
  base_url: string | null;
  connected_at: string | null;
  last_error: string | null;
  erp_sync_mode: OmieSyncMode;
  insecure_transport: boolean;
}

export function resolveErpProvider(
  tiny: TinyStatusLike | undefined,
  omie: OmieStatusLike | undefined,
  toth?: TothStatusLike | undefined,
): ResolvedErp {
  // Tabela em vez de cadeia de `else if`: o quarto ERP é uma entrada aqui, não
  // mais um ramo. Cada candidato só é construído se estiver conectado.
  const candidates: Partial<Record<ErpProviderId, ErpProviderManifest>> = {};

  if (omie?.connected) {
    candidates.omie = {
      id: "omie",
      label: "Omie",
      accountName: omie.account_name,
      connectedAt: omie.connected_at,
      lastError: omie.last_error,
      syncMode: omie.erp_sync_mode,
      insecureTransport: false,
      capabilities: {
        ...OMIE_CAPABILITIES,
        canonicalMode: omie.erp_sync_mode === "canonical",
      },
    };
  }

  if (toth?.connected) {
    candidates.toth = {
      id: "toth",
      label: "Toth",
      // O Toth não tem "conta": a identidade da conexão é o endereço do
      // servidor do cliente. É isso que a UI mostra.
      accountName: toth.base_url,
      connectedAt: toth.connected_at,
      lastError: toth.last_error,
      syncMode: toth.erp_sync_mode,
      insecureTransport: toth.insecure_transport,
      capabilities: {
        ...TOTH_CAPABILITIES,
        canonicalMode: toth.erp_sync_mode === "canonical",
      },
    };
  }

  if (tiny?.connected) {
    candidates.tiny = {
      id: "tiny",
      label: "TinyERP",
      accountName: tiny.account_name,
      connectedAt: tiny.connected_at,
      lastError: tiny.last_error,
      syncMode: null,
      insecureTransport: false,
      capabilities: { ...TINY_CAPABILITIES },
    };
  }

  const connectedIds = ERP_PRIORITY.filter((id) => candidates[id]);
  const provider = connectedIds.length > 0 ? candidates[connectedIds[0]]! : null;

  return {
    provider,
    providerId: provider?.id ?? null,
    can: (cap) => provider?.capabilities[cap] ?? false,
    multipleConnected: connectedIds.length > 1,
  };
}
