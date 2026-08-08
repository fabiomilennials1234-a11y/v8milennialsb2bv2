-- =============================================================================
-- ROLLBACK de 20270808000000_whatsapp_instance_reap_queue.sql (#1475)
--
-- ATENÇÃO: derrubar isto reabre o vazamento. Toda Instance apagada enquanto o
-- trigger estiver ausente perde o token em CASCADE e vira órfã inalcançável no
-- provider — inclusive pelo caminho de apagar uma org, que não passa por código.
--
-- Antes de rodar, drenar a fila: confira que não há lápide pendente, senão o
-- DROP TABLE descarta trabalho que o coletor ainda não fez.
--
--   SELECT count(*) FROM public.whatsapp_instance_reap_queue
--    WHERE confirmed_at IS NULL AND gave_up_at IS NULL;
-- =============================================================================

DROP TRIGGER IF EXISTS trg_whatsapp_instance_reap ON public.whatsapp_instances;
DROP TRIGGER IF EXISTS trg_whatsapp_secret_reap ON public.whatsapp_instance_secrets;

DROP FUNCTION IF EXISTS public.enqueue_whatsapp_instance_reap();
DROP FUNCTION IF EXISTS public.enqueue_whatsapp_secret_reap();

DROP TABLE IF EXISTS public.whatsapp_instance_reap_queue;
