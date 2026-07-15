-- 20270205000000_omie_pedidos_external_ids.sql
-- S5 (#1105): identidade externa genérica em upsell_orders para a camada multi-ERP.
-- Adiciona external_source/external_id/external_ref e migra o legado tiny_order_id
-- para as colunas genéricas. tiny_order_id é MANTIDO por enquanto (código Tiny vivo
-- ainda lê/escreve nele; drop só depois do Tiny ser roteado pelo ERPProvider — S6).
-- source já aceita 'erp' no CHECK. Aditivo — sem impacto destrutivo.

ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.upsell_orders ADD COLUMN IF NOT EXISTS external_ref TEXT;

-- Backfill 1:1 do id externo legado (sem tocar atribuição/receita).
UPDATE public.upsell_orders
  SET external_source = 'tiny', external_id = tiny_order_id
  WHERE tiny_order_id IS NOT NULL AND external_id IS NULL; -- metric-lint-allow: backfill de id externo, não altera papéis nem valores

CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_orders_external
  ON public.upsell_orders (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
