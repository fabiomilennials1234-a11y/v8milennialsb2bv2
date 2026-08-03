-- ============================================================================
-- Passo 6 do L2 — "um Negócio, uma posição", garantido pelo banco.
--
-- ADR-0023 decisão 5: a posição mora no card. Um Negócio ocupar dois lugares é a
-- segunda verdade que a decisão 4 existe para matar — e mantê-la impossível é
-- trabalho de índice, não de disciplina espalhada por 26 caminhos de escrita.
--
-- ── POR QUE ELE JÁ PODE ENTRAR, e não depois do backfill ───────────────────
-- O plano dizia "criar DEPOIS do backfill do L3, senão ele recusa o estado
-- intermediário". Isso valia enquanto o backfill fundia jornadas (decisão 11).
-- Com a decisão 11 revertida — um negócio por card —, dois cards nunca chegam a
-- apontar para o mesmo negócio, e não existe estado intermediário para recusar.
--
-- O índice é PARCIAL (`WHERE deal_id IS NOT NULL`). Hoje, em prod, as 38.156
-- entries têm `deal_id` NULL: ele nasce vazio e não recusa nada. Conforme o
-- backfill roda org a org, ele passa a proteger cada org já migrada — chegar
-- antes é melhor do que chegar depois.
--
-- NULL não conflita em unique no Postgres, então card ainda não backfillado
-- convive com card backfillado sem drama. É o que permite o rollout por org.
--
-- ── PROVADO EM BRANCH EFÊMERA (aestgnzpmbsrpalsxoho, 2026-08-03) ───────────
-- Criado sobre um estado já backfillado (5 cards, 5 negócios): aceito. E testado
-- pelo lado que importa — apontar dois cards para o mesmo negócio levantou
-- `unique_violation`. Índice que é aceito mas não morde é decoração.
--
-- Só schema (guarda F4): nenhuma linha de dado é lida ou escrita.
-- ============================================================================

BEGIN;

-- Sem CONCURRENTLY: ele não roda dentro de transação, e aqui a transação é o que
-- garante que ou o índice e sua verificação entram juntos, ou nada entra. O lock
-- é curto porque o índice nasce praticamente vazio (0 linhas com deal_id em prod
-- hoje). Numa org já backfillada, reavaliar se vale o CONCURRENTLY fora de
-- transação — mas aí a verificação abaixo sai junto, e é ela que prova que o
-- índice morde.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_entries_deal_id
  ON public.pipeline_entries (deal_id)
  WHERE deal_id IS NOT NULL;

COMMENT ON INDEX public.uq_pipeline_entries_deal_id IS
  'ADR-0023 decisão 5: um Negócio ocupa uma posição. Parcial porque `deal_id` NULL é o estado normal do card ainda não backfillado, e NULL não conflita — é o que permite o rollout org a org.';

DO $$
DECLARE v_dup bigint; v_cobertos bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND indexname='uq_pipeline_entries_deal_id') THEN
    RAISE EXCEPTION 'FAIL: o indice unico nao existe depois do CREATE.';
  END IF;

  -- Redundante com o próprio índice (ele teria falhado no CREATE), e de propósito:
  -- se alguém trocar por um índice não-único no futuro, esta linha acusa.
  SELECT count(*) INTO v_dup FROM (
    SELECT deal_id FROM public.pipeline_entries
     WHERE deal_id IS NOT NULL GROUP BY deal_id HAVING count(*) > 1
  ) x;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'FAIL: % negocio(s) ocupam mais de uma posicao.', v_dup;
  END IF;

  SELECT count(*) INTO v_cobertos FROM public.pipeline_entries WHERE deal_id IS NOT NULL;
  RAISE NOTICE
    'VALIDATION PASSED: uq_pipeline_entries_deal_id no ar, cobrindo % card(s) com negocio. Card sem negocio (deal_id NULL) nao e afetado — o rollout por org continua possivel.',
    v_cobertos;
END$$;

COMMIT;
