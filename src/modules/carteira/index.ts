/**
 * Module carteira — API pública.
 *
 * Public surface do bounded context (pós-venda). Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * Status: Active (populado em slice 10 — feat/modularizacao/09-carteira).
 *
 * Domínios cobertos:
 * - Carteira Client (clientes pós-venda)
 * - Portfolio Health (KPIs, trends, churn, revenue-at-risk, retention)
 * - Order (TinyERP push, quick order, approval flow)
 * - Upsell (clients, campanhas, products, orders, metrics, gestão rules)
 * - Proposal (componentes — hooks vivem em leads/cross-pipe)
 * - Deal (kanban + items — legado, dedup pendente decisão CTO)
 * - Product (CRUD + variants + materials + ranking)
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-9):
 *   @/modules/carteira/pages/Upsell
 *   @/modules/carteira/pages/Produtos
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Portfolio (KPIs, clients, trends, revenue, alerts)
// ────────────────────────────────────────────────────────────────────────

export { usePortfolioKPIs } from "./hooks/usePortfolioKPIs";
export type { PortfolioKPIs } from "./hooks/usePortfolioKPIs";

export { usePortfolioClients } from "./hooks/usePortfolioClients";
export type {
  PortfolioClientRow,
  PortfolioClientsResponse,
  SortColumn,
  UsePortfolioClientsParams,
} from "./hooks/usePortfolioClients";

export { usePortfolioTrends } from "./hooks/usePortfolioTrends";
export type {
  RevenueMonthly,
  HealthDaily,
  RetentionMonthly,
  ChurnSummary,
  SegmentMonthly,
  PortfolioTrends,
} from "./hooks/usePortfolioTrends";

export { useRevenueAtRisk } from "./hooks/useRevenueAtRisk";
export type { RevenueAtRiskData } from "./hooks/useRevenueAtRisk";

export { useClientAlerts } from "./hooks/useClientAlerts";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Retention (IA-suggested actions para clientes em risco)
// ────────────────────────────────────────────────────────────────────────

export {
  useRetentionSuggestion,
  useGenerateRetentionSuggestion,
} from "./hooks/useRetentionSuggestion";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Order (novo pedido, quick reorder, approval flow)
// ────────────────────────────────────────────────────────────────────────

export { useNewOrder } from "./hooks/useNewOrder";
export type { NewOrderParams } from "./hooks/useNewOrder";

export { useLastOrder, useCreateOrder } from "./hooks/useQuickOrder";
export type { OrderLineItem } from "./hooks/useQuickOrder";

export {
  usePendingOrders,
  useApproveOrder,
  useRejectOrder,
  useBulkApproveOrders,
} from "./hooks/useOrderApproval";
export type { PendingOrder } from "./hooks/useOrderApproval";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Upsell (clients, campanhas, products, orders, metrics, gestão)
// ────────────────────────────────────────────────────────────────────────

export {
  useUpsellClients,
  useUpsellClient,
  useCreateUpsellClient,
  useUpdateUpsellClient,
  useDeleteUpsellClient,
} from "./hooks/useUpsellClients";
export type {
  UpsellClient,
  UpsellClientInsert,
  UpsellClientUpdate,
  UpsellClientWithRelations,
} from "./hooks/useUpsellClients";

export { useUpsellClientByLeadId } from "./hooks/useUpsellClientByLeadId";
export type { UpsellClientRow } from "./hooks/useUpsellClientByLeadId";

// Disparo Phase 1 — carteira (post-sale) audience resolver. Returns lead_ids of
// active carteira clients matching the wizard's audience conditions.
export { useCarteiraLeadIds } from "./hooks/useCarteiraLeadIds";
export type { CarteiraLeadIdsParams } from "./hooks/useCarteiraLeadIds";

export {
  useUpsellClientProducts,
  useCreateUpsellClientProduct,
  useUpdateUpsellClientProduct,
  useDeleteUpsellClientProduct,
} from "./hooks/useUpsellClientProducts";
export type {
  UpsellClientProduct,
  UpsellClientProductInsert,
  UpsellClientProductUpdate,
} from "./hooks/useUpsellClientProducts";

export {
  useUpsellCampanhas,
  useCreateUpsellCampanha,
  useUpdateUpsellCampanha,
  useDeleteUpsellCampanha,
} from "./hooks/useUpsellCampanhas";
export type {
  UpsellCampanha,
  UpsellCampanhaInsert,
  UpsellCampanhaUpdate,
  UpsellCampanhaWithRelations,
} from "./hooks/useUpsellCampanhas";

export {
  useUpsellOrders,
  useUpsellOrdersByClient,
  useCreateUpsellOrder,
} from "./hooks/useUpsellOrders";
export type { UpsellOrder, UpsellOrderInsert } from "./hooks/useUpsellOrders";

export { useUpsellMetrics } from "./hooks/useUpsellMetrics";

export {
  useUpsellGestaoRules,
  useSaveGestaoRules,
} from "./hooks/useUpsellGestaoRules";
export type { GestaoRule, GestaoRuleInsert } from "./hooks/useUpsellGestaoRules";

export { useAutoMoveUpsellClients } from "./hooks/useAutoMoveUpsellClients";

// Os hooks de Deal (`useDeals`, `useDealItems`) saíram junto com a rota
// `/negocios` — ADR-0023 decisão 5. Eram o único leitor de `deals.pipeline_id`
// e de `deals.stage_id`, as duas colunas que a fatia 2 dropa. Nenhum consumidor
// deste barril importava símbolo Deal quando foram removidos.

// ────────────────────────────────────────────────────────────────────────
// Hooks — Product (CRUD + variants + materials + ranking)
// ────────────────────────────────────────────────────────────────────────

export {
  useProducts,
  useProductsWithVariants,
  useActiveProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from "./hooks/useProducts";
export type {
  Product,
  ProductType,
  ProductVariant,
  ProductInsert,
  ProductUpdate,
  ProductVariantInsert,
  ProductVariantUpdate,
} from "./hooks/useProducts";

export {
  useProductVariants,
  useCreateProductVariant,
  useUpdateProductVariant,
  useDeleteProductVariant,
  useBulkCreateProductVariants,
} from "./hooks/useProductVariants";

export {
  useProductMaterials,
  useProductMaterialCounts,
  useUploadProductMaterial,
  useDeleteProductMaterial,
  getProductMaterialUrl,
  MATERIAL_TYPE_LABELS,
} from "./hooks/useProductMaterials";
export type { MaterialType, ProductMaterial } from "./hooks/useProductMaterials";

export { useProductRanking } from "./hooks/useProductRanking";
export type { ProductRankingItem } from "./hooks/useProductRanking";

// ────────────────────────────────────────────────────────────────────────
// Hooks — TinyERP integration (consumido pelo módulo carteira; infra real
// vive em supabase/functions/tinyerp-* e será reorganizada slice 14/16).
// ────────────────────────────────────────────────────────────────────────

export {
  useTinyErpStatus,
  useConnectTinyErp,
  useDisconnectTinyErp,
  useTinyErpSyncProducts,
  useTinyErpPushOrder,
  useTinyErpSyncLogs,
  useUpdateTinyErpSettings,
  useTinyErpOrderMapping,
  useTinyErpFetchNfe,
} from "./hooks/useTinyErp";
export type {
  TinyErpConnectionStatus,
  TinyErpSyncLog,
} from "./hooks/useTinyErp";
