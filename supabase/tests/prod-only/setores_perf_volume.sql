-- supabase/tests/prod-only/setores_perf_volume.sql
--
-- Custo das policies de Setores com volume (uma org grande, ~13 mil leads).
-- Compara: modo 0 / 1 / 2 e um BASELINE (policies de setor removidas),
-- para admin, membro e supervisor, nos perfis P1 (permissões padrão) e P2
-- (membro restrito: leads.view_all/unassigned/subordinates = false).
-- Q1 = count dos leads da org, Q2 = lista de 50 recentes, Q3 = count dos cards.
--
-- Como rodar (prelúdio de prod + migration de setores sem BEGIN/COMMIT):
--   node ~/.claude/tools/pgtap-preview/runner.mjs pgtap <este-arquivo> \
--        --migration <prod_prelude.sql> --migration <migration-de-setores>
-- A saída vem na mensagem de erro (RESULTADO_PERF); o arquivo termina em ROLLBACK.
--
-- 🔴 NÃO repita em série: cada rodada insere ~20 mil linhas e deixa páginas
-- mortas até um VACUUM. Rodadas de 93 mil linhas encheram o disco da preview
-- (o Postgres caiu ~2 min). Aqui o ruído é de 6 mil leads, só para as
-- estatísticas do planejador.
-- 🔴 O harness roda numa transação que JÁ ESCREVEU (as fixtures): o braço de
-- contingência de INSERT...RETURNING (private.xact_has_writes) fica ativo e
-- infla o modo 2. Em requisição de leitura pura o custo é o da subconsulta
-- escalar (~5 µs/linha), sem esse braço.BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE perf_out (ord serial, phase text, prof text, actor text, q text, ms numeric, cnt bigint);

-- ---------------------------------------------------------------- fixtures
INSERT INTO public.organizations (id, name, slug, timezone)
SELECT ('9e7f0000-0000-0000-0000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, 'Perf org ' || i, 'perf-org-' || i, 'America/Sao_Paulo'
  FROM generate_series(10, 30) i;   -- 10 = org A; 11..30 = ruído

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  reauthentication_token, phone_change_token, email_change, phone_change)
SELECT ('9e7f0001-0000-0000-0000-00000000000' || i)::uuid, 'perf' || i || '@setores.test', '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''
  FROM generate_series(1, 8) i;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
SELECT ('9e7f0002-0000-0000-0000-00000000000' || i)::uuid, '9e7f0000-0000-0000-0000-00000000000a'::uuid,
       ('9e7f0001-0000-0000-0000-00000000000' || i)::uuid, 'Perf tm ' || i,
       CASE WHEN i <= 4 THEN 'admin'::public.app_role ELSE 'member'::public.app_role END, true
  FROM generate_series(1, 8) i;

-- org A: 13.195 leads; 70% com dono entre os 4 membros (tm5..tm8)
INSERT INTO public.leads (id, organization_id, name, sdr_id, created_at)
SELECT ('9e7f0003-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
       '9e7f0000-0000-0000-0000-00000000000a'::uuid, 'lead ' || i,
       CASE WHEN i % 10 < 7 THEN ('9e7f0002-0000-0000-0000-00000000000' || (5 + (i % 4)))::uuid END,
       now() - (i || ' minutes')::interval
  FROM generate_series(1, 13195) i;

-- ruído: 20 orgs x 4.000 leads = 80.000
INSERT INTO public.leads (id, organization_id, name, created_at)
SELECT gen_random_uuid(), ('9e7f0000-0000-0000-0000-0000000000' || lpad(to_hex(10 + o), 2, '0'))::uuid, 'ruido ' || i,
       now() - (i || ' minutes')::interval
  FROM generate_series(1, 3) o, generate_series(1, 2000) i;

INSERT INTO public.pipelines (id, organization_id, name, slug)
SELECT ('9e7f0004-0000-0000-0000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid,
       ('9e7f0000-0000-0000-0000-0000000000' || lpad(to_hex(i), 2, '0'))::uuid, 'Funil ' || i, 'funil-perf-' || i
  FROM generate_series(10, 30) i;
-- org A usa 3 funis
INSERT INTO public.pipelines (id, organization_id, name, slug)
SELECT ('9e7f0005-0000-0000-0000-00000000000' || i)::uuid, '9e7f0000-0000-0000-0000-00000000000a'::uuid, 'FunilA' || i, 'funil-a-' || i
  FROM generate_series(1, 2) i;

-- cards: 4.385 na org A (3 funis), 74.000 de ruído
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
SELECT gen_random_uuid(), '9e7f0000-0000-0000-0000-00000000000a'::uuid,
       CASE i % 3 WHEN 0 THEN '9e7f0004-0000-0000-0000-00000000000a'::uuid
                  WHEN 1 THEN '9e7f0005-0000-0000-0000-000000000001'::uuid
                  ELSE '9e7f0005-0000-0000-0000-000000000002'::uuid END,
       ('9e7f0003-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid, 'novo'
  FROM generate_series(1, 4385) i;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
SELECT gen_random_uuid(), l.organization_id, ('9e7f0004-0000-0000-0000-0000000000' || right(l.organization_id::text, 2))::uuid, l.id, 'novo'
  FROM public.leads l
 WHERE l.organization_id <> '9e7f0000-0000-0000-0000-00000000000a' AND l.name ~ '^ruido [0-9]+$'
   AND substring(l.name from '[0-9]+')::int <= 1500;

ANALYZE public.leads;
ANALYZE public.pipeline_entries;
ANALYZE public.pipelines;

SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.m(p_phase text, p_prof text, p_actor text, p_uid uuid, p_q text, p_sql text, p_count text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE l text; v_ms numeric; v_cnt bigint; i int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  FOR i IN 1..4 LOOP
    v_ms := NULL;
    FOR l IN EXECUTE 'EXPLAIN (ANALYZE, TIMING OFF) ' || p_sql LOOP
      IF l LIKE 'Execution Time:%' THEN v_ms := substring(l from '([0-9.]+) ms')::numeric; END IF;
    END LOOP;
  END LOOP;
  IF p_count IS NOT NULL THEN EXECUTE p_count INTO v_cnt; END IF;
  EXECUTE 'SET LOCAL role postgres';
  INSERT INTO perf_out (phase, prof, actor, q, ms, cnt) VALUES (p_phase, p_prof, p_actor, p_q, v_ms, v_cnt);
END $f$;

CREATE FUNCTION pg_temp.run_all(p_phase text, p_prof text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  org constant text := '9e7f0000-0000-0000-0000-00000000000a';
  q1 text := 'SELECT count(*) FROM public.leads WHERE organization_id = ''' || org || '''';
  q2 text := 'SELECT id, name, created_at FROM public.leads WHERE organization_id = ''' || org || ''' ORDER BY created_at DESC LIMIT 50';
  q3 text := 'SELECT count(*) FROM public.pipeline_entries WHERE organization_id = ''' || org || '''';
  a record;
BEGIN
  FOR a IN SELECT * FROM (VALUES ('admin', '9e7f0001-0000-0000-0000-000000000001'::uuid),
                                 ('membro', '9e7f0001-0000-0000-0000-000000000005'::uuid),
                                 ('supervisor', '9e7f0001-0000-0000-0000-000000000008'::uuid)) v(n, u) LOOP
    PERFORM pg_temp.m(p_phase, p_prof, a.n, a.u, 'Q1 count leads', q1, q1);
    PERFORM pg_temp.m(p_phase, p_prof, a.n, a.u, 'Q2 lista 50',    q2);
    PERFORM pg_temp.m(p_phase, p_prof, a.n, a.u, 'Q3 count cards', q3, q3);
  END LOOP;
END $f$;

CREATE FUNCTION pg_temp.perfil(p text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM public.organization_feature_defaults WHERE organization_id = '9e7f0000-0000-0000-0000-00000000000a';
  IF p = 'P2 restrito' THEN
    INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled)
    SELECT '9e7f0000-0000-0000-0000-00000000000a', k, false
      FROM unnest(ARRAY['leads.view_all','leads.view_unassigned','leads.view_subordinates','pipeline.view_all']) k;
  END IF;
END $f$;

CREATE FUNCTION pg_temp.fase(p_phase text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.perfil('P1 padrao');   PERFORM pg_temp.run_all(p_phase, 'P1 padrao');
  PERFORM pg_temp.perfil('P2 restrito'); PERFORM pg_temp.run_all(p_phase, 'P2 restrito');
END $f$;

-- ---------------------------------------------------------------- variante B
CREATE FUNCTION pg_temp.swap_to_b() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  DROP POLICY sector_scope_leads_select ON public.leads;
  DROP POLICY sector_scope_leads_update ON public.leads;
  DROP POLICY sector_scope_leads_delete ON public.leads;
  DROP POLICY sector_supervisor_leads_select ON public.leads;
  DROP POLICY sector_supervisor_leads_update ON public.leads;
  DROP POLICY sector_scope_pipelines_select ON public.pipelines;
  DROP POLICY sector_scope_pipeline_entries_select ON public.pipeline_entries;

  CREATE VIEW private.lead_sector_map AS SELECT lead_id, sector_id FROM public.lead_sectors;
  GRANT SELECT ON private.lead_sector_map TO authenticated, service_role;

  CREATE FUNCTION private.my_default_sector_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $q$ SELECT COALESCE(ARRAY(SELECT s.organization_id FROM public.sectors s WHERE s.is_default AND s.id = ANY (private.my_sector_ids())), '{}'::uuid[]) $q$;
  CREATE FUNCTION private.my_default_supervised_orgs() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $q$ SELECT COALESCE(ARRAY(SELECT s.organization_id FROM public.sectors s WHERE s.is_default AND s.id = ANY (private.my_supervised_sector_ids())), '{}'::uuid[]) $q$;
  CREATE FUNCTION private.sector_supervisor_orgs_m1() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $q$ SELECT COALESCE(ARRAY(SELECT s.organization_id FROM public.sectors s WHERE s.id = ANY (private.my_supervised_sector_ids())
        AND (SELECT count(*) FROM public.sectors x WHERE x.organization_id = s.organization_id) = 1), '{}'::uuid[]) $q$;
  CREATE FUNCTION private.sector_supervisor_orgs_m2() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $q$ SELECT COALESCE(ARRAY(SELECT DISTINCT s.organization_id FROM public.sectors s WHERE s.id = ANY (private.my_supervised_sector_ids())
        AND (SELECT count(*) FROM public.sectors x WHERE x.organization_id = s.organization_id) >= 2), '{}'::uuid[]) $q$;
  CREATE FUNCTION private.my_sector_pipeline_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
  $q$ SELECT COALESCE(ARRAY(SELECT p.id FROM public.pipelines p
       WHERE p.organization_id = ANY (private.sector_scoped_orgs())
         AND (EXISTS (SELECT 1 FROM public.pipeline_sectors ps WHERE ps.pipeline_id = p.id AND ps.sector_id = ANY (private.my_sector_ids()))
              OR (p.organization_id = ANY (private.my_default_sector_orgs())
                  AND NOT EXISTS (SELECT 1 FROM public.pipeline_sectors ps2 WHERE ps2.pipeline_id = p.id)))), '{}'::uuid[]) $q$;
  GRANT EXECUTE ON FUNCTION private.my_default_sector_orgs(), private.my_default_supervised_orgs(),
    private.sector_supervisor_orgs_m1(), private.sector_supervisor_orgs_m2(), private.my_sector_pipeline_ids() TO authenticated, service_role;

  CREATE POLICY sector_scope_leads_select ON public.leads AS RESTRICTIVE FOR SELECT USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR COALESCE((SELECT bool_or(m.sector_id = ANY ((SELECT private.my_sector_ids())::uuid[])) FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
                organization_id = ANY ((SELECT private.my_default_sector_orgs())::uuid[])));
  CREATE POLICY sector_scope_leads_update ON public.leads AS RESTRICTIVE FOR UPDATE USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR COALESCE((SELECT bool_or(m.sector_id = ANY ((SELECT private.my_sector_ids())::uuid[])) FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
                organization_id = ANY ((SELECT private.my_default_sector_orgs())::uuid[])));
  CREATE POLICY sector_supervisor_leads_select ON public.leads FOR SELECT USING (
    deleted_at IS NULL AND (
      organization_id = ANY ((SELECT private.sector_supervisor_orgs_m1())::uuid[])
      OR (organization_id = ANY ((SELECT private.sector_supervisor_orgs_m2())::uuid[])
          AND COALESCE((SELECT bool_or(m.sector_id = ANY ((SELECT private.my_supervised_sector_ids())::uuid[])) FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
                       organization_id = ANY ((SELECT private.my_default_supervised_orgs())::uuid[])))));
  CREATE POLICY sector_scope_pipelines_select ON public.pipelines AS RESTRICTIVE FOR SELECT USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR id = ANY ((SELECT private.my_sector_pipeline_ids())::uuid[]));
  CREATE POLICY sector_scope_pipeline_entries_select ON public.pipeline_entries AS RESTRICTIVE FOR SELECT USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR pipeline_id = ANY ((SELECT private.my_sector_pipeline_ids())::uuid[]));
END $f$;

CREATE FUNCTION pg_temp.fase2(p_phase text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.perfil('P1 padrao');   PERFORM pg_temp.run_all(p_phase, 'P1 padrao');
  PERFORM pg_temp.perfil('P2 restrito'); PERFORM pg_temp.run_all(p_phase, 'P2 restrito');
END $f$;

-- ---------------------------------------------------------------- dados: modo 2
SET LOCAL session_replication_role = replica;
INSERT INTO public.sectors (id, organization_id, name, is_default) VALUES
  ('9e7f0006-0000-0000-0000-000000000001', '9e7f0000-0000-0000-0000-00000000000a', 'Y', true),
  ('9e7f0006-0000-0000-0000-000000000002', '9e7f0000-0000-0000-0000-00000000000a', 'Z', false);
INSERT INTO public.sector_members (sector_id, team_member_id, organization_id, sector_role)
SELECT CASE WHEN i = 7 THEN '9e7f0006-0000-0000-0000-000000000002'::uuid ELSE '9e7f0006-0000-0000-0000-000000000001'::uuid END,
       ('9e7f0002-0000-0000-0000-00000000000' || i)::uuid, '9e7f0000-0000-0000-0000-00000000000a',
       CASE WHEN i = 8 THEN 'supervisor' ELSE 'member' END
  FROM generate_series(5, 8) i;
INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
SELECT l.id, s.sid, l.organization_id
  FROM (SELECT id, organization_id, (substring(name from '[0-9]+')::int % 10) b FROM public.leads
         WHERE organization_id = '9e7f0000-0000-0000-0000-00000000000a') l
  JOIN LATERAL (VALUES ('9e7f0006-0000-0000-0000-000000000001'::uuid, 0, 4),
                       ('9e7f0006-0000-0000-0000-000000000002'::uuid, 5, 8)) s(sid, lo, hi) ON l.b BETWEEN s.lo AND s.hi
UNION ALL
SELECT l.id, '9e7f0006-0000-0000-0000-000000000001'::uuid, l.organization_id
  FROM public.leads l WHERE l.organization_id = '9e7f0000-0000-0000-0000-00000000000a'
   AND substring(l.name from '[0-9]+')::int % 10 = 8;
INSERT INTO public.pipeline_sectors (pipeline_id, sector_id, organization_id) VALUES
  ('9e7f0004-0000-0000-0000-00000000000a', '9e7f0006-0000-0000-0000-000000000001', '9e7f0000-0000-0000-0000-00000000000a'),
  ('9e7f0005-0000-0000-0000-000000000001', '9e7f0006-0000-0000-0000-000000000002', '9e7f0000-0000-0000-0000-00000000000a');
ANALYZE public.lead_sectors;
SET LOCAL session_replication_role = origin;



SELECT pg_temp.fase2('FINAL modo2');

-- modo 1: remove Z e os vínculos
SET LOCAL session_replication_role = replica;
DELETE FROM public.lead_sectors; DELETE FROM public.pipeline_sectors;
UPDATE public.sector_members SET sector_id = '9e7f0006-0000-0000-0000-000000000001';
DELETE FROM public.sectors WHERE id = '9e7f0006-0000-0000-0000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.fase2('FINAL modo1');

-- modo 0
SET LOCAL session_replication_role = replica;
DELETE FROM public.sector_members; DELETE FROM public.sectors;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.fase2('FINAL modo0');

-- baseline: sem policies de setor
DROP POLICY sector_scope_leads_select ON public.leads;
DROP POLICY sector_scope_leads_update ON public.leads;
DROP POLICY sector_supervisor_leads_select ON public.leads;

DROP POLICY sector_scope_pipelines_select ON public.pipelines;
DROP POLICY sector_scope_pipeline_entries_select ON public.pipeline_entries;
SELECT pg_temp.fase2('0 BASELINE');

DO $r$
BEGIN
  RAISE EXCEPTION E'\nRESULTADO_PERF\n%', (
    SELECT string_agg(l, E'\n' ORDER BY k) FROM (
      SELECT min(ord) k, format('%-26s %-11s %-10s Q1=%5s Q2=%5s Q3=%5s  vis=%s', phase, prof, actor,
               round(max(ms) FILTER (WHERE q LIKE 'Q1%')), round(max(ms) FILTER (WHERE q LIKE 'Q2%')),
               round(max(ms) FILTER (WHERE q LIKE 'Q3%')), max(cnt) FILTER (WHERE q LIKE 'Q1%')) l
        FROM perf_out GROUP BY phase, prof, actor) z);
END $r$;

SELECT * FROM finish();
ROLLBACK;