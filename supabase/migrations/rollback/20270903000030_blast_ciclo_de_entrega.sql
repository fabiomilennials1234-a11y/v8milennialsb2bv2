-- ============================================================================
-- ROLLBACK — #1724, ciclo de entrega
--
-- ⚠️ ORDEM IMPORTA, E ESTE ARQUIVO TEM DE RODAR ANTES DO ROLLBACK DO #1721.
--
--   `rollback/20270823000000_blast_recipient_delivery_state.sql` devolve o CHECK
--   de `status` a quatro valores. A partir da #1724 existem linhas gravadas como
--   `delivered` e `unconfirmed` em produção, e o CHECK antigo as recusa com
--   23514 — o rollback do #1721 falharia no meio, deixando o banco entre dois
--   estados. O bloco 1 abaixo é o que torna aquele rollback aplicável de novo.
--
-- ESTE ARQUIVO CONTÉM DML DE PROPÓSITO, e é a exceção certa à guarda F4: o apply
-- é só schema; a REVERSÃO de um estado só se faz mexendo no estado.
--
-- ⚠️ O bloco 1 PERDE INFORMAÇÃO, e não há como não perder: uma linha que foi
-- entregue volta a dizer apenas "saiu". Rode-o só se de fato for reverter o
-- #1721 — reverter só o #1724 (blocos 2 a 5) não exige tocar em dado nenhum.
-- ============================================================================

-- ─── 1. O estado, SÓ se for reverter o #1721 junto ──────────────────────────
-- Descomente conscientemente. `delivered` e `unconfirmed` voltam a `sent`, que é
-- de onde os dois vieram e o único dos quatro valores antigos que não mente:
-- a mensagem realmente saiu.
--
-- UPDATE public.blast_plan_recipients
--    SET status       = 'sent',
--        delivered_at = NULL,
--        actual_cost  = NULL
--  WHERE status IN ('delivered', 'unconfirmed');

-- ─── 2. O cron, primeiro ────────────────────────────────────────────────────
-- Antes da função: job agendado apontando para função inexistente falha a cada
-- tique, e o erro aparece longe da causa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('encerrar-entregas-vencidas')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encerrar-entregas-vencidas');
  END IF;
END $$;

-- ─── 3. A função ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.encerrar_entregas_vencidas();

-- ─── 4. O índice ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_blast_plan_recipients_entrega_vencida;

-- ─── 5. Nada mais ───────────────────────────────────────────────────────────
-- Esta migration não criou coluna, constraint, policy nem grant de tabela. As
-- colunas de entrega e custo são do #1721 e continuam onde estavam.
