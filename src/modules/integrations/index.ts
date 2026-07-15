/**
 * Module integrations — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * Ver `./CLAUDE.md` para escopo (provider adapters: Google Calendar, Meta, TinyERP,
 * Omie, Asaas, SZ.Chat, Cal.com).
 */

// ─── ERP: Omie (camada multi-ERP provider-neutral, ADR-0020) ───────────────
export {
  useOmieStatus,
  useConnectOmie,
  useDisconnectOmie,
  useSyncOmieClientes,
  useSyncOmiePedidos,
  useSyncOmieFinanceiro,
  useNotasFiscais,
  useTitulos,
  useUpdateOmieSyncMode,
  type OmieSyncMode,
  type OmieConnectionStatus,
  type NotaFiscal,
  type Titulo,
  type TituloStatus,
} from "./hooks/useOmie";

export { useErpProvider, type UseErpProviderResult } from "./hooks/useErpProvider";
export {
  resolveErpProvider,
  TINY_CAPABILITIES,
  OMIE_CAPABILITIES,
  type ErpCapabilities,
  type ErpProviderId,
  type ErpProviderManifest,
} from "./lib/erp-provider";
