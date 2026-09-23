-- ROLLBACK pareado da 20270929000000 (S6 retrovisor — projeção do histórico).
--
-- Desfaz SÓ o que aquela passada escreveu, e só onde ninguém escreveu por cima.
--
-- O critério é o `rev` do livro `backup.entries_projecao_s6_20270929`, não o
-- carimbo em si: as 17 entradas da 20270928000000 também carregam
-- `agenda_espelho`, e apagar por presença de carimbo levaria as delas junto.
-- Se o `rev` da entrada mudou, alguém (o trigger do espelho, o card, a Agenda)
-- reescreveu depois — e nesse caso o valor de lá é mais novo que o nosso, então
-- a linha fica DE PÉ. Reverter escrita alheia é o defeito que o rollback da
-- fatia anterior tinha e que custou um bloqueante.
--
-- Sem o livro, não reverte nada: adivinhar qual projeção é de quem é
-- exatamente o erro que o livro existe para impedir.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $rollback_retrovisor$
DECLARE
  v_no_livro int;
  v_revertidas int;
BEGIN
  IF to_regclass('backup.entries_projecao_s6_20270929') IS NULL THEN
    RAISE WARNING 'S6 retrovisor rollback: livro backup.entries_projecao_s6_20270929 AUSENTE — nada revertido. Adivinhar qual projeção é desta passada é o defeito que o livro previne.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_no_livro FROM backup.entries_projecao_s6_20270929;

  UPDATE public.pipeline_entries pe
     SET metadata = pe.metadata - 'meeting_date' - 'agenda_espelho'
    FROM backup.entries_projecao_s6_20270929 b
   WHERE pe.id = b.entry_id
     AND pe.metadata #>> '{agenda_espelho,rev}' = b.rev;

  GET DIAGNOSTICS v_revertidas = ROW_COUNT;

  RAISE NOTICE 'S6 retrovisor rollback: % de % entradas revertidas. As % restantes foram reescritas depois do apply e ficam de pé.',
    v_revertidas, v_no_livro, v_no_livro - v_revertidas;

  DROP TABLE backup.entries_projecao_s6_20270929;
END;
$rollback_retrovisor$;
