-- uf_do_erp_acompanha_o_vinculo_test.sql
--
-- 20280111000900_uf_do_erp_acompanha_o_vinculo.sql: a UF que o ERP deu ao lead
-- sai dele quando deixa de valer — o ERP limpa a UF (NULL/EX), o cliente muda
-- de lead ou de org, ou é apagado — e o lead volta ao palpite do DDD, inclusive
-- na lixeira (restaurado, não volta preso). Nunca apaga o que alguém digitou
-- depois, UF que não foi esse cliente que deu, lead de outra org, nem UF que
-- outro cliente da org ainda sustenta.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(19);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('1f0e0003-aaaa-4000-8000-000000000a01', 'Org A (uf vínculo)', 'org-a-uf-vinculo', 'America/Sao_Paulo'),
  ('1f0e0003-bbbb-4000-8000-000000000b01', 'Org B (uf vínculo)', 'org-b-uf-vinculo', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

-- Telefone com DDD onde o teste precisa ver o palpite voltar (11 = SP, 41 = PR);
-- sem telefone onde precisa ver a UF sumir.
INSERT INTO public.leads (id, organization_id, name, uf, uf_source, phone, deleted_at)
VALUES
  ('1f0e0004-0000-4000-8000-000000000001', '1f0e0003-aaaa-4000-8000-000000000a01', 'ERP limpou, sem fone',  NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000002', '1f0e0003-aaaa-4000-8000-000000000a01', 'ERP virou EX, DDD 11',  NULL, NULL,     '+55 11 98765-0002', NULL),
  ('1f0e0004-0000-4000-8000-000000000003', '1f0e0003-aaaa-4000-8000-000000000a01', 'Digitou depois',        NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000004', '1f0e0003-aaaa-4000-8000-000000000a01', 'UF erp de outro',       NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000005', '1f0e0003-aaaa-4000-8000-000000000a01', 'Re-vínculo: antigo',    NULL, NULL,     '+55 41 99876-0005', NULL),
  ('1f0e0004-0000-4000-8000-000000000006', '1f0e0003-aaaa-4000-8000-000000000a01', 'Re-vínculo: novo',      NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000007', '1f0e0003-aaaa-4000-8000-000000000a01', 'Apagado, DDD 11',       NULL, NULL,     '+55 11 91234-0007', NULL),
  ('1f0e0004-0000-4000-8000-000000000008', '1f0e0003-aaaa-4000-8000-000000000a01', 'Apagado, manual',       'PR', 'manual', NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000009', '1f0e0003-aaaa-4000-8000-000000000a01', 'Na lixeira',            NULL, NULL,     NULL,                now()),
  ('1f0e0004-0000-4000-8000-000000000010', '1f0e0003-aaaa-4000-8000-000000000a01', 'Troca de UF',           NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000011', '1f0e0003-aaaa-4000-8000-000000000a01', 'Recriado',              NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000012', '1f0e0003-aaaa-4000-8000-000000000a01', 'Cliente muda de org',   NULL, NULL,     NULL,                NULL),
  ('1f0e0004-0000-4000-8000-000000000013', '1f0e0003-aaaa-4000-8000-000000000a01', 'Lixeira, DDD 21',       NULL, NULL,     '+55 21 99876-0013', now()),
  -- Lead da org B com a UF que o cliente DELA deu.
  ('1f0e0004-0000-4000-8000-0000000000b1', '1f0e0003-bbbb-4000-8000-000000000b01', 'Lead da B',             'SC', 'erp',    NULL,                NULL)
ON CONFLICT (id) DO NOTHING;

-- A partir daqui, triggers ligados: é o que se testa.
SET LOCAL session_replication_role = origin;

CREATE OR REPLACE FUNCTION pg_temp.estado(p_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(uf::text, '∅') || '/' || coalesce(uf_source, '∅') FROM public.leads WHERE id = p_lead
$$;

-- Quantas linhas de leads um comando reescreveu (contador da própria transação).
CREATE OR REPLACE FUNCTION pg_temp.updates_em_leads(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_antes bigint;
BEGIN
  SELECT coalesce(max(n_tup_upd), 0) INTO v_antes FROM pg_stat_xact_user_tables WHERE relid = 'public.leads'::regclass;
  EXECUTE p_sql;
  RETURN (SELECT coalesce(max(n_tup_upd), 0) FROM pg_stat_xact_user_tables WHERE relid = 'public.leads'::regclass) - v_antes;
END;
$$;

-- Todo lead começa com a UF que o ERP deu (20280111000600 em ação).
INSERT INTO public.upsell_clients (id, organization_id, lead_id, name, erp_uf)
VALUES
  ('1f0e0005-0000-4000-8000-000000000001', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000001', 'C01', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000002', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000002', 'C02', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000003', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000003', 'C03', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000004', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000004', 'C04', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000005', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000005', 'C05', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000007', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000007', 'C07', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000008', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000008', 'C08', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000009', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000009', 'C09', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000010', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000010', 'C10', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000011', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000011', 'C11', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000012', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000012', 'C12', 'SC'),
  ('1f0e0005-0000-4000-8000-000000000013', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-000000000013', 'C13', 'SC'),
  -- Cliente da org A apontando para o lead da org B: nunca o toca.
  ('1f0e0005-0000-4000-8000-0000000000c1', '1f0e0003-aaaa-4000-8000-000000000a01', '1f0e0004-0000-4000-8000-0000000000b1', 'CX',  'SC');

SELECT is(
  (SELECT string_agg(right(id::text, 2) || '=' || pg_temp.estado(id), ' ' ORDER BY id)
     FROM public.leads WHERE organization_id = '1f0e0003-aaaa-4000-8000-000000000a01'),
  '01=SC/erp 02=SC/erp 03=SC/erp 04=SC/erp 05=SC/erp 06=∅/∅ 07=SC/erp 08=PR/manual 09=SC/erp 10=SC/erp 11=SC/erp 12=SC/erp 13=SC/erp',
  'P1: pré-condição — cada lead com cliente recebeu a UF do ERP, menos o manual');

-- ── O ERP limpa a UF ──────────────────────────────────────────────────────
UPDATE public.upsell_clients SET erp_uf = NULL WHERE id = '1f0e0005-0000-4000-8000-000000000001';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000001'), '∅/∅',
  'T1: ERP limpou a UF (NULL) e o lead não tem DDD: a UF sai');

UPDATE public.upsell_clients SET erp_uf = 'EX' WHERE id = '1f0e0005-0000-4000-8000-000000000002';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000002'), 'SP/ddd',
  'T2: ERP passou a EX: o lead volta ao palpite do DDD');

UPDATE public.leads SET uf = 'PR', uf_source = 'manual' WHERE id = '1f0e0004-0000-4000-8000-000000000003';
UPDATE public.upsell_clients SET erp_uf = NULL WHERE id = '1f0e0005-0000-4000-8000-000000000003';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000003'), 'PR/manual',
  'T3: UF digitada depois do ERP fica quando o ERP limpa');

-- UF marcada 'erp' que não é a que este cliente deu (SC): não é dele desfazer.
UPDATE public.leads SET uf = 'RS' WHERE id = '1f0e0004-0000-4000-8000-000000000004';
UPDATE public.upsell_clients SET erp_uf = NULL WHERE id = '1f0e0005-0000-4000-8000-000000000004';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000004'), 'RS/erp',
  'T4: só sai a UF que o próprio cliente deu');

-- ── O cliente muda de lead (merge_leads) ou de org ────────────────────────
UPDATE public.upsell_clients SET lead_id = '1f0e0004-0000-4000-8000-000000000006'
 WHERE id = '1f0e0005-0000-4000-8000-000000000005';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000005'), 'PR/ddd',
  'T5: re-vínculo — o lead antigo solta a UF do ERP e volta ao DDD');
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000006'), 'SC/erp',
  'T6: re-vínculo — o lead novo recebe a UF do ERP');

UPDATE public.upsell_clients SET organization_id = '1f0e0003-bbbb-4000-8000-000000000b01'
 WHERE id = '1f0e0005-0000-4000-8000-000000000012';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000012'), '∅/∅',
  'T7: cliente foi para outra org — o lead da org antiga solta a UF');

-- ── O cliente é apagado ───────────────────────────────────────────────────
DELETE FROM public.upsell_clients WHERE id = '1f0e0005-0000-4000-8000-000000000007';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000007'), 'SP/ddd',
  'T8: cliente apagado — o lead solta a UF do ERP e volta ao DDD');

DELETE FROM public.upsell_clients WHERE id = '1f0e0005-0000-4000-8000-000000000008';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000008'), 'PR/manual',
  'T9: apagar o cliente nunca mexe em UF manual');

DELETE FROM public.upsell_clients WHERE id = '1f0e0005-0000-4000-8000-000000000009';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000009'), '∅/∅',
  'T10: lead na lixeira também solta — restaurado, não volta preso');

UPDATE public.upsell_clients SET erp_uf = NULL WHERE id = '1f0e0005-0000-4000-8000-000000000013';
UPDATE public.leads SET deleted_at = NULL WHERE id = '1f0e0004-0000-4000-8000-000000000013';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000013'), 'RJ/ddd',
  'L1: ERP limpou com o lead na lixeira — restaurado, volta com o palpite do DDD');

DELETE FROM public.upsell_clients WHERE id = '1f0e0005-0000-4000-8000-0000000000c1';
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-0000000000b1'), 'SC/erp',
  'T11: cliente de OUTRA org apagado nunca toca o lead');

-- ── Uma escrita só quando é preciso ───────────────────────────────────────
SELECT is(
  pg_temp.updates_em_leads($$UPDATE public.upsell_clients SET erp_uf = 'PR' WHERE id = '1f0e0005-0000-4000-8000-000000000010'$$),
  1::bigint,
  'T12: UF trocada no mesmo vínculo é UM update no lead (não zera e regrava)');
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000010'), 'PR/erp',
  'T13: ... e o lead fica com a UF nova');

-- Apagar e recriar o cliente num só comando: o recriado sustenta a UF.
SELECT is(
  pg_temp.updates_em_leads($$
    WITH sai AS (
      DELETE FROM public.upsell_clients WHERE id = '1f0e0005-0000-4000-8000-000000000011'
      RETURNING organization_id, lead_id
    )
    INSERT INTO public.upsell_clients (organization_id, lead_id, name, erp_uf)
    SELECT organization_id, lead_id, 'C11 recriado', 'SC' FROM sai
  $$),
  0::bigint,
  'T14: cliente recriado no mesmo comando — a UF que ele ainda sustenta não sai');
SELECT is(pg_temp.estado('1f0e0004-0000-4000-8000-000000000011'), 'SC/erp',
  'T15: ... e o lead segue com a UF do ERP');

-- ── Contrato ──────────────────────────────────────────────────────────────
SELECT ok(coalesce((SELECT proconfig @> ARRAY['search_path=""']
                      FROM pg_proc WHERE oid = 'public.upsell_clients_uf_para_lead()'::regprocedure), false),
  'S4: a função do trigger roda com search_path vazio');
SELECT ok(EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.upsell_clients'::regclass
       AND c.contype = 'u' AND NOT c.condeferrable
       AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.upsell_clients'::regclass AND attname = 'organization_id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.upsell_clients'::regclass AND attname = 'lead_id')
           ]::int2[]),
  'S5: um cliente por lead na org — a UNIQUE imediata que o trigger pressupõe');

SELECT * FROM finish();
ROLLBACK;
