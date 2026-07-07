-- ROLLBACK de 20270302000030_sale_events.sql (issue #993)
--
-- Remove trigger de captura (no caderno de etapa), normalizador de sold_at,
-- trigger de imutabilidade, resolvedor de role, funções e a tabela — ordem
-- inversa da criação. ATENÇÃO: DROP TABLE descarta o caderno de VENDAS
-- inteiro. Eventos capturados ao vivo desde o apply NÃO são deriváveis
-- (sold_at = momento do registro; snapshot de valor/atribuição/stream é do
-- instante da venda — o estado mutável não os guarda). Rollback só se o
-- caderno ainda não é fonte de leitura (pré-SP-3).
--
-- DROP TABLE não executa triggers de row; removemos os triggers antes mesmo
-- assim, pra deixar estado intermediário consistente se o script parar no meio.

BEGIN;

-- Captura encadeada no caderno de etapa
DROP TRIGGER IF EXISTS trg_pipeline_stage_events_sale_capture
  ON public.pipeline_stage_events;
DROP FUNCTION IF EXISTS public.fn_capture_sale_event();

-- Resolvedor de role
DROP FUNCTION IF EXISTS public.metric_stage_role(uuid, uuid, text);

-- Normalizador de sold_at
DROP TRIGGER IF EXISTS trg_sale_events_force_sold_at ON public.sale_events;
DROP FUNCTION IF EXISTS public.fn_sale_events_force_sold_at();

-- Imutabilidade
DROP TRIGGER IF EXISTS trg_sale_events_immutable ON public.sale_events;
DROP FUNCTION IF EXISTS public.fn_sale_events_block_mutation();

-- Caderno (policies, índices, constraints e FK self caem junto)
DROP TABLE IF EXISTS public.sale_events;

COMMIT;
