-- =====================================================================
-- 20270725000000_duplicate_leads_rpcs.sql
--
-- Página /duplicados (src/modules/leads/pages/Duplicates.tsx) estava
-- QUEBRADA em TODAS as orgs: o hook useDuplicateLeads.ts chamava duas RPCs
-- que NUNCA foram escritas — find_duplicate_leads() e merge_leads() —
-- mascaradas por `as any`. Sem elas o PostgREST devolvia 404 e a UI engolia
-- o erro como "nenhuma duplicata". ~245 leads duplicados ficaram invisíveis.
--
-- SEGURANÇA (área frágil: multi-tenant + PII + merge destrutivo):
--   * find_duplicate_leads(p_organization_id): recebe a org explícita e VALIDA
--     com assert_org_access() (backend/master/membro). NÃO confia no body —
--     valida. Escopa organization_id = p_organization_id (evita firehose de
--     master ver todas as ~30 orgs e mistura em membro multi-org).
--   * merge_leads(p_keep, p_merge): SECURITY DEFINER (deleta + re-aponta FK).
--     Guard p_keep<>p_merge; resolve org dos dois leads; guard same-org;
--     assert_org_access() ANTES de mutar (anti-IDOR cross-tenant). Atômico.
--   * Ambas: search_path pinado (public, extensions); REVOKE ALL FROM PUBLIC
--     (anon herda EXECUTE via GRANT TO PUBLIC) + GRANT EXECUTE só authenticated.
--
-- PERFORMANCE:
--   * find usa o operador `%` (trigram, indexável) com threshold 0.6 fixado no
--     nível da função; a similaridade exata só entra na projeção. Índice GIN
--     idx_leads_name_trgm (parcial deleted_at IS NULL) evita o nested-loop N²
--     que estourava statement_timeout na maior org (3906 leads ativos).
--
-- MERGE — pre-dedupe DATA-DRIVEN:
--   O passo 5 re-aponta TODAS as FKs de leads.id genericamente. Antes, tabelas
--   com índice UNIQUE envolvendo lead_id fariam o UPDATE colidir
--   (unique_violation) e ABORTAR o merge — o caso comum (duplicatas no mesmo
--   pipeline padrão → pipeline_entries UNIQUE(pipeline_id, lead_id)). Em vez de
--   uma lista estática (que defasa quando o schema cresce), o passo 4 descobre
--   dinamicamente via catálogo (pg_constraint/pg_index) os índices UNIQUE que
--   incluem a coluna FK→leads.id e deleta as linhas colidentes do lead
--   absorvido. Trata índices PARCIAIS (indpred): só deduplica linhas dentro do
--   predicado.
--
-- Idempotente: CREATE OR REPLACE FUNCTION / CREATE INDEX IF NOT EXISTS.
--
-- ⚠️ Pós-apply (dev + prod): regenerar src/integrations/supabase/types.ts.
--    Até lá o frontend casta o nome com `as never` (padrão do repo).
-- =====================================================================

-- pg_trgm já habilitada (20260940000000). Defensivo, no-op se existe.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice trigram para o match por nome. Parcial (só leads vivos) para ficar
-- enxuto. Não-concorrente: em prod, se o CTO preferir evitar o lock breve na
-- tabela grande, criar CONCURRENTLY out-of-band ANTES do apply (IF NOT EXISTS
-- torna esta linha no-op).
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm
  ON public.leads USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- find_duplicate_leads(p_organization_id)
-- Pares (a.id < b.id) de leads possivelmente duplicados na org informada.
-- match_type ∈ {'phone','email','name'}; 1 linha por par (mais forte:
-- phone > email > name). similarity ∈ [0,1].
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_duplicate_leads(p_organization_id uuid)
RETURNS TABLE (
  lead_a_id      uuid,
  lead_a_name    text,
  lead_a_phone   text,
  lead_a_email   text,
  lead_a_company text,
  lead_b_id      uuid,
  lead_b_name    text,
  lead_b_phone   text,
  lead_b_email   text,
  lead_b_company text,
  match_type     text,
  similarity     numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET pg_trgm.similarity_threshold = '0.6'
AS $$
BEGIN
  -- Não confia no caller: valida acesso à org (membro/master/service_role).
  PERFORM public.assert_org_access(p_organization_id);

  RETURN QUERY
  WITH pairs AS (
    -- (1) telefone normalizado idêntico → match forte
    SELECT
      a.id AS a_id, a.name AS a_name, a.phone AS a_phone, a.email AS a_email, a.company AS a_company,
      b.id AS b_id, b.name AS b_name, b.phone AS b_phone, b.email AS b_email, b.company AS b_company,
      'phone'::text AS match_type,
      1.0::numeric  AS sim,
      1 AS priority
    FROM public.leads a
    JOIN public.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.normalized_phone IS NOT NULL
     AND a.normalized_phone <> ''
     AND a.normalized_phone = b.normalized_phone
     AND b.deleted_at IS NULL
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL

    UNION ALL

    -- (2) email idêntico (case-insensitive)
    SELECT
      a.id, a.name, a.phone, a.email, a.company,
      b.id, b.name, b.phone, b.email, b.company,
      'email'::text, 1.0::numeric, 2
    FROM public.leads a
    JOIN public.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.email IS NOT NULL
     AND a.email <> ''
     AND lower(a.email) = lower(b.email)
     AND b.deleted_at IS NULL
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL

    UNION ALL

    -- (3) nome similar (trigram, indexável via `%` + threshold 0.6). A
    -- similaridade exata só entra na projeção.
    SELECT
      a.id, a.name, a.phone, a.email, a.company,
      b.id, b.name, b.phone, b.email, b.company,
      'name'::text,
      round(similarity(a.name, b.name)::numeric, 2),
      3
    FROM public.leads a
    JOIN public.leads b
      ON b.organization_id = a.organization_id
     AND a.id < b.id
     AND a.name % b.name
     AND b.deleted_at IS NULL
     AND length(btrim(b.name)) >= 4
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL
      AND a.name IS NOT NULL
      AND length(btrim(a.name)) >= 4
  )
  SELECT DISTINCT ON (p.a_id, p.b_id)
    p.a_id, p.a_name, p.a_phone, p.a_email, p.a_company,
    p.b_id, p.b_name, p.b_phone, p.b_email, p.b_company,
    p.match_type, p.sim
  FROM pairs p
  ORDER BY p.a_id, p.b_id, p.priority ASC;
END;
$$;

-- ---------------------------------------------------------------------
-- merge_leads(p_keep_lead_id, p_merge_lead_id)
-- Absorve p_merge_lead_id em p_keep_lead_id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_leads(
  p_keep_lead_id  uuid,
  p_merge_lead_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_keep_org   uuid;
  v_merge_org  uuid;
  r            RECORD;
  v_other_cols text;
  v_pred       text;
  v_sql        text;
BEGIN
  -- 0. Guards de entrada
  IF p_keep_lead_id IS NULL OR p_merge_lead_id IS NULL THEN
    RAISE EXCEPTION 'merge_leads: ids obrigatórios' USING ERRCODE = 'P0001';
  END IF;

  IF p_keep_lead_id = p_merge_lead_id THEN
    RAISE EXCEPTION 'merge_leads: não é possível mesclar um lead nele mesmo'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. Resolve as orgs dos dois leads
  SELECT organization_id INTO v_keep_org  FROM public.leads WHERE id = p_keep_lead_id;
  SELECT organization_id INTO v_merge_org FROM public.leads WHERE id = p_merge_lead_id;

  IF v_keep_org IS NULL OR v_merge_org IS NULL THEN
    RAISE EXCEPTION 'merge_leads: lead não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Guard cross-tenant: só mescla leads da MESMA org
  IF v_keep_org <> v_merge_org THEN
    RAISE EXCEPTION 'merge_leads: leads de organizações diferentes não podem ser mesclados'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Guard IDOR: caller precisa ter acesso à org. Levanta 'access_denied'.
  PERFORM public.assert_org_access(v_keep_org);

  -- 4. PRE-DEDUPE data-driven. Para cada índice UNIQUE que inclui a coluna
  --    FK→leads.id, deleta as linhas do merge que colidiriam com o keep no
  --    passo 5. Descoberto via catálogo → não defasa quando o schema cresce.
  --    Índices PARCIAIS: o predicado (pg_get_expr) é aplicado aos dois lados;
  --    nomes de coluna vêm sem qualificação e resolvem para a tabela do escopo
  --    (t no externo, s no interno) — sem ambiguidade entre níveis.
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
    -- colunas da chave UNIQUE além da FK, em ordem
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
      INTO v_other_cols
    FROM unnest(string_to_array(r.indkey_txt, ' ')::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.table_oid AND a.attnum = k.attnum
    WHERE k.attnum <> r.fk_attnum;

    v_pred := CASE WHEN r.is_partial THEN ' AND (' || r.pred_expr || ')' ELSE '' END;

    IF v_other_cols IS NULL THEN
      -- UNIQUE só na coluna FK: qualquer linha do keep colide
      v_sql := format(
        'DELETE FROM %I.%I t WHERE t.%I = $1%s '
        'AND EXISTS (SELECT 1 FROM %I.%I s WHERE s.%I = $2%s)',
        r.table_schema, r.table_name, r.fk_col, v_pred,
        r.table_schema, r.table_name, r.fk_col, v_pred);
    ELSE
      -- UNIQUE composta: colide quando as demais colunas batem
      v_sql := format(
        'DELETE FROM %I.%I t WHERE t.%I = $1%s '
        'AND (%s) IN (SELECT %s FROM %I.%I s WHERE s.%I = $2%s)',
        r.table_schema, r.table_name, r.fk_col, v_pred,
        v_other_cols, v_other_cols,
        r.table_schema, r.table_name, r.fk_col, v_pred);
    END IF;

    EXECUTE v_sql USING p_merge_lead_id, p_keep_lead_id;
  END LOOP;

  -- 5. Re-aponta TODAS as FKs que referenciam leads.id. Após o pre-dedupe,
  --    nenhum UPDATE viola unique constraint. %I (quote_ident) + USING ($1/$2).
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

  -- 6. Cancela workflow_executions pendentes duplicadas do keep (evita
  --    disparos WhatsApp dobrados após o re-aponta).
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
    FROM ranked r
   WHERE we.id = r.id
     AND r.rn > 1;

  -- 7. Deleta o lead absorvido
  DELETE FROM public.leads WHERE id = p_merge_lead_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Grants: fecha PUBLIC (anon herda via PUBLIC) e libera só authenticated.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.find_duplicate_leads(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_leads(uuid, uuid)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.find_duplicate_leads(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_leads(uuid, uuid)    TO authenticated;
