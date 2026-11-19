-- supabase/tests/corrigir_venda_ganha_sem_valor_test.sql
--
-- Venda ganha SEM valor (orgs poupadas de rollout_exige_valor_venda) precisa
-- poder ser corrigida. A RPC gravava v_old.sale_value cru em
-- deal_sale_corrections.before_value (NOT NULL) e estourava 23502.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('c0ff3e00-0000-4000-8000-00000000000a', 'Org CVG', 'org-cvg', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES (
  'c0ff3e00-0000-4000-8000-0000000000a1', 'cvg-admin@test.local', '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('c0ff3e00-0000-4000-8000-0000000001a1', 'c0ff3e00-0000-4000-8000-00000000000a',
   'c0ff3e00-0000-4000-8000-0000000000a1', 'Admin CVG', 'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('c0ff3e00-0000-4000-8000-00000000001a', 'c0ff3e00-0000-4000-8000-00000000000a', 'Lead CVG');

-- Negócio ganho sem valor, com a venda (producer deal) também sem valor.
INSERT INTO public.deals (id, organization_id, source_lead_id, title, value, source, outcome, won, outcome_at, closed_at, updated_at)
VALUES ('c0ff3e00-0000-4000-8000-00000000000d', 'c0ff3e00-0000-4000-8000-00000000000a',
        'c0ff3e00-0000-4000-8000-00000000001a', 'Ganho sem valor', NULL, 'human',
        'won', true, now() - interval '5 days', now() - interval '5 days', '2020-01-01T00:00:00Z');

INSERT INTO public.sale_events (id, organization_id, lead_id, deal_id, event_type, sold_at, sale_value, producer, source, revenue_stream)
VALUES ('c0ff3e00-0000-4000-8000-00000000005e', 'c0ff3e00-0000-4000-8000-00000000000a',
        'c0ff3e00-0000-4000-8000-00000000001a', 'c0ff3e00-0000-4000-8000-00000000000d',
        'sale', now() - interval '5 days', NULL, 'deal', 'ui', 'novo_negocio');

SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0ff3e00-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $q$SELECT public.corrigir_venda_ganha(
       'c0ff3e00-0000-4000-8000-00000000000d', '2020-01-01T00:00:00Z', 500.00,
       (now() AT TIME ZONE 'America/Sao_Paulo')::date - 3, 'valor não informado no fechamento')$q$,
  '(CORRIGIR) venda ganha sem valor é corrigida sem 23502');

-- Leitura de conferência fora do RLS: o que se testa é a escrita da RPC.
RESET ROLE;

SELECT is(
  (SELECT value FROM public.deals WHERE id = 'c0ff3e00-0000-4000-8000-00000000000d'),
  500.00::numeric, '(CORRIGIR) deals.value recebe o valor informado');

SELECT is(
  (SELECT count(*)::int FROM public.sale_events
    WHERE deal_id = 'c0ff3e00-0000-4000-8000-00000000000d' AND event_type = 'sale_reversed'),
  1, '(CORRIGIR) a venda original foi estornada');

SELECT is(
  (SELECT sale_value FROM public.sale_events
    WHERE deal_id = 'c0ff3e00-0000-4000-8000-00000000000d' AND event_type = 'sale'
      AND adjusts_sale_id IS NOT NULL),
  500.00::numeric, '(CORRIGIR) a venda nova carrega o valor');

SELECT is(
  (SELECT before_value FROM public.deal_sale_corrections
    WHERE deal_id = 'c0ff3e00-0000-4000-8000-00000000000d'),
  0::numeric, '(AUDITORIA) "antes" ausente vira 0 na trilha');

SELECT is(
  (SELECT after_value FROM public.deal_sale_corrections
    WHERE deal_id = 'c0ff3e00-0000-4000-8000-00000000000d'),
  500.00::numeric, '(AUDITORIA) "depois" registra o valor novo');

SELECT is(
  (SELECT reason FROM public.deal_sale_corrections
    WHERE deal_id = 'c0ff3e00-0000-4000-8000-00000000000d'),
  'valor não informado no fechamento', '(AUDITORIA) o motivo é gravado');

SELECT * FROM finish();
ROLLBACK;
