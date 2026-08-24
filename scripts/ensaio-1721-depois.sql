-- ============================================================================
-- ensaio-1721-depois.sql — parte 5 de 5. Roda com a migration E o rollback já
-- aplicados dentro da transação. FECHA a transação com ROLLBACK.
--
-- Três asserções (12 a 14) e o relatório. Elas fazem duas coisas que nenhuma
-- das onze anteriores faz:
--
--   a) CONTROLE NEGATIVO. Com o rollback aplicado, o vermelho tem de VOLTAR. Se
--      `delivered` continuasse aceito aqui, a asserção 1 do verde teria sido
--      verde por outro motivo qualquer — e a suíte inteira estaria medindo o
--      ambiente, não a migration. É o equivalente de rodar o ensaio sem a
--      migration, mas sem gastar uma segunda execução contra produção.
--
--   b) PROVA DO ROLLBACK POR EXECUÇÃO. O preflight de aplicar-migration-prod.md
--      exige rollback capturado em arquivo e testado rodando, antes de qualquer
--      escrita. É aqui que ele roda.
-- ============================================================================

CREATE TEMP TABLE e_final_idx AS
SELECT c.relname::text AS nome, pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_final_con AS
SELECT conname::text AS nome, pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_final_col AS
SELECT a.attname::text AS coluna, format_type(a.atttypid, a.atttypmod) AS tipo,
       a.attnotnull AS notnulo, coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS padrao
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.blast_plan_recipients'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped;

CREATE TEMP TABLE e_final_pol AS
SELECT policyname::text AS nome, cmd::text AS cmd,
       coalesce(qual, '')::text AS qual, coalesce(with_check, '')::text AS wcheck,
       roles::text AS papeis
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'blast_plan_recipients';

CREATE TEMP TABLE e_final_acl AS
SELECT r.rolname::text AS papel, pr.priv::text AS priv,
       has_table_privilege(r.rolname, 'public.blast_plan_recipients', pr.priv) AS tem
FROM pg_roles r,
     (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv) pr
WHERE r.rolname IN ('anon','authenticated','service_role','mcp_readonly');

CREATE TEMP TABLE e_final_total AS
SELECT count(*)::bigint AS n FROM public.blast_plan_recipients;

CREATE TEMP TABLE e_final_dist AS
SELECT p.organization_id, r.status, count(*)::bigint AS n
FROM public.blast_plan_recipients r
LEFT JOIN public.blast_plans p ON p.id = r.plan_id
GROUP BY 1, 2;

DO $ensaio$
DECLARE
  v_plan uuid;
  v_r    text;
  v_txt  text;
  v_a    bigint;
  v_f    bigint;
BEGIN
  SELECT plan_id INTO v_plan FROM e_param;

  -- ── 12. CONTROLE NEGATIVO: o vermelho volta ───────────────────────────────
  v_r := pg_temp.e_sonda_status(v_plan, 'delivered');
  IF v_r <> '23514' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CONTROLE NEGATIVO FALHOU: com o rollback aplicado, delivered devolveu %, esperado 23514. O verde da asserção 1 nao veio da migration.', v_r;
  END IF;

  v_r := pg_temp.e_sonda_unico(v_plan, 'ensaio-1721-pmid');
  IF v_r <> '42703' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA: provider_message_id ainda existe depois do rollback (devolveu %).', v_r;
  END IF;

  -- ── 13. O schema volta ao que era, em quatro eixos ────────────────────────
  SELECT string_agg(nome || ': ' || def, ' | ') INTO v_txt FROM (
    (SELECT nome, def FROM e_antes_idx EXCEPT SELECT nome, def FROM e_final_idx)
    UNION ALL
    (SELECT nome, def FROM e_final_idx EXCEPT SELECT nome, def FROM e_antes_idx)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA (indices): %', v_txt;
  END IF;

  SELECT string_agg(nome || ': ' || def, ' | ') INTO v_txt FROM (
    (SELECT nome, def FROM e_antes_con EXCEPT SELECT nome, def FROM e_final_con)
    UNION ALL
    (SELECT nome, def FROM e_final_con EXCEPT SELECT nome, def FROM e_antes_con)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA (constraints): %', v_txt;
  END IF;

  SELECT string_agg(coluna, ', ') INTO v_txt FROM (
    (SELECT coluna, tipo, notnulo, padrao FROM e_antes_col
     EXCEPT SELECT coluna, tipo, notnulo, padrao FROM e_final_col)
    UNION ALL
    (SELECT coluna, tipo, notnulo, padrao FROM e_final_col
     EXCEPT SELECT coluna, tipo, notnulo, padrao FROM e_antes_col)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA (colunas): %', v_txt;
  END IF;

  SELECT string_agg(nome, ', ') INTO v_txt FROM (
    (SELECT nome, cmd, qual, wcheck, papeis FROM e_antes_pol
     EXCEPT SELECT nome, cmd, qual, wcheck, papeis FROM e_final_pol)
    UNION ALL
    (SELECT nome, cmd, qual, wcheck, papeis FROM e_final_pol
     EXCEPT SELECT nome, cmd, qual, wcheck, papeis FROM e_antes_pol)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA (policies): %', v_txt;
  END IF;

  SELECT string_agg(papel || '.' || priv, ', ') INTO v_txt FROM (
    (SELECT papel, priv, tem FROM e_antes_acl EXCEPT SELECT papel, priv, tem FROM e_final_acl)
    UNION ALL
    (SELECT papel, priv, tem FROM e_final_acl EXCEPT SELECT papel, priv, tem FROM e_antes_acl)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / ROLLBACK NAO FECHA (grants): %', v_txt;
  END IF;

  -- ── 14. E o dado nunca se moveu, do começo ao fim ─────────────────────────
  SELECT n INTO v_a FROM e_antes_total;
  SELECT n INTO v_f FROM e_final_total;
  IF v_a <> v_f THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CONTAGEM MUDOU NO FIM: antes=% final=%', v_a, v_f;
  END IF;

  SELECT string_agg(t, '; ') INTO v_txt FROM (
    SELECT coalesce(organization_id::text,'SEM_ORG') || '/' || coalesce(status,'SEM_STATUS') || '=' || n AS t
    FROM ((SELECT * FROM e_antes_dist EXCEPT SELECT * FROM e_final_dist)
          UNION ALL
          (SELECT * FROM e_final_dist EXCEPT SELECT * FROM e_antes_dist)) x
  ) z;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / DISTRIBUICAO MUDOU NO FIM: %', v_txt;
  END IF;

  RAISE NOTICE 'ENSAIO 1721 / TODAS AS 14 ASSERCOES PASSARAM.';
END
$ensaio$;

-- ─── RELATÓRIO ──────────────────────────────────────────────────────────────
SELECT jsonb_pretty(jsonb_build_object(
  'ticket', 1721,
  'tabela', 'public.blast_plan_recipients',
  'check_vivo_medido_em_producao',
    (SELECT def FROM e_antes_con WHERE nome = 'blast_plan_recipients_status_check'),
  'check_depois_da_migration',
    (SELECT def FROM e_depois_con WHERE nome = 'blast_plan_recipients_status_check'),
  'check_depois_do_rollback',
    (SELECT def FROM e_final_con WHERE nome = 'blast_plan_recipients_status_check'),
  'destinatarios_total', jsonb_build_object(
     'antes',  (SELECT n FROM e_antes_total),
     'depois', (SELECT n FROM e_depois_total),
     'final',  (SELECT n FROM e_final_total)),
  'distribuicao_por_org_e_status',
    (SELECT jsonb_agg(jsonb_build_object('org', organization_id, 'status', status, 'n', n)
            ORDER BY organization_id, status) FROM e_antes_dist),
  'indices_antes',
    (SELECT jsonb_agg(jsonb_build_object('nome', nome, 'def', def) ORDER BY nome) FROM e_antes_idx),
  'indices_depois_da_migration',
    (SELECT jsonb_agg(jsonb_build_object('nome', nome, 'def', def) ORDER BY nome) FROM e_depois_idx),
  'colunas_novas',
    (SELECT jsonb_agg(coluna ORDER BY coluna)
     FROM (SELECT coluna FROM e_depois_col EXCEPT SELECT coluna FROM e_antes_col) q),
  'policies', (SELECT jsonb_agg(jsonb_build_object('nome', nome, 'cmd', cmd) ORDER BY nome) FROM e_antes_pol),
  'grants_antes',
    (SELECT jsonb_agg(papel || '.' || priv || '=' || tem ORDER BY papel, priv) FROM e_antes_acl WHERE tem),
  'nada_foi_aplicado', 'a proxima instrucao e ROLLBACK'
)) AS relatorio_ensaio_1721;

ROLLBACK;
