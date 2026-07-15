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

export type ErpProviderId = "omie" | "tiny";

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

const ERP_PRIORITY: ErpProviderId[] = ["omie", "tiny"]; // Omie = ADR-0020 canonical layer wins

export interface ErpProviderManifest {
  id: ErpProviderId;
  label: string;
  accountName: string | null;
  connectedAt: string | null;
  lastError: string | null;
  syncMode: OmieSyncMode | null; // Omie only; null for Tiny
  capabilities: ErpCapabilities;
}

export interface ResolvedErp {
  provider: ErpProviderManifest | null;
  providerId: ErpProviderId | null;
  can: (cap: keyof ErpCapabilities) => boolean;
  bothConnected: boolean;
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

export function resolveErpProvider(
  tiny: TinyStatusLike | undefined,
  omie: OmieStatusLike | undefined,
): ResolvedErp {
  const tinyConnected = !!tiny?.connected;
  const omieConnected = !!omie?.connected;
  const bothConnected = tinyConnected && omieConnected;

  const providerId: ErpProviderId | null = ERP_PRIORITY.find(
    (id) => (id === "omie" && omieConnected) || (id === "tiny" && tinyConnected),
  ) ?? null;

  let provider: ErpProviderManifest | null = null;
  if (providerId === "omie" && omie) {
    provider = {
      id: "omie",
      label: "Omie",
      accountName: omie.account_name,
      connectedAt: omie.connected_at,
      lastError: omie.last_error,
      syncMode: omie.erp_sync_mode,
      capabilities: {
        ...OMIE_CAPABILITIES,
        canonicalMode: omie.erp_sync_mode === "canonical",
      },
    };
  } else if (providerId === "tiny" && tiny) {
    provider = {
      id: "tiny",
      label: "TinyERP",
      accountName: tiny.account_name,
      connectedAt: tiny.connected_at,
      lastError: tiny.last_error,
      syncMode: null,
      capabilities: { ...TINY_CAPABILITIES },
    };
  }

  return {
    provider,
    providerId,
    can: (cap) => provider?.capabilities[cap] ?? false,
    bothConnected,
  };
}
