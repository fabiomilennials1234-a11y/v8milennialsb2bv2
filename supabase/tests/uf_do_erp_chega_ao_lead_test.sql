-- uf_do_erp_chega_ao_lead_test.sql
--
-- 20280111000600_uf_do_erp_chega_ao_lead.sql: a UF do ERP (upsell_clients.
-- erp_uf) chega ao lead quando a dele está vazia ou veio do DDD/ERP, e nunca
-- passa por cima do que alguém disse (manual/webhook/ai) nem de UF sem
-- procedência. 'EX' (exterior) é ignorado; lead de outra org nunca é tocado.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('1f0e0001-aaaa-4000-8000-000000000a01', 'Org A (uf erp)', 'org-a-uf-erp', 'America/Sao_Paulo'),
  ('1f0e0001-bbbb-4000-8000-000000000b01', 'Org B (uf erp)', 'org-b-uf-erp', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, uf, uf_source, phone)
VALUES
  ('1f0e0002-0000-4000-8000-000000000001', '1f0e0001-aaaa-4000-8000-000000000a01', 'Sem UF',       NULL, NULL,      NULL),
  ('1f0e0002-0000-4000-8000-000000000002', '1f0e0001-aaaa-4000-8000-000000000a01', 'DDD errado',   'RS', 'ddd',     NULL),
  ('1f0e0002-0000-4000-8000-000000000003', '1f0e0001-aaaa-4000-8000-000000000a01', 'Manual',       'PR', 'manual',  NULL),
  ('1f0e0002-0000-4000-8000-000000000004', '1f0e0001-aaaa-4000-8000-000000000a01', 'Webhook',      'MG', 'webhook', NULL),
  ('1f0e0002-0000-4000-8000-000000000005', '1f0e0001-aaaa-4000-8000-000000000a01', 'IA',           'GO', 'ai',      NULL),
  ('1f0e0002-0000-4000-8000-000000000006', '1f0e0001-aaaa-4000-8000-000000000a01', 'Já do ERP',    'SC', 'erp',     NULL),
  ('1f0e0002-0000-4000-8000-000000000007', '1f0e0001-aaaa-4000-8000-000000000a01', 'Exterior',     NULL, NULL,      NULL),
  ('1f0e0002-0000-4000-8000-000000000008', '1f0e0001-aaaa-4000-8000-000000000a01', 'Sem origem',   'BA', NULL,      NULL),
  ('1f0e0002-0000-4000-8000-000000000009', '1f0e0001-aaaa-4000-8000-000000000a01', 'Troca fone',   NULL, NULL,      NULL),
  ('1f0e0002-0000-4000-8000-0000000000b1', '1f0e0001-bbbb-4000-8000-000000000b01', 'Lead da B',    NULL, NULL,      NULL)
ON CONFLICT (id) DO NOTHING;

-- A partir daqui, triggers ligados: é o que se testa.
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.estado(p_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(uf::text, '∅') || '/' || coalesce(uf_source, '∅') FROM public.leads WHERE id = p_lead
$$;

-- ── uf_brasileira ─────────────────────────────────────────────────────────
SELECT is(public.uf_brasileira(' sc '), 'SC'::char(2), 'U1: normaliza (maiúscula, sem espaço)');
SELECT is(public.uf_brasileira('EX'), NULL::char(2), 'U2: EX (exterior) não é UF');
SELECT is(public.uf_brasileira(''), NULL::char(2), 'U3: vazio não é UF');

-- ── A Carteira recebe a UF do ERP ─────────────────────────────────────────
INSERT INTO public.upsell_clients (organization_id, lead_id, name, erp_uf)
VALUES
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000001', 'C1', ' sc '),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000002', 'C2', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000003', 'C3', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000004', 'C4', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000005', 'C5', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000006', 'C6', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000007', 'C7', 'EX'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000008', 'C8', 'SC'),
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-000000000009', 'C9', 'SC'),
  -- Cliente da org A apontando para um lead da org B: nunca pode tocá-lo.
  ('1f0e0001-aaaa-4000-8000-000000000a01', '1f0e0002-0000-4000-8000-0000000000b1', 'CX', 'SC');

SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000001'), 'SC/erp', 'T1: lead sem UF recebe a do ERP');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000002'), 'SC/erp', 'T2: palpite do DDD em outro estado vira o do ERP (o caso dos 611)');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000003'), 'PR/manual', 'T3: UF digitada (manual) fica');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000004'), 'MG/webhook', 'T4: UF do webhook fica');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000005'), 'GO/ai', 'T5: UF que a IA ouviu do lead fica');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000007'), '∅/∅', 'T6: EX (exterior) não vai para o lead');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000008'), 'BA/∅', 'T7: UF sem procedência conhecida fica (pode ter sido digitada)');
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-0000000000b1'), '∅/∅', 'T8: lead de OUTRA org nunca é tocado');

-- O cadastro do ERP mudou: o lead acompanha.
UPDATE public.upsell_clients SET erp_uf = 'PR' WHERE lead_id = '1f0e0002-0000-4000-8000-000000000006';
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000006'), 'PR/erp', 'T9: mudança no ERP chega ao lead que já era do ERP');

-- Trocar o telefone depois não devolve a UF ao palpite do DDD.
UPDATE public.leads SET phone = '+55 11 98765-4321' WHERE id = '1f0e0002-0000-4000-8000-000000000009';
SELECT is(pg_temp.estado('1f0e0002-0000-4000-8000-000000000009'), 'SC/erp', 'T10: telefone novo (DDD 11) não troca a UF do ERP');

-- ── Contrato ──────────────────────────────────────────────────────────────
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.upsell_clients_uf_para_lead()'::regprocedure),
  'S1: a função do trigger é SECURITY INVOKER');
SELECT ok(NOT has_function_privilege('authenticated', 'public.upsell_clients_uf_para_lead()', 'EXECUTE'),
  'S2: ninguém chama a função do trigger direto');
SELECT ok(position('AFTER INSERT OR DELETE OR UPDATE OF erp_uf, lead_id, organization_id ON public.upsell_clients'
                   IN pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'trg_upsell_clients_uf_para_lead'))) > 0,
  'S3: dispara só quando a UF do ERP ou o vínculo (lead, org) mudam, e quando o cliente é apagado (20280111000900)');

SELECT * FROM finish();
ROLLBACK;
