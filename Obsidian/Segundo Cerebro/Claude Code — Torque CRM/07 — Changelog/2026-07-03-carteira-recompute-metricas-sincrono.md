# 2026-07-03

## Mudanças

- **carteira/métricas**: métricas de dinheiro do cliente da carteira (`avg_ticket`, `last_order_at`, `next_order_expected`, `order_count`, `lifetime_value`, `reorder_cycle_days`, `days_since_last_order`) agora **recomputam na hora** que um pedido `approved` entra/sai/muda, via trigger em `upsell_orders`. Antes só o cron `calculate-portfolio-health` (30min) populava essas colunas → registrar/aprovar venda não mexia a KPI (`get_portfolio_kpis` lê essas colunas direto). **Camada 1** da refundação (ERP-sync é Camada 2).
- **carteira/venda manual**: "Nova Venda" (e venda rápida + import) passa a entrar `approval_status='approved'`. Antes nascia `pending` (default da coluna) e ficava **invisível pra toda métrica** até aprovação manual numa aba escondida — ninguém aprovava, métrica congelava. Decisão CTO: auto-aprovar venda manual (gate de aprovação some pro caminho manual).
- **fix (carteira/import)**: o insert de pedidos do "Importar Planilha" estava **100% quebrado** — usava coluna inexistente `upsell_client_id` (correto: `client_id`) e omitia `product_type` (NOT NULL). Todo pedido importado dava erro e era pulado silenciosamente (`continue`). Corrigido + guard `sale_value>0` (CHECK) + fallback de `product_name`.
- **basic4u**: 4 vendas manuais presas em `pending` (jun 12–16, R$8.365) aprovadas; clientes recomputados. `clientes com ticket` 11→15, `total_recurring` populado.

## Arquivos tocados

- `supabase/migrations/20270107000000_carteira_recalc_client_metrics_trigger.sql` **(novo)** — função `recalc_upsell_client_metrics(uuid)` (espelha semântica money de `calculate-portfolio-health`/`portfolio-health.ts`), trigger `trg_upsell_order_recalc_metrics` (`AFTER INSERT/DELETE/UPDATE OF approval_status,sale_value,sold_at,client_id`, fire só quando envolve `approved`), backfill enxuto (só clientes com histórico). Endurecida: `REVOKE ... FROM PUBLIC` + `GRANT EXECUTE TO service_role`, `search_path 'public','pg_temp'`, `FOR UPDATE` anti-lost-update. **Aplicada em prod.**
- `src/modules/carteira/hooks/useNewOrder.ts` — `approval_status:'approved'`+`approved_at` + invalida `portfolio-kpis/clients/trends`.
- `src/modules/carteira/hooks/useQuickOrder.ts` (`useCreateOrder`) — idem.
- `src/modules/carteira/hooks/useUpsellOrders.ts` (`useCreateUpsellOrder`) — default `approved` no insert (caller pode sobrescrever) + invalidação.
- `src/modules/carteira/components/upsell/ImportUpsellClientsContent.tsx` — fix `client_id` + `product_type` + guard `sale_value>0` + `product_name` fallback + `approved`.
- `tests/unit/carteira-order-auto-approve.test.ts` **(novo)** — regressão: insert com `approved` + invalidação das queries de KPI.

## Decisões

- **Split money vs health**: o trigger recomputa só colunas de dinheiro/recência (SQL puro). `health_score`/`segment`/`churn`/`trend` continuam no cron (dependem de engagement + orgAvgTicket + algoritmo em TS; replicar em SQL divergiria). KPIs de venda atualizam em segundos; segmento refina no próximo cron.
- **Validação sem dev**: dev inalcançável via MCP (token prod-only). Mitigado com diff read-only **11/11 clientes** (função SQL == valores gravados pelo edge fn) + review adversarial (5 lentes, veredito fix-then-ship) + teste de trigger ao vivo em transação com `RAISE`/rollback (count 1→2, avg recomputa, zero persistência).
- **Trade-offs aceitos** (documentados na migration): trigger `FOR EACH ROW` → import em massa recomputa K× (custo triangular, OK no volume); `days_since_last_order` só diverge do cron p/ `sold_at` futuro (data inválida) e o valor daqui é o mais correto.
- **Observação pré-existente** (não do fix): `overdue_count` conta os ~640 clientes sem pedido (`days_since=999 > cycle*1.15`) como "recompra atrasada". Semântica antiga da KPI — revisitar na Camada 2.

## Pendente — Camada 2 (ERP como fonte de verdade)

Sync TinyERP → carteira. Infra parcial existe (`erp-order-webhook` grava pedido, mas em `pending` + casa cliente só por nome; sem pull agendado; sem sync de lista de clientes). basic4u conectada ao Tiny mas sync morto desde abr/10. Política de clientes (canônico por CNPJ vs enriquecer) a decidir na construção.
