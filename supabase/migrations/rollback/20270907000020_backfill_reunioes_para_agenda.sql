-- Rollback do backfill S4 (20270907000020).
--
-- Só apaga o que o backfill criou — a procedência em `external_ref` é o que
-- torna isto possível. Reunião criada por gente não tem esse prefixo e não é
-- tocada. Nenhuma outra tabela é alterada: `meeting_events` e
-- `pipe_confirmacao` nunca foram lidos destrutivamente.
--
-- ⚠️ Não desfaz o `CREATE OR REPLACE` de `get_agenda_events`. Não precisa: com
-- as linhas do backfill fora, as guardas `NOT EXISTS` das Sources 4 e 5 param
-- de casar sozinhas e a função volta a devolver o que devolvia. Reverter a
-- função também seria APAGAR a guarda da Source 5, que é anterior a esta
-- fatia (20270831000020).
BEGIN;

SELECT count(*) AS linhas_a_remover
FROM public.meetings
WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

DELETE FROM public.meetings
WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%';

COMMIT;
