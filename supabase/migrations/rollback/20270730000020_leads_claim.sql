-- ROLLBACK de 20270730000020_leads_claim.sql (fatia 2 — Lead ↔ Negócio)
--
-- A migration é aditiva: 2 colunas em `leads` (claimed_by/claimed_at), FK,
-- CHECK do par (unidirecional — `claimed_by IS NULL OR claimed_at IS NOT NULL`),
-- índice parcial e `'claimed_by'` somado à allow-list de
-- `fn_track_lead_field_changes`.
-- Os DROPs abaixo são por NOME, então independem da forma da CHECK.
--
-- ⚠️ ORDEM É OBRIGATÓRIA — função ANTES da coluna.
-- `fn_track_lead_field_changes` lê os campos por nome via
-- `EXECUTE format('SELECT ($1).%I::text, ...')` sobre OLD/NEW. Se a coluna for
-- dropada enquanto `'claimed_by'` ainda está no array, TODO UPDATE em `leads`
-- passa a estourar `column "claimed_by" does not exist` — o app inteiro para de
-- salvar lead. Dropar a coluna primeiro é o jeito de transformar um rollback
-- rotineiro em incidente.
--
-- ⚠️ PERDA DE DADO: dropar as colunas apaga os claims vigentes. O histórico
-- sobrevive (`field_changes.field_name = 'claimed_by'` e as linhas
-- `lead_history.action = 'field_updated'` com a chave `claimed_by` no
-- `metadata->'changes'`), então o estado é reconstruível — mas NÃO
-- automaticamente. Se houver claim ativo e a intenção for só desligar a
-- feature, prefira reverter apenas o CÓDIGO (esconder o botão): coluna
-- nullable que ninguém escreve é inerte e não custa nada.
--
-- Snapshot antes de reverter com dado vivo — o filtro tem as DUAS pernas de
-- propósito: a invariante é unidirecional, então existe linha legítima com
-- `claimed_by` NULL e `claimed_at` preenchido (resíduo do ON DELETE SET NULL,
-- "esteve assumido até o vendedor sair"). Filtrar só por `claimed_by IS NOT
-- NULL` perderia essas linhas em silêncio:
--   SELECT id, claimed_by, claimed_at FROM public.leads
--    WHERE claimed_by IS NOT NULL OR claimed_at IS NOT NULL;

-- ── 1. Função volta à allow-list de 13 campos (SEM 'claimed_by') ────────────
-- Corpo idêntico ao original; SECURITY DEFINER e o SET search_path fazem parte
-- do contrato (o corpo usa `field_changes`, `lead_history` e `auth.uid()` sem
-- qualificar schema).
CREATE OR REPLACE FUNCTION public.fn_track_lead_field_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_field text;
  v_tracked_fields text[] := ARRAY[
    'name', 'company', 'email', 'phone', 'origin',
    'rating', 'qualification_score',
    'responsible_id', 'sdr_id', 'closer_id',
    'ai_disabled', 'notes', 'segment'
  ];
  v_old_val text;
  v_new_val text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_field IN ARRAY v_tracked_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_field, v_field)
      INTO v_old_val, v_new_val
      USING OLD, NEW;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO field_changes (organization_id, entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (NEW.organization_id, 'lead', NEW.id, v_field, v_old_val, v_new_val, auth.uid());

      v_changes := v_changes || jsonb_build_object(
        v_field, jsonb_build_object('from', v_old_val, 'to', v_new_val)
      );
    END IF;
  END LOOP;

  IF v_changes != '{}'::jsonb THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.id,
      NEW.organization_id,
      'field_updated',
      'Campos atualizados',
      'system',
      jsonb_build_object('changes', v_changes),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- O trigger `trg_lead_field_changes` nunca foi tocado (AFTER UPDATE FOR EACH
-- ROW, sem lista de colunas) — não há nada a restaurar nele.

-- ── 1b. A trava do M6 sai ANTES — medido em branch efêmera 2026-08-06 ──────
--
-- `fn_assert_member_same_org` cobre OITO colunas, e `claimed_by` é uma delas.
-- Os três gatilhos são `BEFORE INSERT OR UPDATE OF <colunas>`, o que cria
-- dependência de COLUNA no catálogo. Com o M6 aceso, o `DROP COLUMN` abaixo
-- não é um risco teórico: ele FALHA, com
--
--     cannot drop column claimed_by of table leads because other objects
--     depend on it
--
-- e o rollback morre no meio — que é o pior momento para descobrir isso, já
-- que rollback se roda em incidente. Este bloco foi acrescentado depois de
-- exercitar o arquivo pela primeira vez (SCRUM-89 / `inv:H3-16`); antes disso
-- ele nunca tinha rodado contra um banco com o M6 no ar.
--
-- ⚠️ CONSEQUÊNCIA: ao fim deste rollback a trava cross-org fica DESLIGADA.
-- Para reacendê-la sem o claim, reaplique
-- `20270731000010_assert_member_same_org.sql` **depois** de recriar as colunas
-- — a função referencia `claimed_by` e não compila sem ela.
DROP TRIGGER IF EXISTS trg_assert_member_same_org_leads ON public.leads;
DROP TRIGGER IF EXISTS trg_assert_member_same_org_pipeline_entries ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_assert_member_same_org_custom_pipe_entries ON public.custom_pipe_entries;

-- ── 2. Índice, constraints e colunas ────────────────────────────────────────
-- DROP COLUMN já derruba a FK, a CHECK e o índice parcial em cascata; os DROPs
-- explícitos abaixo existem pra o caso de rollback PARCIAL (apply que morreu no
-- meio) e são todos IF EXISTS.
DROP INDEX IF EXISTS public.idx_leads_claimed_by;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_claim_pair_check;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_claimed_by_fkey;

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS claimed_at,
  DROP COLUMN IF EXISTS claimed_by;

-- ── 3. Verificação do rollback ──────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.leads'::regclass
      AND attname IN ('claimed_by', 'claimed_at')
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'FAIL: colunas de claim ainda existem em leads.';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_track_lead_field_changes';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: fn_track_lead_field_changes desapareceu.';
  END IF;
  IF position('''claimed_by''' in v_src) > 0 THEN
    RAISE EXCEPTION 'FAIL: allow-list ainda cita claimed_by — todo UPDATE em leads vai estourar.';
  END IF;
  IF position('''segment''' in v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: allow-list original não foi restaurada (segment ausente).';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname LIKE 'trg_assert_member_same_org%' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: a trava do M6 sobreviveu ao rollback — ela depende de claimed_by e teria bloqueado o DROP.';
  END IF;

  RAISE NOTICE 'ROLLBACK OK: claim removido de leads, allow-list de volta aos 13 campos, e trava do M6 DESLIGADA (reaplique 20270731000010 depois de recriar as colunas).';
END$$;
