-- ============================================================================
-- ensaio-1721-verde.sql — parte 3 de 5. Roda com a migration JÁ aplicada dentro
-- da transação. NÃO abre nem fecha transação. Ver o cabeçalho do -antes.sql.
--
-- Onze asserções. Cada uma existe porque alguma coisa específica podia ter dado
-- errado; nenhuma está aqui para engrossar a lista.
-- ============================================================================

CREATE TEMP TABLE e_depois_idx AS
SELECT c.relname::text AS nome, pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_depois_con AS
SELECT conname::text AS nome, pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conrelid = 'public.blast_plan_recipients'::regclass;

CREATE TEMP TABLE e_depois_pol AS
SELECT policyname::text AS nome, cmd::text AS cmd,
       coalesce(qual, '')::text AS qual, coalesce(with_check, '')::text AS wcheck,
       roles::text AS papeis
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'blast_plan_recipients';

CREATE TEMP TABLE e_depois_acl AS
SELECT r.rolname::text AS papel, pr.priv::text AS priv,
       has_table_privilege(r.rolname, 'public.blast_plan_recipients', pr.priv) AS tem
FROM pg_roles r,
     (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS priv) pr
WHERE r.rolname IN ('anon','authenticated','service_role','mcp_readonly');

CREATE TEMP TABLE e_depois_col AS
SELECT a.attname::text AS coluna, format_type(a.atttypid, a.atttypmod) AS tipo,
       a.attnotnull AS notnulo, coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS padrao
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.blast_plan_recipients'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped;

CREATE TEMP TABLE e_depois_total AS
SELECT count(*)::bigint AS n FROM public.blast_plan_recipients;

CREATE TEMP TABLE e_depois_dist AS
SELECT p.organization_id, r.status, count(*)::bigint AS n
FROM public.blast_plan_recipients r
LEFT JOIN public.blast_plans p ON p.id = r.plan_id
GROUP BY 1, 2;

CREATE TEMP TABLE e_depois_trg AS
SELECT tgname::text AS nome FROM pg_trigger
WHERE tgrelid = 'public.blast_plan_recipients'::regclass AND NOT tgisinternal;

DO $ensaio$
DECLARE
  v_plan     uuid;
  v_r        text;
  v_s        text;
  v_a        bigint;
  v_d        bigint;
  v_txt      text;
  v_n        int;
  v_check    text;
BEGIN
  SELECT plan_id INTO v_plan FROM e_param;

  -- ── 1. O verde: os dois estados novos passam a ser aceitos ────────────────
  v_r := pg_temp.e_sonda_status(v_plan, 'delivered');
  IF v_r <> 'ACEITO' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / VERDE FALHOU: delivered devolveu %, esperado ACEITO', v_r;
  END IF;

  v_r := pg_temp.e_sonda_status(v_plan, 'unconfirmed');
  IF v_r <> 'ACEITO' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / VERDE FALHOU: unconfirmed devolveu %, esperado ACEITO', v_r;
  END IF;

  -- ── 2. Nenhum estado vivo foi perdido no caminho ──────────────────────────
  FOREACH v_s IN ARRAY ARRAY['pending','sent','skipped','failed'] LOOP
    v_r := pg_temp.e_sonda_status(v_plan, v_s);
    IF v_r <> 'ACEITO' THEN
      RAISE EXCEPTION 'ENSAIO 1721 / ESTADO PERDIDO: % devolveu % depois da migration, esperado ACEITO. O CHECK novo tinha de ser superconjunto.', v_s, v_r;
    END IF;
  END LOOP;

  -- ── 3. MUTAÇÃO: ampliei o CHECK, não o derrubei ───────────────────────────
  -- Sem esta, um `DROP CONSTRAINT` sem o `ADD` passaria por todas as anteriores.
  v_r := pg_temp.e_sonda_status(v_plan, 'bogus_nao_existe');
  IF v_r <> '23514' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CHECK FROUXO: status invalido devolveu %, esperado 23514. A constraint sumiu em vez de crescer.', v_r;
  END IF;

  SELECT def INTO v_check FROM e_depois_con WHERE nome = 'blast_plan_recipients_status_check';
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CHECK FROUXO: a constraint nao existe depois da migration.';
  END IF;
  FOREACH v_s IN ARRAY ARRAY['pending','sent','skipped','failed','delivered','unconfirmed'] LOOP
    IF v_check NOT LIKE '%' || v_s || '%' THEN
      RAISE EXCEPTION 'ENSAIO 1721 / CHECK INCOMPLETO: % ausente de %', v_s, v_check;
    END IF;
  END LOOP;

  -- ── 4. Contagem total idêntica ────────────────────────────────────────────
  SELECT n INTO v_a FROM e_antes_total;
  SELECT n INTO v_d FROM e_depois_total;
  IF v_a <> v_d THEN
    RAISE EXCEPTION 'ENSAIO 1721 / CONTAGEM MUDOU: antes=% depois=%', v_a, v_d;
  END IF;

  -- ── 5. Distribuição por (org, status): igualdade de CONJUNTO ──────────────
  -- Contagem parecida não é prova. Os dois EXCEPT pegam tanto o que sumiu
  -- quanto o que apareceu.
  SELECT string_agg(t, '; ') INTO v_txt FROM (
    SELECT coalesce(organization_id::text,'SEM_ORG') || '/' || coalesce(status,'SEM_STATUS') || '=' || n || ' (sumiu)' AS t
    FROM (SELECT * FROM e_antes_dist EXCEPT SELECT * FROM e_depois_dist) x
    UNION ALL
    SELECT coalesce(organization_id::text,'SEM_ORG') || '/' || coalesce(status,'SEM_STATUS') || '=' || n || ' (apareceu)' AS t
    FROM (SELECT * FROM e_depois_dist EXCEPT SELECT * FROM e_antes_dist) y
  ) z;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / DISTRIBUICAO MUDOU: %', v_txt;
  END IF;

  -- ── 6. Toda linha pré-existente com as seis colunas novas em NULL ─────────
  SELECT count(*) INTO v_a FROM public.blast_plan_recipients
  WHERE sent_at IS NOT NULL OR delivered_at IS NOT NULL OR claimed_at IS NOT NULL
     OR provider_message_id IS NOT NULL OR estimated_cost IS NOT NULL OR actual_cost IS NOT NULL;
  IF v_a <> 0 THEN
    RAISE EXCEPTION 'ENSAIO 1721 / COLUNA NASCEU SUJA: % linhas com valor nas colunas novas. A migration tinha de ser inerte para o passado.', v_a;
  END IF;

  -- ── 7. Os índices antigos, literalmente idênticos ─────────────────────────
  SELECT string_agg(nome || ': ' || def, ' | ') INTO v_txt FROM (
    SELECT nome, def FROM e_antes_idx EXCEPT SELECT nome, def FROM e_depois_idx
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / INDICE MUDOU: sumiu ou foi reescrito -> %', v_txt;
  END IF;

  -- ...e exatamente UM índice novo, o do ticket.
  SELECT count(*), string_agg(nome, ', ') INTO v_n, v_txt FROM (
    SELECT nome FROM e_depois_idx EXCEPT SELECT nome FROM e_antes_idx
  ) q;
  IF v_n <> 1 OR v_txt IS DISTINCT FROM 'idx_blast_plan_recipients_provider_message_id' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / INDICE INESPERADO: % indice(s) novo(s): %', v_n, coalesce(v_txt,'nenhum');
  END IF;

  -- O índice novo tem de ser ÚNICO e PARCIAL. Um índice comum não daria
  -- idempotência nenhuma, e um único total quebraria toda linha sem callback.
  SELECT def INTO v_txt FROM e_depois_idx WHERE nome = 'idx_blast_plan_recipients_provider_message_id';
  IF v_txt NOT LIKE 'CREATE UNIQUE INDEX%' OR v_txt NOT LIKE '%WHERE (provider_message_id IS NOT NULL)%' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / INDICE ERRADO: %', v_txt;
  END IF;

  -- ── 8. E ele de fato pega ─────────────────────────────────────────────────
  v_r := pg_temp.e_sonda_unico(v_plan, 'ensaio-1721-pmid');
  IF v_r <> '23505' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / UNICIDADE NAO PEGA: id repetido devolveu %, esperado 23505. Sem isso a garantia de envio unico e decorativa.', v_r;
  END IF;

  -- ...sem estrangular quem ainda não tem id.
  v_r := pg_temp.e_sonda_nulos(v_plan);
  IF v_r <> 'ACEITO' THEN
    RAISE EXCEPTION 'ENSAIO 1721 / NULOS COLIDEM: tres linhas sem provider_message_id devolveram %, esperado ACEITO.', v_r;
  END IF;

  -- ── 9. Policies intactas ──────────────────────────────────────────────────
  SELECT string_agg(nome || '/' || cmd, ', ') INTO v_txt FROM (
    (SELECT nome, cmd, qual, wcheck, papeis FROM e_antes_pol
     EXCEPT SELECT nome, cmd, qual, wcheck, papeis FROM e_depois_pol)
    UNION ALL
    (SELECT nome, cmd, qual, wcheck, papeis FROM e_depois_pol
     EXCEPT SELECT nome, cmd, qual, wcheck, papeis FROM e_antes_pol)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / POLICY MUDOU: %', v_txt;
  END IF;

  -- ── 10. Grants intactos ───────────────────────────────────────────────────
  SELECT string_agg(papel || '.' || priv, ', ') INTO v_txt FROM (
    (SELECT papel, priv, tem FROM e_antes_acl EXCEPT SELECT papel, priv, tem FROM e_depois_acl)
    UNION ALL
    (SELECT papel, priv, tem FROM e_depois_acl EXCEPT SELECT papel, priv, tem FROM e_antes_acl)
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / GRANT ERRADO: %', v_txt;
  END IF;

  -- ── 11. As colunas antigas, e nenhum trigger novo ─────────────────────────
  SELECT string_agg(coluna || ' ' || tipo || ' notnull=' || notnulo || ' default=' || padrao, ' | ')
    INTO v_txt FROM (
    SELECT coluna, tipo, notnulo, padrao FROM e_antes_col
    EXCEPT SELECT coluna, tipo, notnulo, padrao FROM e_depois_col
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / COLUNA ANTIGA MUDOU: %', v_txt;
  END IF;

  SELECT count(*), string_agg(nome, ', ') INTO v_n, v_txt FROM (
    SELECT coluna AS nome FROM e_depois_col EXCEPT SELECT coluna FROM e_antes_col
  ) q;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'ENSAIO 1721 / COLUNAS NOVAS ERRADAS: % coluna(s) -> %', v_n, coalesce(v_txt,'nenhuma');
  END IF;

  SELECT string_agg(nome, ', ') INTO v_txt FROM (
    SELECT nome FROM e_depois_trg EXCEPT SELECT nome FROM e_antes_trg
  ) q;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'ENSAIO 1721 / TRIGGER NOVO: %. Trigger altera dado em silencio.', v_txt;
  END IF;

  RAISE NOTICE 'ENSAIO 1721 / VERDE: 11 assercoes passaram.';
END
$ensaio$;
