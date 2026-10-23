-- supabase/tests/telefone_nn_compartilhar_test.sql
--
-- Telefone N:N, PR4 (Chamados 99067f13 / 8148e1f9 / b9ccde65; migration
-- 20271207000000_telefone_compartilhar_numero.sql).
--
--   (CF) salvar_telefones_do_lead, como a VENDEDORA (member, sem ver lead sem dono):
--        sem o parametro -> 23505 no indice; com p_permitir_compartilhado => true
--        marca o lead ALVO (o dono, invisivel para ela, nunca); numero livre nao
--        marca; trilha em lead_history. E o caso do 8148e1f9: alvo sem principal,
--        dono do numero sem responsavel.
--   (PE) permissao: lead que o usuario nao ve -> P0002; outra org -> recusa.
--   (GD) garantia de dono (gatilho de UPDATE): marcar lead sem outro detentor -> 23514.
--   (IN) gatilho de INSERT: lead nao nasce compartilhado -> 23514.
--   (DE) lead_phone_descompartilhar: com dono vivo -> 23505; sem -> zera; idempotente.
--   (AP) api_create_lead devolve o DONO no 'conflict'.
--
-- Roda inteiro em transacao revertida, como `authenticated` com as claims do JWT
-- (assert_org_access e a RLS decidem pelo claim, nao pelo current_user).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures (gatilhos OFF no seed; normalized_phone explicito)
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('99067f13-0000-4000-8000-00000000000a', 'Org TEL A', 'org-tel-a', 'America/Sao_Paulo'),
  ('99067f13-0000-4000-8000-00000000000b', 'Org TEL B', 'org-tel-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('99067f13-0000-4000-8000-0000000000a1', 'tel-admin@test.local'),
    ('99067f13-0000-4000-8000-0000000000a2', 'tel-vendedora@test.local'),
    ('99067f13-0000-4000-8000-0000000000a3', 'tel-semlead@test.local'),
    ('99067f13-0000-4000-8000-0000000000b1', 'tel-org-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('99067f13-0000-4000-8000-0000000001a1', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a1', 'Admin A',     'admin',  true),
  ('99067f13-0000-4000-8000-0000000001a2', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a2', 'Vendedora A', 'member', true),
  ('99067f13-0000-4000-8000-0000000001a3', '99067f13-0000-4000-8000-00000000000a', '99067f13-0000-4000-8000-0000000000a3', 'Sem lead A',  'member', true),
  ('99067f13-0000-4000-8000-0000000001b1', '99067f13-0000-4000-8000-00000000000b', '99067f13-0000-4000-8000-0000000000b1', 'Admin B',     'admin',  true)
ON CONFLICT (id) DO NOTHING;

-- Como na Café Jurerê: membro so ve (e edita) lead pelo qual responde.
INSERT INTO public.organization_feature_defaults (organization_id, feature_key, enabled) VALUES
  ('99067f13-0000-4000-8000-00000000000a', 'leads.view_all', false),
  ('99067f13-0000-4000-8000-00000000000a', 'leads.view_unassigned', false),
  ('99067f13-0000-4000-8000-00000000000a', 'leads.view_subordinates', false);

-- Dono: sem responsavel (invisivel para a vendedora), segura 11922220001.
-- Alvo: da vendedora, SEM telefone principal (o 8148e1f9: o numero chegou como contato).
INSERT INTO public.leads (id, organization_id, name, phone, normalized_phone, phone_compartilhado, sdr_id, origin, created_at) VALUES
  ('99067f13-0000-4000-8000-0000000002a1', '99067f13-0000-4000-8000-00000000000a', 'Dono',          '11922220001', '11922220001', false, NULL, 'erp_toth', '2026-01-01'),
  ('99067f13-0000-4000-8000-0000000002a2', '99067f13-0000-4000-8000-00000000000a', 'Alvo',          NULL,          NULL,          false, '99067f13-0000-4000-8000-0000000001a2', 'erp_toth', '2026-02-01'),
  ('99067f13-0000-4000-8000-0000000002a3', '99067f13-0000-4000-8000-00000000000a', 'Livre',         '11922220003', '11922220003', false, '99067f13-0000-4000-8000-0000000001a2', 'meta_ads', '2026-02-02'),
  ('99067f13-0000-4000-8000-0000000002a4', '99067f13-0000-4000-8000-00000000000a', 'Compart. ant.', '11922220009', '11922220009', true,  NULL, 'meta_ads', '2025-01-01'),
  ('99067f13-0000-4000-8000-0000000002a5', '99067f13-0000-4000-8000-00000000000a', 'Dono real',     '11922220009', '11922220009', false, NULL, 'meta_ads', '2026-03-01'),
  ('99067f13-0000-4000-8000-0000000002a6', '99067f13-0000-4000-8000-00000000000a', 'Alheio',        '11922220006', '11922220006', false, '99067f13-0000-4000-8000-0000000001a1', 'meta_ads', '2026-03-02'),
  ('99067f13-0000-4000-8000-0000000002b1', '99067f13-0000-4000-8000-00000000000b', 'Lead B1',       '11922220004', '11922220004', false, NULL, 'meta_ads', '2026-02-02');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (CF) como a VENDEDORA (member)
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a2',
      '[{"phone":"11922220001","label":"Jair","is_primary":true}]'::jsonb)$$,
  '23505', NULL,
  'CF1: sem o parametro, principal ocupado (dono invisivel) continua 23505');

-- O front distingue este 23505 pelo nome do indice na mensagem.
SELECT throws_like(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a2',
      '[{"phone":"11922220001","label":"Jair","is_primary":true}]'::jsonb)$$,
  '%idx_leads_org_phone_unique%',
  'CF1b: a mensagem do 23505 nomeia idx_leads_org_phone_unique');

SELECT lives_ok(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a2',
      '[{"phone":"11922220001","label":"Jair","is_primary":true}]'::jsonb,
      p_permitir_compartilhado => true)$$,
  'CF2: com a confirmacao, a vendedora salva (sem can_update_lead no caminho INVOKER)');

RESET ROLE;
SELECT is(
  (SELECT row(phone_compartilhado, normalized_phone)::text FROM public.leads
    WHERE id = '99067f13-0000-4000-8000-0000000002a2'),
  '(t,11922220001)', 'CF3: o lead ALVO ficou marcado e com o numero');
SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '99067f13-0000-4000-8000-0000000002a1'),
  false, 'CF4: o DONO nunca e marcado');
SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '99067f13-0000-4000-8000-00000000000a' AND deleted_at IS NULL
      AND normalized_phone = '11922220001'),
  2, 'CF5: os dois leads vivos coexistem com o mesmo principal');
SELECT is(
  (SELECT string_agg(action || ':' || created_by::text, ',') FROM public.lead_history
    WHERE lead_id = '99067f13-0000-4000-8000-0000000002a2' AND action LIKE 'phone_%'),
  'phone_shared:99067f13-0000-4000-8000-0000000000a2',
  'CF6: trilha phone_shared no lead alvo, autoria da vendedora');
SELECT is(
  (SELECT string_agg(normalized_phone, ',') FROM public.lead_phones
    WHERE lead_id = '99067f13-0000-4000-8000-0000000002a2' AND deleted_at IS NULL AND is_primary),
  '11922220001', 'CF7: o contato do alvo virou o principal');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a3',
      '[{"phone":"11922220005","label":"Contato","is_primary":true}]'::jsonb,
      p_permitir_compartilhado => true)$$,
  'CF8: numero livre com true salva');
RESET ROLE;
SELECT is(
  (SELECT row(phone_compartilhado, normalized_phone)::text FROM public.leads
    WHERE id = '99067f13-0000-4000-8000-0000000002a3'),
  '(f,11922220005)', 'CF9: numero livre com true troca o numero e NAO marca');

-- ===========================================================================
-- (PE) permissao
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a6',
      '[{"phone":"11922220001","label":"Contato","is_primary":true}]'::jsonb,
      p_permitir_compartilhado => true)$$,
  'P0002', 'lead_not_found',
  'PE1: lead de outro vendedor (invisivel) e recusado, nada marcado');

SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.salvar_telefones_do_lead('99067f13-0000-4000-8000-0000000002a2',
      '[{"phone":"11922220001","label":"Jair","is_primary":true}]'::jsonb,
      p_permitir_compartilhado => true)$$,
  'P0002', 'lead_not_found',
  'PE2: membro sem o lead nao compartilha por ele');

-- ===========================================================================
-- (GD) garantia de dono, como admin da org A (a RLS deixa o UPDATE passar)
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$UPDATE public.leads SET phone_compartilhado = true
     WHERE id = '99067f13-0000-4000-8000-0000000002a3'$$,
  '23514', 'phone_compartilhado_sem_dono',
  'GD1: marcar lead que e o unico detentor do numero e recusado');
SELECT throws_ok(
  $$UPDATE public.leads SET phone_compartilhado = true
     WHERE id = '99067f13-0000-4000-8000-0000000002a1'$$,
  '23514', 'phone_compartilhado_sem_dono',
  'GD2: marcar o DONO (restaria so compartilhado) e recusado');

-- ===========================================================================
-- (DE) desfazer, primeiro com o dono vivo
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.lead_phone_descompartilhar('99067f13-0000-4000-8000-0000000002a2')$$,
  '23505', 'principal_ocupado',
  'DE1: desfazer com o dono vivo segurando o numero e recusado');
SELECT is(
  public.lead_phone_descompartilhar('99067f13-0000-4000-8000-0000000002a3'),
  false, 'DE2: desfazer lead nao marcado e no-op (false)');

-- ===========================================================================
-- (IN) e (AP) como backend
-- ===========================================================================
RESET ROLE;
SELECT throws_ok(
  $$INSERT INTO public.leads (organization_id, name, phone, phone_compartilhado, origin)
    VALUES ('99067f13-0000-4000-8000-00000000000a', 'Nasce marcado', '11922220001', true, 'api')$$,
  '23514', 'phone_compartilhado_so_por_acao',
  'IN1: lead nao nasce compartilhado');

SELECT is(
  (SELECT (public.api_create_lead('99067f13-0000-4000-8000-00000000000a'::uuid,
      '{"name":"X","phone":"11922220009"}'::jsonb)) -> 'lead' ->> 'id'),
  '99067f13-0000-4000-8000-0000000002a5',
  'AP1: conflict devolve o DONO, nao o compartilhado mais antigo');

-- Dono sai (lixeira): o alvo pode voltar a ser lead "normal".
UPDATE public.leads SET deleted_at = now() WHERE id = '99067f13-0000-4000-8000-0000000002a1';

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT is(
  public.lead_phone_descompartilhar('99067f13-0000-4000-8000-0000000002a2'),
  true, 'DE3: sem dono vivo, a vendedora desfaz a marca do proprio lead');

RESET ROLE;
SELECT is(
  (SELECT phone_compartilhado FROM public.leads WHERE id = '99067f13-0000-4000-8000-0000000002a2'),
  false, 'DE4: marca zerada');
SELECT is(
  (SELECT string_agg(action, ',' ORDER BY created_at, action) FROM public.lead_history
    WHERE lead_id = '99067f13-0000-4000-8000-0000000002a2' AND action LIKE 'phone_%'),
  'phone_shared,phone_unshared', 'DE5: trilha phone_unshared');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99067f13-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.lead_phone_descompartilhar('99067f13-0000-4000-8000-0000000002a2')$$,
  NULL, NULL,
  'PE3: admin de OUTRA org nao mexe em lead alheio');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
