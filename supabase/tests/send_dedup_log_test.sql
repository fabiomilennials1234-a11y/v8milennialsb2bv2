-- supabase/tests/send_dedup_log_test.sql
--
-- FIX (área frágil — WhatsApp / vetor de ban). Prova que send_dedup_log barra
-- duplicata DE VERDADE, isola por tenant, e que o furo do rate-limit foi
-- FECHADO por remoção (as RPCs mortas NÃO voltaram).
--
-- Diagnóstico: Lanterna. Decisão de desenho: governor é o choke; rate-limit
-- velho removido, não revivido (confirmado vs #1243).
--
-- Run: supabase db reset && bash supabase/tests/run.sh
-- Roda inteiro em transação revertida.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();

-- ===========================================================================
-- (STRUCT) a tabela existe com o contrato que send-dedup.ts espera
-- ===========================================================================
SELECT has_table('public', 'send_dedup_log', '(STRUCT) send_dedup_log existe');
SELECT col_is_pk('public', 'send_dedup_log', 'id', '(STRUCT) PK id');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'send_dedup_log'),
  '(STRUCT) RLS habilitada (policy não fica inerte)');

-- source só aceita o vocabulário fechado que o wrapper usa.
SELECT throws_ok(
  $$ INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
     VALUES (gen_random_uuid(), '5511999', 'h', 'INVALIDO', now() + interval '1h') $$,
  '23514', NULL, '(STRUCT) source fora do vocabulário rejeitado');

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('deadbeef-0000-4000-8000-00000000000a', 'Org dedup A', 'org-dedup-a', 'America/Sao_Paulo'),
  ('deadbeef-0000-4000-8000-00000000000b', 'Org dedup B', 'org-dedup-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = DEFAULT;

-- ===========================================================================
-- (DEDUP) o índice parcial barra duplicata de conteúdo de verdade
-- ===========================================================================
-- 1ª reserva entra.
INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511988887777', 'hash_oi_filipe', 'copilot', now() + interval '1 hour');

-- 2ª reserva IDÊNTICA (mesmo org+phone+hash+source, sem idk): ON CONFLICT DO
-- NOTHING não insere nada — é como o wrapper detecta duplicata (RETURNING vazio).
WITH ins AS (
  INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
  VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511988887777', 'hash_oi_filipe', 'copilot', now() + interval '1 hour')
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 0,
  '(DEDUP) 2ª reserva idêntica é barrada (ON CONFLICT DO NOTHING → 0 linhas) — o "Oi Filipe!" 12× não repete');

-- Conteúdo DIFERENTE passa (não é falso-positivo).
WITH ins AS (
  INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
  VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511988887777', 'hash_outra_msg', 'copilot', now() + interval '1 hour')
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 1, '(DEDUP) conteúdo diferente NÃO é barrado');

-- Mesma org+phone+hash mas SOURCE diferente passa (source faz parte da chave).
WITH ins AS (
  INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
  VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511988887777', 'hash_oi_filipe', 'workflow', now() + interval '1 hour')
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 1, '(DEDUP) source diferente NÃO é barrado (chave inclui source)');

-- ===========================================================================
-- (IDK) idempotency_key: replay com a mesma key é barrado
-- ===========================================================================
INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, idempotency_key, expires_at)
VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511900001111', 'qualquer', 'mass_send', 'idk-abc-123', now() + interval '1 hour');

WITH ins AS (
  INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, idempotency_key, expires_at)
  VALUES ('deadbeef-0000-4000-8000-00000000000a', '5511900002222', 'outro_hash', 'mass_send', 'idk-abc-123', now() + interval '1 hour')
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 0,
  '(IDK) replay com a mesma idempotency_key é barrado, mesmo com phone/hash diferentes');

-- ===========================================================================
-- (XORG) isolamento por tenant — a MESMA reserva em outra org passa
-- ===========================================================================
WITH ins AS (
  INSERT INTO public.send_dedup_log (org_id, phone, content_hash, source, expires_at)
  VALUES ('deadbeef-0000-4000-8000-00000000000b', '5511988887777', 'hash_oi_filipe', 'copilot', now() + interval '1 hour')
  ON CONFLICT DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM ins), 1,
  '(XORG) dedup é por org — a mesma msg em outra org não colide (chave inclui org_id)');

-- ===========================================================================
-- (RLS) isolamento por tenant PROVADO COMO authenticated — não como postgres
-- ===========================================================================
-- Método (lição que já mordeu 3× no épico): superuser bypassa RLS e dá falso
-- verde. A policy só vale se um MEMBRO de A vê as linhas de A e NÃO vê as de B.
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('deadbeef-0000-4000-8000-0000000000f1', 'dedup-user-a@test.local', '', now(), '{}'::jsonb,
   now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('deadbeef-0000-4000-8000-0000000000f2', 'deadbeef-0000-4000-8000-00000000000a',
   'deadbeef-0000-4000-8000-0000000000f1', 'Membro A', 'member', true)
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = DEFAULT;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"deadbeef-0000-4000-8000-0000000000f1","role":"authenticated"}', true);

-- Vê as linhas da própria org (A tem reservas dos testes acima).
SELECT ok(
  (SELECT count(*) FROM public.send_dedup_log
   WHERE org_id = 'deadbeef-0000-4000-8000-00000000000a') > 0,
  '(RLS) membro de A enxerga as reservas da própria org');

-- NÃO vê as linhas da org B (a reserva do teste XORG).
SELECT is(
  (SELECT count(*)::int FROM public.send_dedup_log
   WHERE org_id = 'deadbeef-0000-4000-8000-00000000000b'),
  0, '(RLS) membro de A NÃO enxerga reserva da org B (isolamento por tenant, como authenticated)');

SET LOCAL role postgres;

-- ===========================================================================
-- (CRON) o job de limpeza foi registrado
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'send-dedup-log-cleanup'),
  1, '(CRON) job send-dedup-log-cleanup registrado (purga linhas vencidas)');

-- ===========================================================================
-- (NO-REVIVE) o rate-limit velho NÃO foi revivido (governor é o choke)
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('check_whatsapp_rate_limit', 'increment_whatsapp_rate_limit')),
  0, '(NO-REVIVE) as RPCs de rate-limit velho continuam AUSENTES — não foram ressuscitadas');

SELECT * FROM finish();
ROLLBACK;
