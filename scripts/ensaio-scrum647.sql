-- scripts/ensaio-scrum647.sql — metade "ANTES" do ensaio da SCRUM-647.
-- Roda contra PRODUÇÃO dentro de uma transação que TERMINA EM ROLLBACK.
-- Nada é aplicado. Ver scripts/ensaio-scrum647.sh.

BEGIN;

-- ── Controle: a projeção ainda NÃO existe ───────────────────────────────────
DO $ctl$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='negocio_projetado';
  IF v <> 0 THEN
    RAISE EXCEPTION 'CONTROLE FALHOU: negocio_projetado já existe (%). Ensaio inválido.', v;
  END IF;

  -- As 6 views de compat têm que estar de pé e com security_invoker=on: é delas
  -- que os casts da projeção foram copiados.
  SELECT count(*) INTO v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='v'
     AND c.relname IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas',
                       'custom_pipe_entries','custom_pipelines','custom_pipeline_stages')
     AND c.reloptions @> ARRAY['security_invoker=on'];
  IF v <> 6 THEN
    RAISE EXCEPTION 'CONTROLE FALHOU: esperava 6 views de compat com security_invoker=on, achei %', v;
  END IF;
END $ctl$;

-- ── As 3 orgs reais com dado de venda (medidas em prod, 2026-09-03) ─────────
CREATE TEMP TABLE s647_orgs(nome text, org uuid, usuario uuid, lead uuid) ON COMMIT DROP;
INSERT INTO s647_orgs VALUES
  ('Milennials', '6030520a-2ca7-477d-be89-55758e2cd808', '1d7c90bc-896c-4295-be75-79c559b40cab', 'c13be767-3a8e-4f3d-9a82-7b8aed9d04f2'),
  ('Basic4u',    '163874dd-d05c-4ae2-811a-d6772b05dac5', 'fc4bc71c-de3f-4ec3-b563-4b7283409a18', '465bc5a6-88a2-4ffc-af6c-6aa9a20ca4c4'),
  ('Improving',  '5595bbe2-6bd0-4647-9c22-dc86346aab36', 'e25de07f-bef1-4c21-9f89-30b045ad3617', '749a817c-f660-450d-a4e4-5e321c8a8182');

-- ── O medidor. ANTES e DEPOIS chamam ESTE MESMO corpo — se o probe divergir
--    entre as duas metades, a prova não vale nada.
CREATE FUNCTION pg_temp.s647_probe(p_org uuid, p_user uuid, p_lead uuid)
RETURNS TABLE(probe text, digest text, n bigint)
LANGUAGE plpgsql AS $probe$
DECLARE
  v_ini timestamptz := '2020-01-01'::timestamptz;
  v_fim timestamptz := now();
BEGIN
  -- Claims do usuário real da org: sem isso auth.uid() é NULL, assert_org_access
  -- e get_my_organization_ids() devolvem vazio, e VAZIO PARECE RESPOSTA.
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);

  -- P1 — api_get_lead: jsonb inteiro do lead, inclusive o array 'pipes'.
  RETURN QUERY
  SELECT 'P1_api_get_lead',
         md5(public.api_get_lead(p_org, p_lead)::text),
         jsonb_array_length(public.api_get_lead(p_org, p_lead) -> 'pipes')::bigint;

  -- P2 — api_list_leads: 300 leads, com sold/sale_value.
  RETURN QUERY
  WITH r AS (SELECT * FROM public.api_list_leads(p_org => p_org, p_limit => 300))
  SELECT 'P2_api_list_leads',
         md5(coalesce(string_agg(r.*::text, '|' ORDER BY r.created_at DESC, r.id DESC), '')),
         count(*) FILTER (WHERE r.sale_value IS NOT NULL)::bigint
  FROM r;

  -- P3 — get_pipeline_lead_ids: funil 'propostas' inteiro.
  RETURN QUERY
  WITH r AS (SELECT public.get_pipeline_lead_ids(
               p_pipeline_slug => 'propostas', p_organization_id => p_org) AS lead_id)
  SELECT 'P3_pipeline_lead_ids',
         md5(coalesce(string_agg(r.lead_id::text, ',' ORDER BY r.lead_id), '')),
         count(*)::bigint FROM r;

  -- P3b — mesma função pelo ramo de RESPONSÁVEL, que é o que passa pela
  -- projeção (pre_sale_responsible_id / sale_responsible_id da metadata).
  RETURN QUERY
  WITH tm AS (
    SELECT pe.metadata->>'sale_responsible_id' AS id
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org AND pe.metadata ? 'sale_responsible_id'
    UNION
    SELECT pe.metadata->>'pre_sale_responsible_id'
    FROM public.pipeline_entries pe
    WHERE pe.organization_id = p_org AND pe.metadata ? 'pre_sale_responsible_id'
  ), r AS (
    SELECT tm.id AS tm_id,
           public.get_pipeline_lead_ids(p_pipeline_slug => 'propostas',
                                        p_responsible_id => tm.id::uuid,
                                        p_organization_id => p_org) AS lead_id
    FROM tm WHERE tm.id IS NOT NULL
  )
  SELECT 'P3b_lead_ids_por_responsavel',
         md5(coalesce(string_agg(r.tm_id || ':' || r.lead_id::text, ',' ORDER BY r.tm_id, r.lead_id), '')),
         count(*)::bigint FROM r;

  -- P4 — get_meeting_reminder_candidates: lê scheduled_date da projeção.
  RETURN QUERY
  WITH r AS (SELECT * FROM public.get_meeting_reminder_candidates(
               p_org, ARRAY['agendado','apresentacao_marcada','reuniao','ligacao_marcada','diagnostico_agendado']))
  SELECT 'P4_meeting_reminders',
         md5(coalesce(string_agg(r.*::text, '|' ORDER BY r.lead_id, r.meeting_date), '')),
         count(*)::bigint FROM r;

  -- P5 — get_seller_activity_scores: reuniões + propostas + vendas por vendedor.
  RETURN QUERY
  SELECT 'P5_seller_scores',
         md5(public.get_seller_activity_scores(p_org, v_ini, v_fim)::text),
         jsonb_array_length(public.get_seller_activity_scores(p_org, v_ini, v_fim))::bigint;

  -- P6 — o ramo round-robin de get_next_pipe_closer: a CONTAGEM que ele faz.
  -- A função em si devolve NULL cedo nas 3 orgs (closer_mode é NULL), então
  -- chamá-la provaria nada. Mede-se a expressão que a migration troca.
  RETURN QUERY
  SELECT 'P6_round_robin_count',
         'n/a',
         (SELECT count(*)
            FROM public.pipeline_entries pe
            JOIN public.pipelines pip ON pip.id = pe.pipeline_id
             AND pip.slug = 'propostas' AND pip.type = 'system'
           WHERE pe.organization_id = p_org
             AND (pe.metadata->>'closer_id')::uuid IS NOT NULL)::bigint;

  PERFORM set_config('request.jwt.claim.sub', '', true);
END $probe$;

CREATE TEMP TABLE s647_antes(nome text, org uuid, probe text, digest text, n bigint) ON COMMIT DROP;
INSERT INTO s647_antes
SELECT o.nome, o.org, p.probe, p.digest, p.n
FROM s647_orgs o, LATERAL pg_temp.s647_probe(o.org, o.usuario, o.lead) p;

-- ── Guarda anti-falso-verde: nenhuma sonda pode estar vazia nas 3 orgs ──────
DO $vazio$
DECLARE r record; v_vazias int := 0;
BEGIN
  FOR r IN SELECT probe, sum(n) AS total FROM s647_antes GROUP BY probe ORDER BY probe LOOP
    RAISE NOTICE 'ANTES  % -> n=%', rpad(r.probe, 30), r.total;
    -- P4 pode ser legitimamente 0 (reunião futura é raro); as outras, não.
    IF r.total = 0 AND r.probe <> 'P4_meeting_reminders' THEN
      v_vazias := v_vazias + 1;
      RAISE WARNING 'SONDA VAZIA: % — igualdade sobre vazio não é prova', r.probe;
    END IF;
  END LOOP;
  IF v_vazias > 0 THEN
    RAISE EXCEPTION 'ENSAIO ABORTADO: % sonda(s) vazia(s) no ANTES. Vazio parece resposta.', v_vazias;
  END IF;
END $vazio$;

-- ── Retrato dos grants ANTES (CREATE OR REPLACE não pode mexer neles) ───────
CREATE TEMP TABLE s647_grants_antes(fn text, grantee text, tem boolean) ON COMMIT DROP;
INSERT INTO s647_grants_antes
SELECT f.fn, g.grantee, has_function_privilege(g.grantee, f.fn, 'EXECUTE')
FROM (VALUES
  ('public.api_get_lead(uuid,uuid)'),
  ('public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid)'),
  ('public.get_next_pipe_closer(text,uuid)'),
  ('public.get_pipeline_lead_ids(uuid,text,uuid,text,text,uuid,uuid[],text[],text[],text[],uuid)'),
  ('public.get_meeting_reminder_candidates(uuid,text[])'),
  ('public.get_seller_activity_scores(uuid,timestamptz,timestamptz)')
) f(fn), (VALUES ('anon'),('authenticated'),('service_role')) g(grantee);
