-- 20270821150000_merge_leads_alias_colide_com_variavel.sql
--
-- 🔴 `merge_leads` NUNCA CONCLUI. Mesclar dois leads pela tela /duplicados
-- morre com 42703, e o erro não fala de merge nenhum:
--
--     record "r" has no field "id"
--
-- Achado ao destravar o pgTAP (SCRUM-361): `duplicate_leads_rpcs_test`
-- reprovava as quatro asserções do merge — e a fixture nem chegava a rodar
-- antes, então ninguém tinha visto.
--
-- ## A colisão
--
-- A função declara `r RECORD` e o usa em dois `FOR r IN ... LOOP` (varredura de
-- FKs que apontam para `leads`). Depois dos laços, o último statement escreve:
--
--     UPDATE public.workflow_executions we
--        SET status = 'cancelled', ...
--       FROM ranked r
--      WHERE we.id = r.id AND r.rn > 1;
--
-- Em plpgsql, `r` na cláusula WHERE resolve para a VARIÁVEL, não para o alias
-- da CTE — o parser de plpgsql substitui identificadores conhecidos antes de o
-- SQL ser planejado. A variável guarda a última linha do laço anterior, com os
-- campos `table_schema`/`table_name`/`column_name`. Não tem `id`, e a função
-- morre ali. Sempre: o statement é incondicional.
--
-- Consequência: o merge deixa o banco COM AS DUAS pontas já mexidas — os
-- `UPDATE`s de re-apontamento de FK rodaram — e sem apagar o lead absorvido,
-- porque o `DELETE` vem depois. A transação inteira aborta, então nada é
-- perdido; mas a operação nunca funciona, e o usuário vê um erro de banco cru.
--
-- ## A correção
--
-- Uma letra: o alias da CTE passa a ser `rk`. Corpo idêntico ao vigente em
-- produção no resto — conferido caractere a caractere contra o baseline.
--
-- Nenhum outro `FROM <cte> r` sobrou na função.
--
-- ROLLBACK pareado: rollback/20270821150000_merge_leads_alias_colide_com_variavel.sql

CREATE OR REPLACE FUNCTION "public"."merge_leads"("p_keep_lead_id" "uuid", "p_merge_lead_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_keep_org   uuid;
  v_merge_org  uuid;
  r            RECORD;
  v_other_cols text;
  v_pred       text;
  v_sql        text;
BEGIN
  IF p_keep_lead_id IS NULL OR p_merge_lead_id IS NULL THEN
    RAISE EXCEPTION 'merge_leads: ids obrigatórios' USING ERRCODE = 'P0001';
  END IF;

  IF p_keep_lead_id = p_merge_lead_id THEN
    RAISE EXCEPTION 'merge_leads: não é possível mesclar um lead nele mesmo'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT organization_id INTO v_keep_org  FROM public.leads WHERE id = p_keep_lead_id;
  SELECT organization_id INTO v_merge_org FROM public.leads WHERE id = p_merge_lead_id;

  IF v_keep_org IS NULL OR v_merge_org IS NULL THEN
    RAISE EXCEPTION 'merge_leads: lead não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_keep_org <> v_merge_org THEN
    RAISE EXCEPTION 'merge_leads: leads de organizações diferentes não podem ser mesclados'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.assert_org_access(v_keep_org);

  FOR r IN
    SELECT
      n.nspname                 AS table_schema,
      c.relname                 AS table_name,
      c.oid                     AS table_oid,
      fka.attname               AS fk_col,
      fka.attnum                AS fk_attnum,
      idx.indkey::text          AS indkey_txt,
      (idx.indpred IS NOT NULL) AS is_partial,
      pg_get_expr(idx.indpred, idx.indrelid) AS pred_expr
    FROM pg_constraint fk
    JOIN pg_class     c   ON c.oid  = fk.conrelid
    JOIN pg_namespace n   ON n.oid  = c.relnamespace
    JOIN pg_class     rc  ON rc.oid = fk.confrelid
    JOIN pg_namespace rn  ON rn.oid = rc.relnamespace
    JOIN pg_attribute rka ON rka.attrelid = fk.confrelid AND rka.attnum = fk.confkey[1]
    JOIN pg_attribute fka ON fka.attrelid = fk.conrelid  AND fka.attnum = fk.conkey[1]
    JOIN pg_index     idx ON idx.indrelid = fk.conrelid
                         AND idx.indisunique
                         AND idx.indisvalid
                         AND idx.indislive
    WHERE fk.contype = 'f'
      AND rn.nspname = 'public'
      AND rc.relname = 'leads'
      AND rka.attname = 'id'
      AND array_length(fk.conkey, 1) = 1
      AND n.nspname = 'public'
      AND c.relname <> 'leads'
      AND fka.attnum = ANY (string_to_array(idx.indkey::text, ' ')::smallint[])
      AND 0 <> ALL (string_to_array(idx.indkey::text, ' ')::smallint[])
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
      INTO v_other_cols
    FROM unnest(string_to_array(r.indkey_txt, ' ')::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.table_oid AND a.attnum = k.attnum
    WHERE k.attnum <> r.fk_attnum;

    v_pred := CASE WHEN r.is_partial THEN ' AND (' || r.pred_expr || ')' ELSE '' END;

    IF v_other_cols IS NULL THEN
      v_sql := format(
        'DELETE FROM %I.%I t WHERE t.%I = $1%s '
        'AND EXISTS (SELECT 1 FROM %I.%I s WHERE s.%I = $2%s)',
        r.table_schema, r.table_name, r.fk_col, v_pred,
        r.table_schema, r.table_name, r.fk_col, v_pred);
    ELSE
      v_sql := format(
        'DELETE FROM %I.%I t WHERE t.%I = $1%s '
        'AND (%s) IN (SELECT %s FROM %I.%I s WHERE s.%I = $2%s)',
        r.table_schema, r.table_name, r.fk_col, v_pred,
        v_other_cols, v_other_cols,
        r.table_schema, r.table_name, r.fk_col, v_pred);
    END IF;

    EXECUTE v_sql USING p_merge_lead_id, p_keep_lead_id;
  END LOOP;

  FOR r IN
    SELECT DISTINCT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'leads'
      AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
      AND tc.table_name <> 'leads'
  LOOP
    v_sql := format(
      'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
    EXECUTE v_sql USING p_keep_lead_id, p_merge_lead_id;
  END LOOP;

  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY workflow_id, lead_id
        ORDER BY started_at ASC, id ASC
      ) AS rn
    FROM public.workflow_executions
    WHERE status IN ('pending', 'processing', 'waiting')
      AND lead_id = p_keep_lead_id
  )
  UPDATE public.workflow_executions we
     SET status = 'cancelled',
         error = COALESCE(we.error, '') || ' [auto-cancelled: lead merge]',
         completed_at = now()
    FROM ranked rk
   WHERE we.id = rk.id
     AND rk.rn > 1;

  DELETE FROM public.leads WHERE id = p_merge_lead_id;
END;
$_$;

COMMENT ON FUNCTION public.merge_leads(uuid, uuid) IS
  'Mescla dois leads: reaponta FKs, deduplica colisões de UNIQUE e apaga o absorvido. O alias da CTE final é rk de propósito — o nome r colide com a variável do laço plpgsql e a função morre com 42703 (SCRUM-361).';
