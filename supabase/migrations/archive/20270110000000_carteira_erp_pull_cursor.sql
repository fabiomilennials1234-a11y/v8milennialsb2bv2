-- carteira Camada 2 — cursor de paginação do backfill de pedidos ERP
--
-- tinyerp-pull-orders avança as páginas do pesquisa via cursor persistido, pro
-- pg_cron poder reentrar sem estado próprio. Convenção:
--   NULL/1 → começa do início    N → próxima página a processar    0 → backfill concluído (idle)

ALTER TABLE public.tinyerp_connections
  ADD COLUMN IF NOT EXISTS order_pull_cursor integer;

COMMENT ON COLUMN public.tinyerp_connections.order_pull_cursor IS 'Página atual do backfill de pedidos (tinyerp-pull-orders). 0 = concluído.';
