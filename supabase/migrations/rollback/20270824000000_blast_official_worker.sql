-- ROLLBACK de 20270824000000_blast_official_worker.sql (#1722)
--
-- Devolve o banco à forma anterior ao motor do Canal Oficial: sem cron, sem
-- claim, sem índice de reivindicação e sem a coluna de Template.
--
-- ⚠️ ORDEM IMPORTA. O cron sai PRIMEIRO: derrubar a função enquanto o job ainda
-- existe deixaria o pg_cron chamando uma função inexistente a cada minuto, e o
-- erro apareceria como ruído recorrente sem causa óbvia.
--
-- ⚠️ `DROP COLUMN template` é IRREVERSÍVEL quanto ao conteúdo: o Template
-- congelado de qualquer Disparo oficial já criado morre com ela. Enquanto
-- nenhum Disparo oficial tiver sido criado, a coluna está vazia e a perda é
-- nula — que é a situação no momento em que este arquivo foi escrito.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-blast-recipients')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-blast-recipients');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.invoke_process_blast_recipients();

DROP FUNCTION IF EXISTS public.claim_blast_recipients(INT, INT);

DROP INDEX IF EXISTS public.idx_blast_plan_recipients_claim;

ALTER TABLE public.blast_plans
  DROP COLUMN IF EXISTS template;
