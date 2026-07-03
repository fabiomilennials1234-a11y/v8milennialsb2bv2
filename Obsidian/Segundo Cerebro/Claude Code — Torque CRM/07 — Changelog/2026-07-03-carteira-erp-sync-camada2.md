# 2026-07-03

## Mudanças — Carteira Camada 2 (TinyERP como fonte de verdade)

Sequência da Camada 1 (recompute síncrono). Traz o histórico de pedidos do TinyERP pra dentro da carteira, alimentando as métricas automaticamente.

- **carteira/erp**: novo worker **`tinyerp-pull-orders`** — puxa `pedidos.pesquisa` (últimos 12m) do Tiny, filtra situação de venda (Entregue/Faturado/Atendido/Enviado), dedup por `tiny_order_id`, chama `pedido.obter` por pedido (cliente+CNPJ+itens, rate-limited), casa/cria `upsell_client` por nome-pessoa e insere `upsell_order` **approved**. O trigger da Camada 1 recomputa a métrica do cliente na hora. **Limitado** (`max_obter`) + **resumível** (cursor `order_pull_cursor`) → cron reentra sem estado próprio.
- **carteira/erp**: **`tinyerp-sync-contacts`** — sync de contatos Tiny → `upsell_clients` (modo `off`/`enrich_only`/`canonical`). Opcional no modelo escolhido (cliente derivado do pedido); serve pra enriquecer CNPJ.
- **fix `erp-order-webhook`** (path push real-time): agora grava `approved` (antes `pending` = invisível pra métrica), casa cliente por **CNPJ** (payload já traz, era ignorado) → nome → company → **auto-cria** (antes pulava o pedido), dedup por `tiny_order_id`. Corrige também `origin:'erp'` (violava CHECK `new_business|upsell`) → `'upsell'`.
- **fix**: `runtime_logs.module` CHECK não aceitava `'general'`/`'carteira'` → `logRuntime` desses módulos falhava silencioso (erp-order-webhook nunca logava). Ampliado.
- **cron**: `tinyerp-pull-orders-basic4u` (a cada 3min) roda o backfill dos ~13.800 pedidos da basic4u em lotes, autônomo, idle quando `order_pull_cursor=0`.

## Modelo (decisão CTO)

- **Escopo**: pedidos recentes primeiro (12m), incremental. Backfill do resto opcional.
- **Cliente derivado do pedido** (nome-pessoa), carteira continua person-based. Descoberto que contatos Tiny são empresas/CNPJ (overlap 6% por nome com os 655), mas `pedido.nome` = pessoa casa bem a carteira. CNPJ populado via `pedido.obter`.
- **Escala**: Tiny da basic4u tem ~13.800 pedidos/12m (138 páginas). Backfill via cron ~7h.

## Arquivos tocados

- `supabase/migrations/20270108000000_carteira_erp_sync_schema.sql` — upsell_clients += cnpj/tiny_contact_id/external_source/tiny_synced_at + índices; tinyerp_connections += last_contact_sync_at/last_order_pull_at/contact_sync_mode. **Prod.**
- `supabase/migrations/20270109000000_carteira_erp_order_dedup.sql` — upsell_orders.tiny_order_id + unique parcial. **Prod.**
- `supabase/migrations/20270110000000_carteira_erp_pull_cursor.sql` — tinyerp_connections.order_pull_cursor. **Prod.**
- `supabase/migrations/20270111000000_runtime_logs_module_add_general_carteira.sql` — amplia CHECK module. **Prod.**
- `supabase/functions/tinyerp-pull-orders/index.ts` — worker principal. **Deployado (v2).**
- `supabase/functions/tinyerp-sync-contacts/index.ts` — sync contatos (opcional). **Deployado.**
- `supabase/functions/erp-order-webhook/index.ts` — fix approved/CNPJ/auto-cria/dedup/origin. **Deployado (v12).**
- `supabase/config.toml` — tinyerp-sync-contacts + tinyerp-pull-orders (no-jwt).

## Validação (prod, basic4u)

- Dry-run confirmou mapping real do `pedido.obter` (cliente+CNPJ+itens).
- Rodada real: pedidos ERP casaram clientes existentes por nome, trigger Camada 1 recomputou (order_count/avg/ltv/next). Cursor NULL→2, enrich populou CNPJ em clientes casados.
- Cron job 87 firing a cada 3min (succeeded).

## Pendente / follow-up

- Frontend da Camada 1 (auto-aprovar venda manual) — merge + deploy EasyPanel.
- Config Tiny-side do webhook (`erp-order-webhook`) — Tiny não empurra pedido hoje (0 chamadas históricas); backfill via pull cobre o histórico.
- Generalizar cron pra outras orgs com Tiny (hoje só basic4u).
- Backfill completo (>12m) se quiser LTV histórico total.
