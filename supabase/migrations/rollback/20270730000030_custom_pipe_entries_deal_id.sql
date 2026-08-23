-- ROLLBACK de 20270730000030_custom_pipe_entries_deal_id.sql
--
-- SCRUM-248. A migration acrescenta `custom_pipe_entries.deal_id` (coluna + FK +
-- índice), reescreve `sync_custom_pipe_to_entries()` para propagar o vínculo, e
-- cria o gatilho reverso `trg_sync_deal_id_to_custom_pipe_entry` em
-- `pipeline_entries`.
--
-- 🔴 A ORDEM É A ARMADILHA, E ELA JÁ MORDEU UMA VEZ
-- A reinstalação do sync SEM `deal_id` vem PRIMEIRO. Se
-- `sync_custom_pipe_to_entries()` ainda mencionar `deal_id` depois do
-- `DROP COLUMN`, **todo arrastar-e-soltar de card custom quebra em produção**
-- com `record "new" has no field "deal_id"`. É o mesmo modo de falha que o passo
-- 0 da migration existe para pegar — só que causado pelo rollback. A receita
-- original do cabeçalho da migration estava na ordem errada e foi corrigida lá;
-- este arquivo já nasce certo.
--
-- ── ESTE ARQUIVO NÃO REINSTALA O SYNC. ELE EXIGE QUE VOCÊ JÁ TENHA FEITO ──
-- SQL não lê arquivo do disco. O corpo anterior de `sync_custom_pipe_to_entries`
-- vive em `supabase/migrations/rollback/_corpos-anteriores/sync_custom_pipe_to_entries.sql`,
-- capturado do banco vivo pelo **passo 4b** da spec
-- (`node scripts/capturar-corpos-antes-do-apply.mjs`), ANTES do apply.
--
-- Sequência correta:
--
--   1. psql/CLI: rodar `_corpos-anteriores/sync_custom_pipe_to_entries.sql`
--      (é um `CREATE OR REPLACE` completo);
--   2. só então: este arquivo.
--
-- A seção 0 verifica o passo 1 e **aborta** se ele não foi feito. Não é
-- formalidade: é a diferença entre um rollback e uma queda de produção.
--
-- ⚠️ SE A CAPTURA NÃO EXISTE, NÃO HÁ ROLLBACK. O corpo antigo não está no banco
-- (o `CREATE OR REPLACE` do apply o destruiu) e o baseline é uma foto de janeiro,
-- com 35 versões de prod sem arquivo no repo entre uma coisa e outra. Nesse caso
-- a fonte é um dump anterior ao apply. Este arquivo aborta e diz isso.
--
-- ── PERDA DE DADO, E O QUE FAZEMOS A RESPEITO ─────────────────────────────
-- O `DROP COLUMN deal_id` apaga os vínculos já gravados. A migration mandava
-- "exportar antes" — em prosa, como tarefa manual. Aqui a exportação é a seção 1
-- e roda sozinha: `backup_custom_pipe_entries_deal_id` guarda os pares
-- `(id, deal_id)` antes do DROP, com RLS antes do INSERT.

BEGIN;

-- ── 0. O sync já foi reinstalado sem `deal_id`? ────────────────────────────
DO $$
DECLARE v_corpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sync_custom_pipe_to_entries';

  IF v_corpo IS NULL THEN
    RAISE EXCEPTION
      'ABORTADO: sync_custom_pipe_to_entries() não existe neste banco. Reinstale-a a partir de supabase/migrations/rollback/_corpos-anteriores/sync_custom_pipe_to_entries.sql antes de rodar este rollback.'
      USING ERRCODE = 'undefined_function';
  END IF;

  IF v_corpo LIKE '%deal_id%' THEN
    RAISE EXCEPTION
      'ABORTADO — E ESTA GUARDA ACABOU DE EVITAR UMA QUEDA: sync_custom_pipe_to_entries() ainda menciona deal_id. Se o DROP COLUMN rodasse agora, todo arrastar-e-soltar de card custom quebraria com `record "new" has no field "deal_id"`. Rode PRIMEIRO supabase/migrations/rollback/_corpos-anteriores/sync_custom_pipe_to_entries.sql (capturado pelo passo 4b), depois este arquivo. Se aquela captura não existe, NÃO HÁ rollback por este caminho — a fonte é um dump anterior ao apply.'
      USING ERRCODE = 'invalid_function_definition';
  END IF;

  RAISE NOTICE 'Guarda 0 OK: o sync já está na versão sem deal_id.';
END$$;

-- ── 1. Exportar os vínculos que o DROP COLUMN vai apagar ───────────────────
DO $$
DECLARE v_n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'custom_pipe_entries' AND column_name = 'deal_id'
  ) THEN
    CREATE TABLE IF NOT EXISTS public.backup_custom_pipe_entries_deal_id (
      entry_id     uuid PRIMARY KEY,
      deal_id      uuid NOT NULL,
      capturado_em timestamptz NOT NULL DEFAULT now()
    );

    -- RLS antes do INSERT, como em backup_aposenta_funis_carteira. Sem policy =
    -- deny-all para anon/authenticated.
    EXECUTE 'ALTER TABLE public.backup_custom_pipe_entries_deal_id ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.backup_custom_pipe_entries_deal_id FROM PUBLIC, anon, authenticated';

    EXECUTE $sql$
      INSERT INTO public.backup_custom_pipe_entries_deal_id (entry_id, deal_id)
      SELECT id, deal_id FROM public.custom_pipe_entries WHERE deal_id IS NOT NULL
      ON CONFLICT (entry_id) DO NOTHING
    $sql$;

    SELECT count(*) INTO v_n FROM public.backup_custom_pipe_entries_deal_id;
    RAISE NOTICE 'BACKUP: % vínculo(s) (entry_id, deal_id) guardado(s) antes do DROP COLUMN.', v_n;
  ELSE
    RAISE NOTICE 'Coluna deal_id já não existe em custom_pipe_entries — nada a exportar.';
  END IF;
END$$;

-- ── 2. Derrubar, na ordem inversa da criação ───────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_deal_id_to_custom_pipe_entry ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.fn_sync_deal_id_to_custom_pipe_entry();
DROP INDEX IF EXISTS public.idx_custom_pipe_entries_deal;
ALTER TABLE public.custom_pipe_entries DROP CONSTRAINT IF EXISTS custom_pipe_entries_deal_id_fkey;
ALTER TABLE public.custom_pipe_entries DROP COLUMN IF EXISTS deal_id;

-- ── 3. Verificação ─────────────────────────────────────────────────────────
DO $$
DECLARE v_col int; v_trg int; v_fn int; v_bkp bigint := 0;
BEGIN
  SELECT count(*) INTO v_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'custom_pipe_entries' AND column_name = 'deal_id';
  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_sync_deal_id_to_custom_pipe_entry';
  SELECT count(*) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_sync_deal_id_to_custom_pipe_entry';

  IF v_col <> 0 THEN RAISE EXCEPTION 'FAIL: custom_pipe_entries.deal_id ainda existe.'; END IF;
  IF v_trg <> 0 THEN RAISE EXCEPTION 'FAIL: trg_sync_deal_id_to_custom_pipe_entry ainda existe.'; END IF;
  IF v_fn  <> 0 THEN RAISE EXCEPTION 'FAIL: fn_sync_deal_id_to_custom_pipe_entry ainda existe.'; END IF;

  IF to_regclass('public.backup_custom_pipe_entries_deal_id') IS NOT NULL THEN
    SELECT count(*) INTO v_bkp FROM public.backup_custom_pipe_entries_deal_id;
  END IF;

  RAISE NOTICE
    'ROLLBACK OK: coluna, FK, índice, gatilho reverso e função fora. % vínculo(s) preservado(s) em backup_custom_pipe_entries_deal_id — é a ÚNICA cópia deles; reaplicar a migration NÃO os repõe sozinha.',
    v_bkp;
END$$;

COMMIT;
