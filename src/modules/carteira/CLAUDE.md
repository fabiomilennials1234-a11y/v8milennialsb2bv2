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

## Entrada/saída de automação (deals)

`deals` tem porta de entrada e de saída no motor de workflows (`workflows` BC):
node `create_deal` (cria o negócio vinculado ao lead) e trigger `deal_created`
(PG trigger `trg_workflow_deal_created` em `deals`). Guard de laço via
`deals.metadata.workflow_execution_id`. Feature doc:
`06 — Features/automacoes/negocio-criado.md`.

**Atenção ao schema real**: prod NÃO tem `deals.pipeline_id` nem `deals.stage_id`,
embora `src/integrations/supabase/types.ts` os declare — por isso a tela de
Negócios empilha tudo em "Sem estágio". Node e trigger seguem o schema de prod.

## Estrutura

```
src/modules/carteira/
├── components/
│   ├── client/         # ex-src/components/carteira/ (25 files — CarteiraClient*, ClienteX*, OrderApprovalCard, NewOrderModal, HealthSparkline, RevenueChart, AnalyticsKPICards, ...)
│   ├── upsell/         # ex-src/components/upsell/ (13 files — UpsellBaseKanban, UpsellGestaoKanban, ClientDetailModal, CreateCampanhaModal, ImportUpsellClientsContent, ...)
│   ├── proposal/       # ex-src/components/proposals/ (11 files — TinyErpConfirmOrderDialog, TinyErpOrderStatus, ProductCombobox, ...)
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
  - `useNewOrder` aceita `NewOrderParams` (discriminated union por `mode`):
    - `mode: "items"` (default, `mode` omissível) — `{ items: OrderLineItem[] }`. Insere `upsell_orders` + `client_purchase_items` + `upsell_client_products` (distinct). `sale_value` derivado da soma dos itens.
    - `mode: "manual_total"` — `{ saleValue: number; description?: string }`. Insere SÓ 1 row em `upsell_orders` (`product_name = description || "Venda avulsa"`, `product_type: "unitario"`). NÃO insere `client_purchase_items` nem `upsell_client_products`. Exige `saleValue > 0` (throw). Não vai pro TinyERP (venda sem SKU) — `NewOrderModal` pula o `TinyErpUpsellConfirmDialog` nesse modo.
- **Order — aba Pedidos** (listar + editar pedido MANUAL, 2026-08-13): `useCarteiraOrders` (RPC `carteira_list_orders`), `useUpdateOrder`, componente `CarteiraOrders`.
  - **Gate de procedência**: pedido com vínculo ERP é **read-only** no CRM. `carteira_erp_source(order_id, org_id, tiny_order_id, external_source)` devolve `nfe|tiny|omie|NULL`; NULL = manual = editável. `carteira_update_order` recusa com `order_erp_linked`. Medido em prod: **302 manuais / 232 ERP** de 534 aprovados.
  - Só pedido **aprovado** é editável (`order_not_approved`). A lista já filtra, mas a RPC tem `GRANT EXECUTE TO authenticated` e é alcançável direto pelo PostgREST — sem o gate, um membro mudaria o valor de um pedido PENDENTE antes da aprovação.
  - Permissão de edição: **admin + membro** (pertencer à org basta). Gate real é do banco (`assert_org_member` na RPC), não do front.
  - **Cancelar, descancelar e hard delete NÃO existem** — fora do escopo da fatia 1 por decisão do CTO.
  - Detalhe: `Obsidian/.../06 — Features/Vendas/Carteira Pedidos.md`
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

🟠 **Portfolio health snapshots** — `calculate-portfolio-health` edge function escreve `client_health_snapshots` (a cada 30min) + colunas derivadas em `upsell_clients`. `usePortfolioTrends` lê snapshots; `usePortfolioKPIs` (`get_portfolio_kpis`) lê colunas de `upsell_clients` direto.

🟢 **Recompute síncrono de métricas de dinheiro** (migration `20270107000000`, 2026-07-03) — trigger `trg_upsell_order_recalc_metrics` em `upsell_orders` chama `recalc_upsell_client_metrics(client_id)` a cada order `approved` que entra/sai/muda. Recomputa `avg_ticket`, `last_order_at`, `next_order_expected`, `order_count`, `lifetime_value`, `reorder_cycle_days`, `days_since_last_order` na hora (antes só o cron 30min). **health_score/segment/churn/trend continuam no cron** — não replicar em SQL. Semântica espelha `calculate-portfolio-health`; ao mexer no cálculo de dinheiro, mudar OS DOIS em sincronia senão divergem (KPI flica entre trigger e cron).

🟠 **`get_my_admin_organization_ids()` inclui gestor** (achado 2026-08-13, **não corrigido — pré-existente**) — o helper (baseline:9680) faz UNION com `get_my_gestor_organization_ids()` (9695) e inclui gestor de portfólio; o `isAdmin` do front (`useIdentity.ts:34`) não inclui. Toda policy que usa esse helper é mais frouxa que a UI sugere — inclusive `upsell_orders_delete_org`, que hoje permite hard delete a quem não vê botão nenhum. Com PITR OFF, isso é irreversível. Escalado ao CTO como item próprio; **esta fatia não toca RLS**.

🟠 **Audit de pedido ouve TODO update** (2026-08-13) — `trg_order_event_audit` virou `AFTER INSERT OR UPDATE` (era `UPDATE OF approval_status`). O guard `IS DISTINCT FROM` sobre os 6 campos auditados é o que impede que `tinyerp-pull-orders:297`, `erp-order-webhook:197` e `_shared/erp/sync/upsert-order.ts:81` encham `order_events` de ruído a cada ciclo de re-sync. Não remover. Abrir campo novo à edição exige estender o snapshot NA MESMA MUDANÇA, senão a edição passa sem rastro.

🟠 **Gate de ERP vive na RPC, não em RLS** (2026-08-13) — `carteira_update_order` recusa pedido com vínculo ERP, mas as policies de `upsell_orders` seguem as do baseline: um `PATCH` cru via PostgREST ainda alcança a tabela. Superfície **pré-existente** (membro sempre pôde escrever em `upsell_orders`), não introduzida pela aba Pedidos — mas quem for endurecer isso precisa saber que a invariante "ERP é read-only" é hoje só da RPC. Fechar exige fatia de RLS própria.

🔴 **Editar pedido aprovado NÃO corrige `sale_events`** (2026-08-13, **dívida aceita pelo CTO**) — os gatilhos de `20260723013018` escutam só `AFTER INSERT WHEN approved` e `AFTER UPDATE OF approval_status`; nenhum observa `sale_value`, `sold_at`, `client_id` ou `sale_responsible_id`. Editar altera `upsell_orders` e as métricas derivadas de `upsell_clients`, mas a venda fica **congelada no caderno** com os valores da aprovação. Medido: pedido 500→750, `lifetime_value` 800→1050, `sale_events` parado em 500. Org com `carteira_emits_revenue_enabled = true` verá divergência entre a Carteira e a receita canônica do ADR-0017 — hoje **só Milennials** (41 pedidos, interseção 100%). Nenhuma UI pode afirmar que a edição mexe em receita. Saída futura: par corretivo (`sale_reversed` + `sale`) atrás da mesma flag, respeitando a chave de idempotência da #1199.

🟠 **Edição concorrente é last-write-wins silencioso** (2026-08-13) — `carteira_update_order` usa `FOR UPDATE`, o que serializa editores mas **não detecta** conflito: a segunda edição espera o lock e sobrescreve a primeira sem aviso (medido: 1,34s de espera, correção anterior perdida). O `GET DIAGNOSTICS ROW_COUNT` é guarda defensiva para o caso de alguém remover o lock, não proteção contra corrida. Detecção exigiria versionamento otimista.

### Dívidas conhecidas da aba Pedidos (registradas, fora de escopo)

- `order_events.created_at` não desempata entre o evento `edited/order` e o `edited/items` da mesma edição. Sem consumidor hoje.
- `useUpsellClients()` não tem `.limit()` — teto do PostgREST é 1000 e a maior org tem 664 clientes. Ainda não estoura.
- `carteira_erp_source` compara `external_source` case-sensitive. Integrador futuro gravando `'Tiny'` viraria falso-negativo (= editável por engano). Hoje prod só tem `<null>`, `tiny` e `funnel_sale_event`.
- Ordenação da tabela é da página carregada; server-side exigiria parâmetro de ordenação na RPC.

🔴 **Venda manual auto-aprovada** — `useNewOrder`/`useCreateOrder`/`useCreateUpsellOrder` + import gravam `approval_status:'approved'`. O default da coluna é `'pending'` e pending é invisível pra métrica (cron + `get_portfolio_kpis` só contam `approved`). Qualquer novo caminho que insira em `upsell_orders` e queira contar na métrica DEVE setar `approved` (ou o pedido some até aprovação manual na aba Aprovações).

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useCanDo`
- `@/modules/leads` — types `Lead` (importação indireta via Tables<"leads">)
- `@/modules/communication` — `useScheduledMessages` (consumido por `ClienteDetailPage` para timeline)
- `@/hooks/useRealtimeSubscription` — transport infra (cross-cutting)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

### Consumidores cross-module (importam de `@/modules/carteira`)

- `@/modules/leads` — `useLeadProducts` (lead-products hook em `src/modules/leads/hooks/lead/useLeadProducts.ts`), `BudgetFieldBlock`, `PropostasContext`, `UpsellContext`, `LeadTabProducts`, `ImportLeadsFunnelModal` — consomem `useProducts`, `useDeals`, `useUpsellClientByLeadId`
- `@/modules/pipelines` — `PipePropostas`, `PipeSettingsDialog` — consomem `useDeals`, `useProducts`, `CreateDealDialog`
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
