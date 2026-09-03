
-- scripts/ensaio-scrum647-depois.sql — metade "DEPOIS" do ensaio da SCRUM-647.
-- Roda DEPOIS da migration, dentro da MESMA transação, e termina em ROLLBACK.

-- ═══════════════════════════════════════════════════════════════════════════
-- A. A projeção nasceu com a forma certa
-- ═══════════════════════════════════════════════════════════════════════════
DO $forma$
DECLARE v_opts text[]; v_anon boolean; v_auth boolean; v_svc boolean; v_mcp boolean;
BEGIN
  SELECT c.reloptions INTO v_opts FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='negocio_projetado';
  IF v_opts IS NULL OR NOT (v_opts @> ARRAY['security_invoker=on']) THEN
    RAISE EXCEPTION 'FALHOU: negocio_projetado sem security_invoker=on (opts=%). A RLS de pipeline_entries deixaria de valer.', v_opts;
  END IF;

  v_anon := has_table_privilege('anon',          'public.negocio_projetado', 'SELECT');
  v_auth := has_table_privilege('authenticated', 'public.negocio_projetado', 'SELECT');
  v_svc  := has_table_privilege('service_role',  'public.negocio_projetado', 'SELECT');
  v_mcp  := has_table_privilege('mcp_readonly',  'public.negocio_projetado', 'SELECT');

  -- Espelha as 3 views de compat de DINHEIRO (pipe_*), que não dão nada a anon.
  IF v_anon THEN RAISE EXCEPTION 'FALHOU: anon enxerga negocio_projetado. As pipe_* não dão nada a anon.'; END IF;
  IF NOT (v_auth AND v_svc AND v_mcp) THEN
    RAISE EXCEPTION 'FALHOU: grants de leitura incompletos (auth=%, svc=%, mcp=%)', v_auth, v_svc, v_mcp;
  END IF;

  -- Escrita não existe nesta view: ela é projeção, não porta de escrita.
  IF has_table_privilege('authenticated','public.negocio_projetado','INSERT')
  OR has_table_privilege('authenticated','public.negocio_projetado','UPDATE')
  OR has_table_privilege('authenticated','public.negocio_projetado','DELETE') THEN
    RAISE EXCEPTION 'FALHOU: negocio_projetado aceita escrita. Ela é somente leitura.';
  END IF;
END $forma$;

-- ═══════════════════════════════════════════════════════════════════════════
-- B. PROVA DA PROJEÇÃO: coluna a coluna, linha a linha, contra as 6 views
--    de compat. É daqui que sai o "nenhum número mudou" — a projeção só vale
--    se ela devolve EXATAMENTE o que as views de compat devolvem hoje.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE s647_proj(view_compat text, linhas bigint, divergentes bigint) ON COMMIT DROP;

INSERT INTO s647_proj
-- pipe_propostas: 13 colunas projetadas de metadata
SELECT 'pipe_propostas', count(*), count(*) FILTER (WHERE NOT ok) FROM (
  SELECT (v.id, v.lead_id, v.organization_id, v.status, v.sale_value, v.closer_id,
          v.responsible_id, v.pre_sale_responsible_id, v.sale_responsible_id,
          v.product_id, v.product_type, v.calor, v.loss_reason, v.loss_reason_id,
          v.commitment_date, v.contract_duration, v.notes, v.metrics_period_at,
          v.closed_at, v.created_at, v.updated_at)
      IS NOT DISTINCT FROM
         (np.id, np.lead_id, np.organization_id, np.stage_key, np.sale_value, np.closer_id,
          np.responsible_id, np.pre_sale_responsible_id, np.sale_responsible_id,
          np.product_id, np.product_type, np.calor, np.loss_reason, np.loss_reason_id,
          np.commitment_date, np.contract_duration, np.notes, np.metrics_period_at,
          np.closed_at, np.created_at, np.updated_at) AS ok
  FROM public.pipe_propostas v
  FULL OUTER JOIN (SELECT * FROM public.negocio_projetado WHERE funil_sistema = 'propostas') np
    ON np.id = v.id
) t
UNION ALL
-- pipe_confirmacao: inclusive o COALESCE(is_confirmed, false)
SELECT 'pipe_confirmacao', count(*), count(*) FILTER (WHERE NOT ok) FROM (
  SELECT (v.id, v.lead_id, v.organization_id, v.status, v.meeting_date, v.is_confirmed,
          v.closer_id, v.responsible_id, v.sdr_id, v.pre_sale_responsible_id,
          v.sale_responsible_id, v.meet_link, v.notes, v.metrics_period_at,
          v.created_at, v.updated_at)
      IS NOT DISTINCT FROM
         (np.id, np.lead_id, np.organization_id, np.stage_key, np.meeting_date, np.is_confirmed,
          np.closer_id, np.responsible_id, np.sdr_id, np.pre_sale_responsible_id,
          np.sale_responsible_id, np.meet_link, np.notes, np.metrics_period_at,
          np.created_at, np.updated_at) AS ok
  FROM public.pipe_confirmacao v
  FULL OUTER JOIN (SELECT * FROM public.negocio_projetado WHERE funil_sistema = 'confirmacao') np
    ON np.id = v.id
) t
UNION ALL
-- pipe_whatsapp
SELECT 'pipe_whatsapp', count(*), count(*) FILTER (WHERE NOT ok) FROM (
  SELECT (v.id, v.lead_id, v.organization_id, v.status, v.responsible_id, v.sdr_id,
          v.pre_sale_responsible_id, v.sale_responsible_id, v.scheduled_date,
          v.notes, v.created_at, v.updated_at)
      IS NOT DISTINCT FROM
         (np.id, np.lead_id, np.organization_id, np.stage_key, np.responsible_id, np.sdr_id,
          np.pre_sale_responsible_id, np.sale_responsible_id, np.scheduled_date,
          np.notes, np.created_at, np.updated_at) AS ok
  FROM public.pipe_whatsapp v
  FULL OUTER JOIN (SELECT * FROM public.negocio_projetado WHERE funil_sistema = 'whatsapp') np
    ON np.id = v.id
) t
UNION ALL
-- custom_pipe_entries: o par de responsáveis + as colunas próprias
SELECT 'custom_pipe_entries', count(*), count(*) FILTER (WHERE NOT ok) FROM (
  SELECT (v.id, v.organization_id, v.pipeline_id, v.lead_id, v.stage_id, v.assigned_to,
          v.notes, v.entered_at, v.stage_changed_at, v.created_at, v.updated_at,
          v.pre_sale_responsible_id, v.sale_responsible_id, v.deal_id)
      IS NOT DISTINCT FROM
         (np.id, np.organization_id, np.pipeline_id, np.lead_id, np.stage_id, np.assigned_to,
          np.notes, np.entered_at, np.stage_changed_at, np.created_at, np.updated_at,
          np.pre_sale_responsible_id, np.sale_responsible_id, np.deal_id) AS ok
  FROM public.custom_pipe_entries v
  FULL OUTER JOIN (SELECT * FROM public.negocio_projetado WHERE pipeline_type = 'custom') np
    ON np.id = v.id
) t;

DO $proj$
DECLARE r record; v_bad bigint := 0; v_tot bigint := 0;
BEGIN
  FOR r IN SELECT * FROM s647_proj ORDER BY view_compat LOOP
    RAISE NOTICE 'PROJEÇÃO vs %  linhas=%  divergentes=%', rpad(r.view_compat,22), r.linhas, r.divergentes;
    v_bad := v_bad + r.divergentes; v_tot := v_tot + r.linhas;
  END LOOP;
  IF v_tot = 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: comparação da projeção varreu 0 linhas. Vazio não é prova.';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: % linha(s) divergem entre a projeção e as views de compat.', v_bad;
  END IF;
END $proj$;

-- ═══════════════════════════════════════════════════════════════════════════
-- C. As 40 entradas sem stage_id continuam na projeção (LEFT JOIN, não INNER)
-- ═══════════════════════════════════════════════════════════════════════════
DO $orfas$
DECLARE v_base bigint; v_proj bigint; v_sem_stage bigint;
BEGIN
  SELECT count(*) INTO v_base FROM public.pipeline_entries;
  SELECT count(*) INTO v_proj FROM public.negocio_projetado;
  SELECT count(*) INTO v_sem_stage FROM public.negocio_projetado WHERE stage_id IS NULL;
  RAISE NOTICE 'ENTRADAS  base=%  projeção=%  sem stage_id=%', v_base, v_proj, v_sem_stage;
  IF v_proj <> v_base THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: projeção tem % linhas e a tabela tem % — o join está comendo dinheiro.', v_proj, v_base;
  END IF;
END $orfas$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D. IGUALDADE POR ORG das 6 funções migradas: mesmo probe, antes e depois
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE s647_depois(nome text, org uuid, probe text, digest text, n bigint) ON COMMIT DROP;
INSERT INTO s647_depois
SELECT o.nome, o.org, p.probe, p.digest, p.n
FROM s647_orgs o, LATERAL pg_temp.s647_probe(o.org, o.usuario, o.lead) p;

-- P6 pela via algébrica: a contagem nova (projeção) contra a velha (inline),
-- calculadas lado a lado agora. Prova a troca de get_next_pipe_closer, cuja
-- função devolve NULL cedo nas 3 orgs (closer_mode é NULL) e não provaria nada.
CREATE TEMP TABLE s647_p6(nome text, velho bigint, novo bigint) ON COMMIT DROP;
INSERT INTO s647_p6
SELECT o.nome,
  (SELECT count(*) FROM public.pipeline_entries pe
     JOIN public.pipelines pip ON pip.id = pe.pipeline_id
      AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = o.org
      AND (pe.metadata->>'closer_id')::uuid IS NOT NULL),
  (SELECT count(*) FROM public.negocio_projetado np
    WHERE np.funil_sistema = 'propostas'
      AND np.organization_id = o.org
      AND np.closer_id IS NOT NULL)
FROM s647_orgs o;

-- P4b — a troca dentro de get_meeting_reminder_candidates, pela via algébrica.
-- P4 sai 0 nas 3 orgs porque HOJE não existe nenhuma entrada com
-- scheduled_date no futuro em prod inteiro (medido: 0). Igualdade sobre vazio
-- não prova nada, então compara-se a CTE velha contra a nova SEM o filtro de
-- futuro, que é o que dá conjunto não-vazio.
CREATE TEMP TABLE s647_p4b(lado text, n bigint, digest text) ON COMMIT DROP;
INSERT INTO s647_p4b
SELECT 'velho', count(*), md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (
  SELECT pe.lead_id::text || ':' || pe.stage_key || ':' ||
         coalesce(((pe.metadata->>'scheduled_date')::timestamptz)::text, 'NULL') AS x
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
  WHERE pe.metadata->>'scheduled_date' IS NOT NULL
) t
UNION ALL
SELECT 'novo', count(*), md5(coalesce(string_agg(x, '|' ORDER BY x), '')) FROM (
  SELECT np.lead_id::text || ':' || np.stage_key || ':' ||
         coalesce(np.scheduled_date::text, 'NULL') AS x
  FROM public.negocio_projetado np
  WHERE np.funil_sistema = 'whatsapp'
    AND np.scheduled_date IS NOT NULL
) t;

DO $p4b$
DECLARE v_nv bigint; v_nn bigint; v_dv text; v_dn text;
BEGIN
  SELECT n, digest INTO v_nv, v_dv FROM s647_p4b WHERE lado='velho';
  SELECT n, digest INTO v_nn, v_dn FROM s647_p4b WHERE lado='novo';
  RAISE NOTICE 'P4b_scheduled_date  velho=% novo=%', v_nv, v_nn;
  IF v_nv = 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: P4b varreu 0 linhas. Vazio não é prova.';
  END IF;
  IF v_nv IS DISTINCT FROM v_nn OR v_dv IS DISTINCT FROM v_dn THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: P4b divergiu — velho(n=%,md5=%) novo(n=%,md5=%)',
      v_nv, left(v_dv,12), v_nn, left(v_dn,12);
  END IF;
END $p4b$;

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Os grants não se mexeram (CREATE OR REPLACE preserva; DROP+CREATE não)
-- ═══════════════════════════════════════════════════════════════════════════
DO $grants$
DECLARE r record; v_dif int := 0;
BEGIN
  FOR r IN
    SELECT a.fn, a.grantee, a.tem AS antes,
           has_function_privilege(a.grantee, a.fn, 'EXECUTE') AS depois
    FROM s647_grants_antes a
    WHERE a.tem IS DISTINCT FROM has_function_privilege(a.grantee, a.fn, 'EXECUTE')
  LOOP
    v_dif := v_dif + 1;
    RAISE WARNING 'GRANT MUDOU: % / % : % -> %', r.fn, r.grantee, r.antes, r.depois;
  END LOOP;
  IF v_dif > 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: % grant(s) de EXECUTE mudaram.', v_dif;
  END IF;
END $grants$;

-- ═══════════════════════════════════════════════════════════════════════════
-- F. VEREDITO
-- ═══════════════════════════════════════════════════════════════════════════
DO $veredito$
DECLARE
  r record;
  v_div int := 0;
  v_provas int := 0;
  v_linhas_proj bigint;
  v_por_view text;
  v_por_probe text;
  v_resumo text := '';
BEGIN
  -- Igualdade sonda a sonda, org a org.
  FOR r IN
    SELECT a.nome, a.probe, a.digest AS d_antes, b.digest AS d_depois, a.n AS n_antes, b.n AS n_depois
    FROM s647_antes a
    JOIN s647_depois b ON b.org = a.org AND b.probe = a.probe
    ORDER BY a.probe, a.nome
  LOOP
    v_provas := v_provas + 1;
    IF r.d_antes IS DISTINCT FROM r.d_depois OR r.n_antes IS DISTINCT FROM r.n_depois THEN
      v_div := v_div + 1;
      RAISE WARNING 'DIVERGIU  %/%  antes(md5=%, n=%)  depois(md5=%, n=%)',
        r.nome, r.probe, left(r.d_antes,12), r.n_antes, left(r.d_depois,12), r.n_depois;
    ELSE
      RAISE NOTICE 'IGUAL  %  %  n=%  md5=%', rpad(r.nome,12), rpad(r.probe,30), r.n_antes, left(r.d_antes,12);
    END IF;
  END LOOP;

  -- Nenhuma sonda pode ter sumido entre as metades.
  IF (SELECT count(*) FROM s647_antes) <> (SELECT count(*) FROM s647_depois) THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: ANTES tem % sondas e DEPOIS tem %.',
      (SELECT count(*) FROM s647_antes), (SELECT count(*) FROM s647_depois);
  END IF;

  -- P4b algébrico (uma prova global, não por org).
  v_provas := v_provas + 1;

  -- P6 algébrico.
  FOR r IN SELECT * FROM s647_p6 ORDER BY nome LOOP
    v_provas := v_provas + 1;
    IF r.velho IS DISTINCT FROM r.novo THEN
      v_div := v_div + 1;
      RAISE WARNING 'DIVERGIU  %/P6_round_robin  velho=% novo=%', r.nome, r.velho, r.novo;
    ELSE
      RAISE NOTICE 'IGUAL  %  %  velho=novo=%', rpad(r.nome,12), rpad('P6_round_robin_count',30), r.velho;
    END IF;
  END LOOP;

  IF v_div > 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: % prova(s) de igualdade divergiram. NÃO arredondar — reportar.', v_div;
  END IF;

  SELECT count(*) INTO v_linhas_proj FROM public.negocio_projetado;

  SELECT string_agg(nome || '=' || total, ' ')
    INTO v_resumo
  FROM (SELECT nome, sum(n) AS total FROM s647_antes GROUP BY nome ORDER BY nome) t;

  SELECT string_agg(view_compat || ':' || linhas || 'l/' || divergentes || 'div', ' ')
    INTO v_por_view
  FROM (SELECT * FROM s647_proj ORDER BY view_compat) t;

  SELECT string_agg(probe || '[' || det || ']', ' ')
    INTO v_por_probe
  FROM (
    SELECT a.probe, string_agg(a.nome || '=' || a.n, ',' ORDER BY a.nome) AS det
    FROM s647_antes a GROUP BY a.probe ORDER BY a.probe
  ) t;

  RAISE EXCEPTION
    'ENSAIO_OK SCRUM-647 | projecao=negocio_projetado linhas=% security_invoker=on anon_sem_select=sim escrita=negada | projecao_vs_compat: % (total % linhas, 0 divergentes) | funcoes_migradas=6: api_get_lead api_list_leads get_next_pipe_closer get_pipeline_lead_ids get_meeting_reminder_candidates get_seller_activity_scores | provas_de_igualdade=% divergentes=0 | p4b_scheduled_date_linhas=% | por_sonda: % | por_org: % | grants_EXECUTE_inalterados=18/18 | ROLLBACK a seguir.',
    v_linhas_proj,
    v_por_view,
    (SELECT sum(linhas) FROM s647_proj),
    v_provas, (SELECT n FROM s647_p4b WHERE lado='novo'), v_por_probe, v_resumo;
END $veredito$;

ROLLBACK;
