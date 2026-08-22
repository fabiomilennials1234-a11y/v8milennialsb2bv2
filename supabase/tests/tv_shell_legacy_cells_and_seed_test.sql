-- supabase/tests/tv_shell_legacy_cells_and_seed_test.sql
--
-- ISSUE #1207 (épico #1194 · ADR-0023) — casca da TV: célula legada reservada
-- + painel padrão semeado.
--
-- Cobre:
--   (REN) catálogo de renderers: RLS habilitada, deny-all de escrita, servido
--         por fn_metric_catalog
--   (COH) kind_coherence nos 3 ramos + ELSE false (kind desconhecido rejeitado)
--   (LEG) célula legada grava com renderer_id e SEM medida/recorte/formato
--   (SNP) snapshot emite a célula legada sem chamar o motor (measure null)
--   (SEED) fn_seed_default_dashboard: gate de flag, idempotência, teto de 12
--   (TRG) o flip da flag semeia sozinho — ninguém acorda com tela vazia
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('12070000-0000-4000-8000-00000000000a', 'Org TV A', 'org-tv-a-1207', 'America/Sao_Paulo'),
  ('12070000-0000-4000-8000-00000000000b', 'Org TV B', 'org-tv-b-1207', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- A ligada; B fica DESLIGADA para provar o gate e o gatilho do flip.
UPDATE public.organizations SET composable_metrics_enabled = true
  WHERE id = '12070000-0000-4000-8000-00000000000a';

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('12070000-0000-4000-8000-000000000101', 'tv-1207@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('12070000-0000-4000-8000-000000000201', '12070000-0000-4000-8000-00000000000a',
   '12070000-0000-4000-8000-000000000101', 'Admin TV A', 'admin', true),
  ('12070000-0000-4000-8000-000000000202', '12070000-0000-4000-8000-00000000000b',
   '12070000-0000-4000-8000-000000000101', 'Admin TV B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dashboard_pages (id, organization_id, surface, title, position) VALUES
  ('12070000-0000-4000-8000-000000000501', '12070000-0000-4000-8000-00000000000a', 'tv', 'Página teste', 9)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (REN) catálogo de renderers
-- ===========================================================================
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'metric_catalog_renderers'),
  '(REN) metric_catalog_renderers tem RLS habilitada (policy não fica inerte)');

SELECT is(
  (SELECT count(*)::int FROM public.metric_catalog_renderers WHERE is_legacy),
  2, '(REN) os 2 renderers legados estão semeados');

SELECT is(
  (SELECT count(*)::int FROM (SELECT jsonb_array_elements(public.fn_metric_catalog()->'renderers')) x),
  2, '(REN) fn_metric_catalog serve os renderers (Composer filtra is_legacy)');

-- ===========================================================================
-- (LEG)/(COH) célula legada e coerência dos 3 ramos
-- ===========================================================================
SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12070000-0000-4000-8000-000000000101","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.dashboard_widgets
       (organization_id, page_id, measure_kind, renderer_id, weight, pinned, grid_col, grid_row, grid_w, grid_h)
     VALUES ('12070000-0000-4000-8000-00000000000a','12070000-0000-4000-8000-000000000501',
             'legacy','legacy:thermometer','primary',true,0,0,3,4) $$,
  '(LEG) célula legada grava com renderer_id e sem medida/recorte/formato');

SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets
       (organization_id, page_id, measure_kind, renderer_id, measure_id, recorte_id, format_id)
     VALUES ('12070000-0000-4000-8000-00000000000a','12070000-0000-4000-8000-000000000501',
             'legacy','legacy:thermometer','receita','total','currency_brl') $$,
  '23514', NULL, '(COH) legacy COM medida é rejeitado (célula reservada não avalia)');

SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets
       (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id, renderer_id)
     VALUES ('12070000-0000-4000-8000-00000000000a','12070000-0000-4000-8000-000000000501',
             'leaf','receita','total','currency_brl','legacy:thermometer') $$,
  '23514', NULL, '(COH) leaf COM renderer é rejeitado (simetria: snapshot ficaria ambíguo)');

SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets
       (organization_id, page_id, measure_kind, renderer_id)
     VALUES ('12070000-0000-4000-8000-00000000000a','12070000-0000-4000-8000-000000000501',
             'legacy','nao:existe') $$,
  '23503', NULL, '(LEG) renderer fora do catálogo = FK violation (fronteira declarativa)');

SELECT throws_ok(
  $$ INSERT INTO public.dashboard_widgets
       (organization_id, page_id, measure_kind, measure_id, recorte_id, format_id)
     VALUES ('12070000-0000-4000-8000-00000000000a','12070000-0000-4000-8000-000000000501',
             'inventado','receita','total','currency_brl') $$,
  '23514', NULL, '(COH) kind desconhecido continua rejeitado (ELSE false preservado)');

-- ===========================================================================
-- (SNP) snapshot emite a célula legada sem chamar o motor
-- ===========================================================================
SELECT is(
  (public.fn_dashboard_snapshot('12070000-0000-4000-8000-00000000000a',
     '12070000-0000-4000-8000-000000000501','month','2027-08-15') #>> '{widgets,0,measure_kind}'),
  'legacy', '(SNP) snapshot devolve a célula legada');

SELECT ok(
  (public.fn_dashboard_snapshot('12070000-0000-4000-8000-00000000000a',
     '12070000-0000-4000-8000-000000000501','month','2027-08-15') #> '{widgets,0,measure}') = 'null'::jsonb,
  '(SNP) célula legada vem com measure null — o motor não é chamado para ela');

SELECT is(
  (public.fn_dashboard_snapshot('12070000-0000-4000-8000-00000000000a',
     '12070000-0000-4000-8000-000000000501','month','2027-08-15') #>> '{widgets,0,renderer_id}'),
  'legacy:thermometer', '(SNP) renderer_id chega ao front para resolver o componente');

-- ===========================================================================
-- (AUTH) autorização do wrapper público — achado 4a do revisor
-- ===========================================================================
-- Membro comum NÃO semeia: a função é SECURITY DEFINER e seus INSERT bypassam
-- a RLS admin-only do #1194. Semear e montar são a mesma classe de escrita.
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('12070000-0000-4000-8000-000000000102', 'tv2-1207@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('12070000-0000-4000-8000-000000000203', '12070000-0000-4000-8000-00000000000a',
   '12070000-0000-4000-8000-000000000102', 'Membro comum', 'member', true)
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = DEFAULT;
SET LOCAL role authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"12070000-0000-4000-8000-000000000102","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.fn_seed_default_dashboard('12070000-0000-4000-8000-00000000000a') $$,
  '42501', NULL, '(AUTH) membro comum NÃO semeia (não pode bypassar a RLS admin-only)');

SELECT set_config('request.jwt.claims',
  '{"sub":"12070000-0000-4000-8000-000000000101","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.fn_seed_default_dashboard('12070000-0000-4000-8000-00000000000a') $$,
  '(AUTH) admin da org passa pelo gate');

-- ===========================================================================
-- (SEED) o corpo — caminho de SISTEMA, SEM JWT (regressão do achado 4b)
-- ===========================================================================
SET LOCAL role postgres;
-- Contexto IDÊNTICO ao de migration: nenhum JWT. auth.role() é NULL, não
-- 'service_role'. Se o gate de usuário voltasse para dentro do corpo, tudo
-- abaixo levantaria access_denied e o backfill semearia zero em silêncio.
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT COALESCE(auth.role(), '<null>')),
  '<null>', '(SEED) contexto de migration confirmado: auth.role() é NULL, não service_role');

-- Org B está com a flag OFF → não semeia.
SELECT is(
  (public._fn_seed_default_dashboard_unchecked('12070000-0000-4000-8000-00000000000b') ->> 'reason'),
  'flag_off', '(SEED) flag desligada não semeia');

-- Org A já tem página de TV (a de teste) → criar-se-ausente, nunca reseta.
SELECT is(
  (public._fn_seed_default_dashboard_unchecked('12070000-0000-4000-8000-00000000000a') ->> 'reason'),
  'already_exists', '(SEED) org que já tem painel não é semeada de novo (não-clobber)');

-- Org limpa: semeia 2 páginas — SEM JWT, que é o caso do backfill real.
INSERT INTO public.organizations (id, name, slug, timezone, composable_metrics_enabled)
VALUES ('12070000-0000-4000-8000-00000000000c', 'Org TV C', 'org-tv-c-1207', 'America/Sao_Paulo', true)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (public._fn_seed_default_dashboard_unchecked('12070000-0000-4000-8000-00000000000c') ->> 'pages')::int,
  2, '(SEED) semeia as 2 páginas SEM JWT — o backfill não é no-op silencioso');

SELECT ok(
  (SELECT count(*) FROM public.dashboard_widgets w
   JOIN public.dashboard_pages p ON p.id = w.page_id
   WHERE p.organization_id = '12070000-0000-4000-8000-00000000000c') > 0,
  '(SEED) painel semeado tem widgets — ninguém acorda com tela vazia');

SELECT ok(
  (SELECT max(c) FROM (
     SELECT count(*) AS c FROM public.dashboard_widgets w
     JOIN public.dashboard_pages p ON p.id = w.page_id
     WHERE p.organization_id = '12070000-0000-4000-8000-00000000000c'
     GROUP BY w.page_id) t) <= 12,
  '(SEED) nenhuma página semeada estoura o teto de 12 widgets (§6.4)');

-- Os 2 pinados aparecem em CADA uma das 2 páginas (custo por página) — e são
-- NATIVOS, não `legacy`.
--
-- ⚠ ESTA ASSERÇÃO MEDIA 'legacy' E FICOU PARA TRÁS (SCRUM-413). A migration
-- 20260727110100_tv_reseed_legacy_to_native.sql promoveu os quatro widgets
-- `legacy:*` ao formato nativo equivalente — thermometer virou Progresso
-- (receita/total) e closer-performance virou Ranking (receita/closer) — porque
-- célula legada renderizava moldura e travessão SEM corpo, e a regra do Vitral
-- §5.0 proíbe célula pinada em branco na parede viva. Desde então o semeador
-- não emite `legacy` nenhum, e a asserção pedia 4 de uma espécie extinta:
-- `have: 0, want: 4`.
--
-- Medido em produção em 2026-08-22: `dashboard_widgets` tem 15 linhas, ZERO
-- `legacy`, e as 4 pinadas são todas `leaf`/`receita`.
SELECT is(
  (SELECT count(*)::int FROM public.dashboard_widgets w
   JOIN public.dashboard_pages p ON p.id = w.page_id
   WHERE p.organization_id = '12070000-0000-4000-8000-00000000000c'
     AND w.measure_kind = 'leaf' AND w.measure_id = 'receita' AND w.pinned),
  4, '(SEED) os 2 pinados NATIVOS (receita/total + receita/closer) em CADA uma das 2 páginas');

-- E o legado não volta pela porta dos fundos: o semeador é a única fonte de
-- painel novo, e ele não pode ressuscitar a espécie que a fatia 1 aposentou.
SELECT is(
  (SELECT count(*)::int FROM public.dashboard_widgets w
   JOIN public.dashboard_pages p ON p.id = w.page_id
   WHERE p.organization_id = '12070000-0000-4000-8000-00000000000c'
     AND w.measure_kind = 'legacy'),
  0, '(SEED) o semeador NÃO emite célula legacy — ela renderiza moldura sem corpo');

-- ===========================================================================
-- (TRG) o flip da flag semeia sozinho
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('12070000-0000-4000-8000-00000000000d', 'Org TV D', 'org-tv-d-1207', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM public.dashboard_pages WHERE organization_id = '12070000-0000-4000-8000-00000000000d'),
  0, '(TRG) org com flag OFF não tem painel');

UPDATE public.organizations SET composable_metrics_enabled = true
  WHERE id = '12070000-0000-4000-8000-00000000000d';

SELECT is(
  (SELECT count(*)::int FROM public.dashboard_pages WHERE organization_id = '12070000-0000-4000-8000-00000000000d'),
  2, '(TRG) ligar a flag semeia o painel sozinho — ninguém acorda com tela vazia');

-- Guarda do arquiteto: re-flip ON→OFF→ON NÃO pode sobrescrever composição já
-- editada pelo cliente. Idempotência aqui é NÃO-CLOBBER, não "recriar igual".
UPDATE public.dashboard_pages SET title = 'Editado pelo cliente'
  WHERE organization_id = '12070000-0000-4000-8000-00000000000d' AND position = 0;
DELETE FROM public.dashboard_pages
  WHERE organization_id = '12070000-0000-4000-8000-00000000000d' AND position = 1;

UPDATE public.organizations SET composable_metrics_enabled = false
  WHERE id = '12070000-0000-4000-8000-00000000000d';
UPDATE public.organizations SET composable_metrics_enabled = true
  WHERE id = '12070000-0000-4000-8000-00000000000d';

SELECT is(
  (SELECT title FROM public.dashboard_pages
   WHERE organization_id = '12070000-0000-4000-8000-00000000000d' AND position = 0),
  'Editado pelo cliente',
  '(TRG) re-flip ON→OFF→ON NÃO sobrescreve o painel editado (não-clobber)');

SELECT is(
  (SELECT count(*)::int FROM public.dashboard_pages
   WHERE organization_id = '12070000-0000-4000-8000-00000000000d'),
  1, '(TRG) re-flip não recria a página que o cliente apagou');

-- Guarda do arquiteto: UPDATE em organizations que NÃO mexe na flag não escreve
-- painel (organizations é tabela quente).
INSERT INTO public.organizations (id, name, slug, timezone)
VALUES ('12070000-0000-4000-8000-00000000000e', 'Org TV E', 'org-tv-e-1207', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;
UPDATE public.organizations SET name = 'Org TV E renomeada'
  WHERE id = '12070000-0000-4000-8000-00000000000e';
SELECT is(
  (SELECT count(*)::int FROM public.dashboard_pages WHERE organization_id = '12070000-0000-4000-8000-00000000000e'),
  0, '(TRG) UPDATE que não toca a flag não semeia nada (trigger estreito)');

SELECT * FROM finish();
ROLLBACK;
