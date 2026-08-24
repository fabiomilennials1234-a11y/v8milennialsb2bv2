-- supabase/tests/api_update_deal_test.sql
--
-- Ticket #1772 — `api_update_deal` e `api_list_lead_deals`.
--
-- A asserção que motiva esta suíte existir: **Negócio fechado não reabre**.
-- Sair da situação de ganho dispara `sale_reversed`, que é irreversível
-- (decisão G do CTO). Uma guarda só no handler protegeria quem passa pelo
-- handler; a que vale é a do banco, porque protege também o dia em que alguém
-- chamar a RPC de outro lugar — que é como caminhos alternativos nascem.
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('api_update_deal','api_list_lead_deals')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint,
  '(ACL) nem anon nem authenticated executam a edição de Negócio');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000ba01', 'Org Upd A', 'org-upd-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-00000000ba02', 'Org Upd B', 'org-upd-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name) VALUES
  ('deadbeef-0000-4000-8000-00000000ba0a', 'deadbeef-0000-4000-8000-00000000ba01', 'Lead UA')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.deals (id, organization_id, source_lead_id, title, value, source, last_activity_at, updated_at) VALUES
  ('deadbeef-0000-4000-8000-00000000bd01', 'deadbeef-0000-4000-8000-00000000ba01', 'deadbeef-0000-4000-8000-00000000ba0a', 'Aberto',  100, 'api', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
  ('deadbeef-0000-4000-8000-00000000bd02', 'deadbeef-0000-4000-8000-00000000ba01', 'deadbeef-0000-4000-8000-00000000ba0a', 'Perdido', 200, 'api', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
  ('deadbeef-0000-4000-8000-00000000bd03', 'deadbeef-0000-4000-8000-00000000ba02', 'deadbeef-0000-4000-8000-00000000ba0a', 'Alheio',  300, 'api', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (EDITAR)
-- ===========================================================================
SELECT is(
  (SELECT (public.api_update_deal(
     'deadbeef-0000-4000-8000-00000000ba01',
     'deadbeef-0000-4000-8000-00000000bd01',
     p_title => 'Renegociado', p_value => 999))->>'title'),
  'Renegociado',
  '(EDITAR) título muda');

SELECT is(
  (SELECT value FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000bd01'),
  999::numeric,
  '(EDITAR) valor muda');

-- Editar é atividade: sem isto o conector que sincroniza por updated_since
-- nunca veria a renegociação.
SELECT ok(
  (SELECT last_activity_at FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000bd01')
    > '2020-01-01T00:00:00Z',
  '(EDITAR) a edição carimba last_activity_at — entra no delta de quem sincroniza');

-- Campo omitido NÃO apaga o que já estava. É a limitação declarada do PATCH:
-- omitido e null são a mesma coisa aqui.
SELECT is(
  (SELECT title FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000bd01'),
  'Renegociado',
  '(EDITAR) editar só o valor não apagou o título');

-- ===========================================================================
-- (FECHAR) perdido com motivo
-- ===========================================================================
SELECT is(
  (SELECT (public.api_update_deal(
     'deadbeef-0000-4000-8000-00000000ba01',
     'deadbeef-0000-4000-8000-00000000bd02',
     p_status => 'lost', p_loss_reason => 'Preço'))->>'loss_reason'),
  'Preço',
  '(FECHAR) motivo da perda é registrado');

SELECT ok(
  (SELECT closed_at IS NOT NULL AND won IS FALSE
     FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000bd02'),
  '(FECHAR) o Negócio fica fechado e não-ganho — o funil não fica inflado de venda morta');

-- ===========================================================================
-- (A GUARDA) reabrir é recusado
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.api_update_deal(
       'deadbeef-0000-4000-8000-00000000ba01',
       'deadbeef-0000-4000-8000-00000000bd02',
       p_status => 'open') $$,
  '23514', NULL,
  '(GUARDA) Negócio fechado NÃO reabre — sair do ganho dispara sale_reversed, irreversível');

-- CONTROLE: e um Negócio ABERTO aceita ser marcado como ganho. Sem isto, uma
-- implementação que recusasse toda mudança de situação passaria na asserção
-- acima e ninguém perceberia.
SELECT is(
  (SELECT (public.api_update_deal(
     'deadbeef-0000-4000-8000-00000000ba01',
     'deadbeef-0000-4000-8000-00000000bd01',
     p_status => 'won'))->>'won'),
  'true',
  '(CONTROLE) Negócio aberto ACEITA ser marcado como ganho — a guarda não recusa tudo');

-- ===========================================================================
-- (TENANT)
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT public.api_update_deal(
       'deadbeef-0000-4000-8000-00000000ba01',
       'deadbeef-0000-4000-8000-00000000bd03',
       p_title => 'invadido') $$,
  'P0002', NULL,
  '(TENANT) editar Negócio de outra organização é recusado como inexistente');

SELECT is(
  (SELECT title FROM public.deals WHERE id = 'deadbeef-0000-4000-8000-00000000bd03'),
  'Alheio',
  '(TENANT) e o Negócio alheio segue intacto — a recusa não foi só de mensagem');

SELECT throws_ok(
  $$ SELECT public.api_update_deal(
       'deadbeef-0000-4000-8000-00000000ba01',
       'deadbeef-0000-4000-8000-00000000bd01',
       p_owner_id => 'deadbeef-0000-4000-8000-00000000bfff') $$,
  '23514', NULL,
  '(TENANT) dono que não é da organização é recusado');

-- ===========================================================================
-- (LISTA POR LEAD)
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.api_list_lead_deals(
     'deadbeef-0000-4000-8000-00000000ba01', 'deadbeef-0000-4000-8000-00000000ba0a')),
  2::bigint,
  '(LISTA) traz os dois Negócios do Lead nesta org — abertos e fechados');

-- O Negócio da org B aponta para o MESMO lead. A lista da org A não pode vê-lo.
SELECT is(
  (SELECT count(*) FROM public.api_list_lead_deals(
     'deadbeef-0000-4000-8000-00000000ba02', 'deadbeef-0000-4000-8000-00000000ba0a')),
  1::bigint,
  '(TENANT) a lista da org B traz só o dela, com o mesmo lead_id apontado');

ROLLBACK;
