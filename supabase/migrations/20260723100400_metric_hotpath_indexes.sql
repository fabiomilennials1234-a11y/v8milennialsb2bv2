-- 20260723100400_metric_hotpath_indexes.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — Métricas Montáveis, Camada 2, fatia 5/5.
-- Índices compostos do caminho quente (orçamento #1208: TV poll 30s × 12 widgets).
--
-- SÓ o que FALTA. Verificado contra o baseline de prod — já existem e NÃO se
-- recriam aqui:
--   sale_events    : idx_sale_events_org_sold (org,sold_at),
--                    idx_sale_events_org_stream_sold, idx_sale_events_org_lead_sold_at.
--   meeting_events : idx_meeting_events_org_type_occurred (booked),
--                    idx_meeting_events_org_type_meeting_date (held).
--   pipeline_stage_events: idx_pipeline_stage_events_org_pipeline_occurred, _org_occurred.
--
-- Todos CREATE INDEX IF NOT EXISTS — idempotente, seguro em replay.
-- ROLLBACK pareado: rollback/20260723100400_metric_hotpath_indexes.sql (DROPs).

-- tempo_medio_etapa: DISTINCT ON (lead_id, pipeline_id) ORDER BY occurred_at DESC.
-- O índice casa a chave de distinção + a ordenação descendente.
CREATE INDEX IF NOT EXISTS idx_pse_org_lead_pipe_occurred
  ON public.pipeline_stage_events (organization_id, lead_id, pipeline_id, occurred_at DESC);

-- leads_na_etapa: snapshot de entradas abertas por (pipeline, etapa).
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_open_snapshot
  ON public.pipeline_entries (organization_id, pipeline_id, stage_key)
  WHERE closed_at IS NULL;

-- leads_criados: filtro por COALESCE(metrics_period_at, created_at), vivos.
CREATE INDEX IF NOT EXISTS idx_leads_org_metric_period
  ON public.leads (organization_id, (COALESCE(metrics_period_at, created_at)))
  WHERE deleted_at IS NULL;

-- receita/num_vendas recorte closer + filtro member: (org, sale_responsible_id, sold_at).
CREATE INDEX IF NOT EXISTS idx_sale_events_org_closer_sold
  ON public.sale_events (organization_id, sale_responsible_id, sold_at)
  WHERE event_type = 'sale';

-- recorte tag: varredura reversa lead_tags por tag.
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag_lead
  ON public.lead_tags (tag_id, lead_id);

-- recorte produto: varredura reversa lead_products por produto.
CREATE INDEX IF NOT EXISTS idx_lead_products_product_lead
  ON public.lead_products (product_id, lead_id);
