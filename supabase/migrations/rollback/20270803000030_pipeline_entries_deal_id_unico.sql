-- ROLLBACK de 20270803000030_pipeline_entries_deal_id_unico.sql
--
-- SCRUM-248. A migration cria `uq_pipeline_entries_deal_id`, índice único
-- PARCIAL sobre `pipeline_entries (deal_id) WHERE deal_id IS NOT NULL` — a forma
-- de "um Negócio ocupa uma posição" (ADR-0023 decisão 5).
--
-- Este rollback é o mais barato dos cinco: derruba um índice, não toca dado, e
-- nada depende dele por nome (nenhum `ON CONFLICT ON CONSTRAINT`, nenhuma FK —
-- é índice nu, não constraint, então não há linha em `pg_constraint`).
--
-- QUANDO PRECISA: se o backfill M4 produzir dois cards apontando para o mesmo
-- negócio, o índice recusa o segundo com 23505 e o backfill morre no meio da org.
-- Derrubar o índice destrava o backfill para investigar — mas ⚠️ derrubar é
-- afrouxar a invariante, não consertar o backfill. O certo é achar por que dois
-- cards ganharam o mesmo `deal_id` (a query de diagnóstico está na seção 2) e
-- reacender.
--
-- ⚠️ A JANELA PARA REACENDER FECHA se alguém criar a duplicata enquanto o índice
-- está fora — `CREATE UNIQUE INDEX` recusa e a mensagem só diz "could not create
-- unique index", sem apontar as linhas. Por isso a seção 2 imprime as linhas
-- ANTES: é o insumo do reacendimento, e é agora que ele é barato de colher.

BEGIN;

-- ── 1. O índice ─────────────────────────────────────────────────────────────
-- Sem CONCURRENTLY porque este arquivo é transacional (CONCURRENTLY não roda
-- dentro de transação). `DROP INDEX` toma ACCESS EXCLUSIVE brevemente; para
-- derrubar sob carga sem travar escrita, rode fora do push:
--   DROP INDEX CONCURRENTLY public.uq_pipeline_entries_deal_id;
DROP INDEX IF EXISTS public.uq_pipeline_entries_deal_id;

-- ── 2. Verificação + diagnóstico do reacendimento ───────────────────────────
DO $$
DECLARE v_n int; v_dup bigint; r record;
BEGIN
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'uq_pipeline_entries_deal_id';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL: uq_pipeline_entries_deal_id ainda existe depois do DROP.';
  END IF;

  -- Quantos negócios ocupam mais de uma posição AGORA. Com o índice recém-fora
  -- isto é 0 por construção; o valor de imprimir é o dia em que este rollback for
  -- rodado por causa de um 23505 — aí o número já foi produzido pelo backfill e é
  -- exatamente o que precisa ser investigado.
  SELECT count(*) INTO v_dup FROM (
    SELECT deal_id FROM public.pipeline_entries
     WHERE deal_id IS NOT NULL GROUP BY deal_id HAVING count(*) > 1
  ) x;

  IF v_dup > 0 THEN
    FOR r IN
      SELECT deal_id, count(*) AS n, array_agg(id ORDER BY created_at) AS entry_ids
        FROM public.pipeline_entries
       WHERE deal_id IS NOT NULL
       GROUP BY deal_id HAVING count(*) > 1
       ORDER BY 2 DESC LIMIT 20
    LOOP
      RAISE WARNING 'DUPLICATA: negócio % ocupa % posições — entries %', r.deal_id, r.n, r.entry_ids;
    END LOOP;
  END IF;

  RAISE NOTICE
    'ROLLBACK OK: uq_pipeline_entries_deal_id fora. % negócio(s) ocupando mais de uma posição (0 = pode reacender direto reaplicando a migration; >0 = resolva as linhas dos WARNINGs acima antes, senão o CREATE UNIQUE INDEX recusa sem dizer quais).',
    v_dup;
END$$;

COMMIT;
