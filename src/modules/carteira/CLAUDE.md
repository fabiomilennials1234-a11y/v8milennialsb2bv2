# Module — carteira

**Status:** 🟡 Skeleton (slice 10 popula)
**BC:** carteira
**Entidade primária:** Carteira Client + Order + Upsell + Portfolio Health
**Owner:** carteira / pós-venda

## Escopo

Pós-venda. Cliente que já comprou vira "cliente da carteira" do vendedor. Inclui:

- **Carteira Client** — lead virou cliente após `pipe_propostas: vendido`
- **Order** — pedido em sistema (TinyERP integration)
- **Upsell** — cross-sell, recompra, retention
- **Portfolio Health** — saúde da carteira (clientes ativos, em risco, perdidos)
- **Suggest Retention Action** — IA sugere ação pra cliente em risco
- **Proposals** — propostas comerciais
- **Deals** — (legacy? auditar em slice 10)

## Não-escopo

- ERP sync infra → `integrations.tinyerp` (este módulo consome)
- Campanha upsell → `campaigns.useUpsellCampanhas`
- Comissões do vendedor → `engagement` (ou módulo próprio? auditar)

## API pública (`index.ts`) — TBD slice 10

Provável superfície:
- Hooks: `usePortfolioClients`, `usePortfolioKPIs`, `usePortfolioTrends`, `useUpsellClients`, `useUpsellClientByLeadId`, `useUpsellClientProducts`, `useUpsellOrders`, `useUpsellMetrics`, `useUpsellGestaoRules`, `useAutoMoveUpsellClients`, `useRetentionSuggestion`, `useRevenueAtRisk`, `useClientAlerts`, `useDeals`, `useDealItems`, `useNewOrder`, `useQuickOrder`, `useOrderApproval`, `useProducts`, `useProductMaterials`, `useProductRanking`, `useProductVariants`, `useLeadProducts`
- Components: `<CarteiraDashboard>`, `<ClientCard>`, `<UpsellList>`, `<ProposalDetailModal>`
- Types: `CarteiraClient`, `Order`, `Upsell`
- Eventos (post slice 19): `order.created`, `order.approved`, `client.retention_alert`

## Áreas frágeis

- TinyERP push order — falha silenciosa se token expirado
- Order approval flow — gates de permissão
- Auto-move upsell — cron que move clientes entre stages

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/carteira/`, `upsell/`, `proposals/`, `deals/`, `products/`
- `src/hooks/usePortfolio*.ts`, `useUpsell*.ts`, `useDeals.ts`, `useDealItems.ts`, `useOrderApproval.ts`, `useNewOrder.ts`, `useQuickOrder.ts`
- `src/hooks/useProducts.ts`, `useProductMaterials.ts`, `useProductRanking.ts`, `useProductVariants.ts`, `useLeadProducts.ts`
- `src/hooks/useRetentionSuggestion.ts`, `useRevenueAtRisk.ts`, `useClientAlerts.ts`
- `src/hooks/useTinyErp.ts`
- `src/pages/Upsell.tsx`, `Produtos.tsx`

Backend:
- `supabase/functions/calculate-portfolio-health/`
- `supabase/functions/suggest-retention-action/`
- `supabase/functions/carteira-bulk-message/`
- `supabase/functions/erp-order-webhook/` (auditar — TinyERP ou outro?)
- `supabase/functions/_shared/portfolio-health.ts`, `retention-gate.ts`

## Slice de migração

**Slice 10** — `feat/modularizacao/09-carteira` (5h)

## Dedup pendente

- 4 pastas (`carteira/`, `upsell/`, `proposals/`, `deals/`) → consolidar em `components/{client,upsell,proposal,deal}/`
- `useDeals*` — Deal é entidade viva ou legado? (decisão CTO pendente)
- `erp-order-webhook` vs `tinyerp-webhook` → auditar e decidir destino

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Upsell: `Obsidian/.../06 — Features/Vendas/Upsell.md`
