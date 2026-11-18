-- supabase/tests/sync_dono_lead_entradas_custom_test.sql
--
-- Incidente 2026-11-17: repasse de lead não tirava o lead da
-- tela do dono antigo, porque a entrada em funil CUSTOM seguia apontando pra
-- ele e a RLS de leads lê pipeline_entries.assigned_to / metadata.
--
-- A asserção que carrega esta suíte: depois de repassar o lead, NENHUMA
-- referência ao dono antigo sobra na entrada custom — e a entrada que nasceu
-- sem dono continua sem dono (não cria visibilidade nova).
--
-- Run: bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_owner_from_lead_to_custom_entries'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0::bigint,
  '(ACL) nem anon nem authenticated executam a função da trigger');

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000da01', 'Org Sync Dono', 'org-sync-dono', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, name, role, is_active) VALUES
  ('deadbeef-0000-4000-8000-00000000da11', 'deadbeef-0000-4000-8000-00000000da01', 'Antiga', 'member', true),
  ('deadbeef-0000-4000-8000-00000000da12', 'deadbeef-0000-4000-8000-00000000da01', 'Nova',   'member', true);

INSERT INTO public.leads (id, organization_id, name, responsible_id, sdr_id) VALUES
  ('deadbeef-0000-4000-8000-00000000da0a', 'deadbeef-0000-4000-8000-00000000da01', 'Lead com dono herdado',     'deadbeef-0000-4000-8000-00000000da11', 'deadbeef-0000-4000-8000-00000000da11'),
  ('deadbeef-0000-4000-8000-00000000da0b', 'deadbeef-0000-4000-8000-00000000da01', 'Lead sem dono na entrada',  'deadbeef-0000-4000-8000-00000000da11', 'deadbeef-0000-4000-8000-00000000da11'),
  ('deadbeef-0000-4000-8000-00000000da0c', 'deadbeef-0000-4000-8000-00000000da01', 'Lead em funil de sistema',  'deadbeef-0000-4000-8000-00000000da11', 'deadbeef-0000-4000-8000-00000000da11');

INSERT INTO public.pipelines (id, organization_id, name, slug, type) VALUES
  ('deadbeef-0000-4000-8000-00000000da21', 'deadbeef-0000-4000-8000-00000000da01', 'Funil Custom', 'funil-custom', 'custom'),
  ('deadbeef-0000-4000-8000-00000000da22', 'deadbeef-0000-4000-8000-00000000da01', 'Qualificação', 'whatsapp',     'system');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, assigned_to, metadata) VALUES
  ('deadbeef-0000-4000-8000-00000000da31', 'deadbeef-0000-4000-8000-00000000da01', 'deadbeef-0000-4000-8000-00000000da21', 'deadbeef-0000-4000-8000-00000000da0a', 'novo',
   'deadbeef-0000-4000-8000-00000000da11',
   '{"sdr_id":"deadbeef-0000-4000-8000-00000000da11","responsible_id":"deadbeef-0000-4000-8000-00000000da11","sale_responsible_id":"deadbeef-0000-4000-8000-00000000da11","meeting_date":"2026-02-08T13:32:00+00:00"}'::jsonb),
  ('deadbeef-0000-4000-8000-00000000da32', 'deadbeef-0000-4000-8000-00000000da01', 'deadbeef-0000-4000-8000-00000000da21', 'deadbeef-0000-4000-8000-00000000da0b', 'novo', NULL, '{}'::jsonb),
  ('deadbeef-0000-4000-8000-00000000da33', 'deadbeef-0000-4000-8000-00000000da01', 'deadbeef-0000-4000-8000-00000000da22', 'deadbeef-0000-4000-8000-00000000da0c', 'novo', NULL, '{}'::jsonb);

SET LOCAL session_replication_role = origin;

-- Repasse dos três leads: Antiga -> Nova. O primeiro também zera o closer de venda.
UPDATE public.leads
   SET responsible_id = 'deadbeef-0000-4000-8000-00000000da12',
       sdr_id         = 'deadbeef-0000-4000-8000-00000000da12',
       sale_responsible_id = NULL
 WHERE id IN ('deadbeef-0000-4000-8000-00000000da0a',
              'deadbeef-0000-4000-8000-00000000da0b',
              'deadbeef-0000-4000-8000-00000000da0c');

-- ===========================================================================
-- (HERDADO) a entrada custom não guarda mais o dono antigo em lugar nenhum
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE id = 'deadbeef-0000-4000-8000-00000000da31'
      AND (assigned_to = 'deadbeef-0000-4000-8000-00000000da11'
        OR metadata::text LIKE '%da11%')),
  0::bigint,
  '(HERDADO) nenhuma referência ao dono antigo sobra na entrada custom');

SELECT is(
  (SELECT assigned_to FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000da31'),
  'deadbeef-0000-4000-8000-00000000da12'::uuid,
  '(HERDADO) assigned_to vai pro novo responsável');

SELECT is(
  (SELECT metadata->>'sdr_id' FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000da31'),
  'deadbeef-0000-4000-8000-00000000da12',
  '(HERDADO) metadata.sdr_id espelha o lead');

-- Outra trigger de leads recalcula sale_responsible_id quando o responsável
-- muda; a entrada tem de espelhar o estado FINAL do lead, qualquer que seja.
SELECT is(
  (SELECT pe.metadata->'sale_responsible_id' IS NOT DISTINCT FROM to_jsonb(l.sale_responsible_id)
     FROM public.pipeline_entries pe JOIN public.leads l ON l.id = pe.lead_id
    WHERE pe.id = 'deadbeef-0000-4000-8000-00000000da31'),
  true,
  '(HERDADO) metadata.sale_responsible_id espelha o estado final do lead');

SELECT is(
  (SELECT metadata->>'meeting_date' FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000da31'),
  '2026-02-08T13:32:00+00:00',
  '(HERDADO) o resto do metadata fica intacto');

-- ===========================================================================
-- (SEM DONO) entrada que nasceu vazia continua vazia
-- ===========================================================================
SELECT is(
  (SELECT assigned_to IS NULL AND metadata = '{}'::jsonb
     FROM public.pipeline_entries WHERE id = 'deadbeef-0000-4000-8000-00000000da32'),
  true,
  '(SEM DONO) entrada custom sem dono não ganha dono nem visibilidade nova');

-- ===========================================================================
-- (SISTEMA) funil de sistema é da trigger antiga (sync_responsible_from_lead_
-- to_pipes); esta não duplica o trabalho nele. O lead 0c só existe para
-- provar que o repasse com uma entrada system não quebra nada.
-- ===========================================================================
SELECT is(
  (SELECT count(*) FROM public.pipeline_entries
    WHERE id = 'deadbeef-0000-4000-8000-00000000da33'
      AND assigned_to = 'deadbeef-0000-4000-8000-00000000da11'),
  0::bigint,
  '(SISTEMA) repasse com entrada system não deixa o dono antigo');

SELECT * FROM finish();
ROLLBACK;
