-- ROLLBACK de 20270302000010_pipeline_stage_events.sql (issue #992)
--
-- Remove triggers de captura, trigger de imutabilidade, funções e a tabela —
-- ordem inversa da criação. ATENÇÃO: DROP TABLE descarta o caderno inteiro,
-- incluindo eventos capturados AO VIVO desde o apply (não-deriváveis — a
-- transição já aconteceu e o estado mutável não a guarda). O backfill em si é
-- re-executável (lead_history + pipeline_entries permanecem intactos), mas o
-- período entre apply e rollback vira buraco permanente no funil. Rollback só
-- se o caderno ainda não é fonte de leitura (pré-SP-3).
--
-- O DROP TABLE dispara o trigger de imutabilidade? Não — DROP TABLE não
-- executa triggers de row. Removemos os triggers antes mesmo assim, pra
-- deixar o estado intermediário consistente se o script parar no meio.

BEGIN;

-- Captura em pipeline_entries
DROP TRIGGER IF EXISTS trg_pipeline_entries_stage_event_insert
  ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_pipeline_entries_stage_event_update
  ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.fn_capture_pipeline_stage_event();

-- Imutabilidade no caderno
DROP TRIGGER IF EXISTS trg_pipeline_stage_events_immutable
  ON public.pipeline_stage_events;
DROP FUNCTION IF EXISTS public.fn_pipeline_stage_events_block_mutation();

-- Caderno (policies, índices e constraints caem junto)
DROP TABLE IF EXISTS public.pipeline_stage_events;

COMMIT;
