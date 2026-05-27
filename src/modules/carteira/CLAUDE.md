# Module — carteira

**Status:** 🟢 Active (slice 10 — frontend completo. Backend `_shared/portfolio-health.ts`, `_shared/retention-gate.ts`, `_shared/tinyerp-utils.ts` + edge functions `calculate-portfolio-health`, `suggest-retention-action`, `carteira-bulk-message`, `tinyerp-*`, `erp-order-webhook` em slice 14/16)
**BC:** carteira
**Entidade primária:** Carteira Client + Order + Upsell + Portfolio Health
**Owner:** carteira / pós-venda

## Escopo

Pós-venda. Cliente que já comprou vira "cliente da carteira" do vendedor. Domínios cobertos:

- **Carteira Client** — lead virou cliente após `pipe_propostas: vendido`
- **Order** — pedido em sistema (TinyERP integration). Quick order, new order, approval gates
- **Upsell** — cross-sell, recompra, retention. Clients + campanhas + products + orders + metrics + gestão rules
- **Portfolio Health** — saúde da carteira (KPIs, trends, churn, revenue-at-risk, retention)
- **Suggest Retention Action** — IA sugere ação pra cliente em risco
- **Proposals** — componentes UI de proposta (hooks vivem no slice de pipelines / leads, pois proposta é estágio do pipe)
- **Deals** — kanban + items (legado; dedup pendente — ver "Dívidas")
- **Products** — CRUD + variants + materials + ranking

## Não-escopo

- ERP sync infra → `integrations.tinyerp` (este módulo consome via `useTinyErp*`)
- Campanha upsell genérica → ainda usa `useUpsellCampanhas` daqui; quando o campaigns absorver entidade `upsell_campanhas`, migrar
- Comissões do vendedor → `engagement` (não migrado nesta slice)
- TV Dashboard / `useCloserPerformance` → cross-domain (`engagement`/`analytics`) — mantido fora

## Estrutura

```
src/modules/carteira/
├── components/
│   ├── client/         # ex-src/components/carteira/ (25 files — CarteiraClient*, ClienteX*, OrderApprovalCard, NewOrderModal, HealthSparkline, RevenueChart, AnalyticsKPICards, ...)
│   ├── upsell/         # ex-src/components/upsell/ (13 files — UpsellBaseKanban, UpsellGestaoKanban, ClientDetailModal, CreateCampanhaModal, ImportUpsellClientsContent, ...)
│   ├── proposal/       # ex-src/components/proposals/ (12 files — ProposalDetailModal, TinyErpConfirmOrderDialog, TinyErpOrderStatus, CalorSlider, ProductCombobox, ...)
│   ├── deal/           # ex-src/components/deals/ (5 files — CreateDealDialog, DealDetailDrawer, DealItemsTable, DealKanbanCard, DealKPICards)
│   └── product/        # ex-src/components/products/ (4 files — CreateProductModal, EditProductModal, ProductImportModal, ProductMaterialsSection)
├── hooks/              # 24 hooks (ver lista abaixo)
├── pages/
│   ├── Upsell.tsx      # /upsell
│   └── Produtos.tsx    # /produtos
├── lib/                # vazio — utils internos virão quando necessário
├── index.ts            # API pública
└── CLAUDE.md           # este arquivo
```

## API pública (`index.ts`)

### Hooks

- **Portfolio**: `usePortfolioKPIs`, `usePortfolioClients`, `usePortfolioTrends`, `useRevenueAtRisk`, `useClientAlerts`
- **Retention**: `useRetentionSuggestion`, `useGenerateRetentionSuggestion`
- **Order**: `useNewOrder`, `useLastOrder`, `useCreateOrder`, `usePendingOrders`, `useApproveOrder`, `useRejectOrder`, `useBulkApproveOrders`
- **Upsell clients**: `useUpsellClients`, `useUpsellClient`, `useCreate/Update/DeleteUpsellClient`, `useUpsellClientByLeadId`
- **Upsell products**: `useUpsellClientProducts`, `useCreate/Update/DeleteUpsellClientProduct`
- **Upsell campanhas**: `useUpsellCampanhas`, `useCreate/Update/DeleteUpsellCampanha`
- **Upsell orders**: `useUpsellOrders`, `useUpsellOrdersByClient`, `useCreateUpsellOrder`
- **Upsell metrics / gestão**: `useUpsellMetrics`, `useUpsellGestaoRules`, `useSaveGestaoRules`, `useAutoMoveUpsellClients`
- **Deal**: `useDeals`, `useDealKPIs`, `useDeal`, `useCreate/Update/Delete/MarkWon/MarkLostDeal`, `useDealItems`, `useCreate/Update/DeleteDealItem`
- **Product**: `useProducts`, `useProductsWithVariants`, `useActiveProducts`, `useCreate/Update/DeleteProduct`, `useProductVariants`, `useCreate/Update/Delete/BulkCreateProductVariant`, `useProductMaterials`, `useProductMaterialCounts`, `useUpload/DeleteProductMaterial`, `getProductMaterialUrl`, `MATERIAL_TYPE_LABELS`, `useProductRanking`
- **TinyERP**: `useTinyErpStatus`, `useConnect/DisconnectTinyErp`, `useTinyErpSyncProducts`, `useTinyErpPushOrder`, `useTinyErpSyncLogs`, `useUpdateTinyErpSettings`, `useTinyErpOrderMapping`, `useTinyErpFetchNfe`

### Components

Internals (não re-exportados — usados apenas pelas Pages do próprio módulo).

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/carteira/pages/Upsell` (rota `/upsell`)
- `@/modules/carteira/pages/Produtos` (rota `/produtos`)
- `@/modules/carteira/components/client/ClienteDetailPage` (rota `/clientes/:id` — component, não page convencional)

### Types

Re-exportados via index.ts: `PortfolioKPIs`, `PortfolioClientRow`, `PortfolioClientsResponse`, `SortColumn`, `UsePortfolioClientsParams`, `RevenueMonthly`, `HealthDaily`, `RetentionMonthly`, `ChurnSummary`, `SegmentMonthly`, `PortfolioTrends`, `RevenueAtRiskData`, `NewOrderParams`, `OrderLineItem`, `PendingOrder`, `UpsellClient`, `UpsellClientInsert`, `UpsellClientUpdate`, `UpsellClientWithRelations`, `UpsellClientRow`, `UpsellClientProduct`, `UpsellClientProductInsert`, `UpsellClientProductUpdate`, `UpsellCampanha`, `UpsellCampanhaInsert`, `UpsellCampanhaUpdate`, `UpsellCampanhaWithRelations`, `UpsellOrder`, `UpsellOrderInsert`, `GestaoRule`, `GestaoRuleInsert`, `Deal`, `DealItemRow`, `DealsFilter`, `DealKPIs`, `DealInsert`, `DealItemInsert`, `DealItemUpdate`, `Product`, `ProductType`, `ProductVariant`, `ProductInsert`, `ProductUpdate`, `ProductVariantInsert`, `ProductVariantUpdate`, `MaterialType`, `ProductMaterial`, `ProductRankingItem`, `TinyErpConnectionStatus`, `TinyErpSyncLog`.

### Eventos (post slice 19)

`order.created`, `order.approved`, `client.retention_alert`, `upsell.client_moved`

## Áreas frágeis

🟠 **TinyERP push order** — falha silenciosa se token expirado. UI mostra status mas erro real fica no edge function log. Hook `useTinyErpPushOrder` (em `useTinyErp.ts`) chama `tinyerp-push-order` edge function.

🟠 **Order approval flow** — gates de permissão. `OrderApprovalCard` + `usePendingOrders`/`useApproveOrder`/`useRejectOrder`/`useBulkApproveOrders`. Permissões testadas em `tests/unit/use-products.test.ts` (parcial) — auditar com cuidado se mudar lógica.

🟠 **Auto-move upsell** — cron move clientes entre stages baseado em regras (`useUpsellGestaoRules`). `useAutoMoveUpsellClients` lê dados; cron real é edge function (`auto-move-upsell-clients`? — slice 15 audita nome).

🟠 **Portfolio health snapshots** — `calculate-portfolio-health` edge function escreve `portfolio_health_snapshots` (diário). `usePortfolioKPIs`/`usePortfolioTrends` leem snapshot mais recente. Se cron falhar, KPIs ficam stale.

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useCanDo`
- `@/modules/leads` — types `Lead` (importação indireta via Tables<"leads">)
- `@/modules/communication` — `useScheduledMessages` (consumido por `ClienteDetailPage` para timeline)
- `@/hooks/useRealtimeSubscription` — transport infra (cross-cutting)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

### Consumidores cross-module (importam de `@/modules/carteira`)

- `@/modules/leads` — `useLeadProducts` (lead-products hook em `src/modules/leads/hooks/lead/useLeadProducts.ts`), `BudgetFieldBlock`, `PropostasContext`, `UpsellContext`, `LeadTabProducts`, `ImportLeadsFunnelModal` — consomem `useProducts`, `useDeals`, `useUpsellClientByLeadId`
- `@/modules/pipelines` — `PipePropostas`, `Negocios`, `PipeSettingsDialog` — consomem `ProposalDetailModal`, `useDeals`, `useProducts`, `CreateDealDialog`
- `src/components/settings/IntegrationsCatalog.tsx`, `src/components/settings/TinyErpSettings.tsx` — consomem `useTinyErp*` (será absorvido por `integrations` ou `platform` em slice 13/14)
- `src/components/dashboard/ProductRanking.tsx` — `useProductRanking` (será absorvido por `analytics` em slice 12)

## Origem (slice 10 — frontend migrado em 2026-05-27)

Frontend (✅ migrado pra cá):
- ~~`src/components/carteira/`~~ (25 files) → `./components/client/`
- ~~`src/components/upsell/`~~ (13 files) → `./components/upsell/`
- ~~`src/components/proposals/`~~ (12 files) → `./components/proposal/`
- ~~`src/components/deals/`~~ (5 files) → `./components/deal/`
- ~~`src/components/products/`~~ (4 files) → `./components/product/`
- ~~`src/hooks/{useAutoMoveUpsellClients,useClientAlerts,useDeals,useDealItems,useNewOrder,useQuickOrder,useOrderApproval,usePortfolioClients,usePortfolioKPIs,usePortfolioTrends,useProducts,useProductMaterials,useProductRanking,useProductVariants,useRetentionSuggestion,useRevenueAtRisk,useTinyErp,useUpsellCampanhas,useUpsellClientByLeadId,useUpsellClientProducts,useUpsellClients,useUpsellGestaoRules,useUpsellMetrics,useUpsellOrders}.ts`~~ (24 hooks) → `./hooks/`
- ~~`src/pages/Upsell.tsx`~~ → `./pages/Upsell.tsx`
- ~~`src/pages/Produtos.tsx`~~ → `./pages/Produtos.tsx`

Backend (próximas slices):
- `supabase/functions/calculate-portfolio-health/` (slice 14)
- `supabase/functions/suggest-retention-action/` (slice 14)
- `supabase/functions/carteira-bulk-message/` (slice 14)
- `supabase/functions/erp-order-webhook/` (slice 14 — verificar destino: integrations BC)
- `supabase/functions/tinyerp-*/` (8 functions — slice 14, destino: integrations BC)
- `supabase/functions/_shared/portfolio-health.ts` (slice 16 cleanup — consumido só por `calculate-portfolio-health`)
- `supabase/functions/_shared/retention-gate.ts` (slice 16 cleanup — consumido só por `suggest-retention-action`)
- `supabase/functions/_shared/tinyerp-utils.ts` (slice 16 — domínio integrations, não carteira)

## Decisão — hooks adjacentes não migrados

- **`useCloserPerformance.ts`** → **NÃO migrado**. Consumido por TV Dashboard (`src/components/tv/CloserPerformanceBlock.tsx`, `useTVKPIs`). Já está documentado em `src/modules/engagement/CLAUDE.md` como pertencente ao BC engagement. Cross-domain (analytics/engagement), não carteira.
- **`useLeadProducts.ts`** → **NÃO migrado**. Já vive em `src/modules/leads/hooks/lead/useLeadProducts.ts` (movido na slice 4). Consome `useProducts` da carteira via API pública.

## Dívidas técnicas (a resolver em slices futuras)

- 🔴 **Deal vs Proposta — duplicação?** `useDeals*` parece sobrepor entidade `pipe_propostas`. Decidir: (a) Deal é entidade viva separada de proposta, (b) Deal é legado a deprecar, ou (c) consolidar. Decisão CTO pendente. Mantido na slice 10 sem refactor.
- 🟠 **Hooks cross-domain ainda neste módulo:**
  - `useUpsellCampanhas` — vive aqui, mas conceitualmente híbrido carteira/campaigns. Mantido aqui porque `upsell_campanhas` é entidade upsell, não campaign-genérica.
  - `useTinyErp*` — vive aqui, mas semanticamente é integrations BC. Migra em slice 13/14 (integrations).
  - `useProductRanking` — vive aqui, mas é analytics. Migra em slice 12 (analytics).
- 🟠 **`useNewOrder.ts` ainda importa de `./useQuickOrder.ts`** (sibling) via alias `@/modules/carteira/hooks/useQuickOrder` — consistente com padrão dos outros slices, mas relative import seria mais idiomático. Padrão dos slices 4-9 usa alias.
- 🟠 **`erp-order-webhook` edge function** — auditar se é TinyERP-specific ou genérico. Define destino slice 14 (carteira vs integrations).

## Slice de migração

**Slice 10** — `feat/modularizacao/09-carteira` — completado 2026-05-27. **63 renames** (59 components + 24 hooks + 2 pages — corrigido: 59 files frontend agrupados em 5 components/ subpastas + 24 hooks + 2 pages = 85 renames totais) + **66 arquivos** com imports atualizados (**148 substituições** incluindo App.tsx relative fix).

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Slice de referência: slice 9 campaigns (commit `eb00ff1b`, changelog `2026-05-27-slice-09-campaigns.md`)
- Origem da estrutura `client/upsell/proposal/deal/product`: brief do CTO da slice 10 (modularização — agrupamento por entidade dentro do BC carteira)
