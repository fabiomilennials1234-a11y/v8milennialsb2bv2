-- ISOLATED TEST DATABASE ONLY. Never run on a populated Supabase project.
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE public.cron_config (key text PRIMARY KEY, value text);
INSERT INTO public.cron_config VALUES
  ('cron_secret', 'fixture-secret'),
  ('supabase_anon_key', 'fixture-anon'),
  ('process_ai_actions_url', 'https://fixture.invalid/functions/v1/process-ai-actions'),
  ('process_scheduled_user_messages_url', 'https://fixture.invalid/functions/v1/process-scheduled-user-messages'),
  ('campaign_rule_dispatch_url', 'https://fixture.invalid/functions/v1/campaign-rule-dispatch');
CREATE TABLE public.pending_ai_actions (status text, next_retry_at timestamptz, updated_at timestamptz);
CREATE TABLE public.scheduled_user_messages (status text, scheduled_at timestamptz);
CREATE TABLE public.history_sync_jobs (status text, scope text, updated_at timestamptz);
CREATE TABLE public.copilot_v2_message_queue (status text, next_retry_at timestamptz);
CREATE TABLE public.uazapi_sender_jobs (status text);
CREATE TABLE public.whatsapp_media_jobs (resolved_at timestamptz, attempts integer);
CREATE TABLE public.whatsapp_webhook_dlq (resolved_at timestamptz, attempts integer);
-- The existing canonical push RPC owns access/presence/preferences checks.
-- This fixture controls its RESULT, ensuring the dispatcher delegates to it.
CREATE TABLE public.fixture_push_eligible (aviso_id uuid);
CREATE FUNCTION public.fn_avisos_pendentes_de_push(p_limite integer DEFAULT 200)
RETURNS TABLE(aviso_id uuid) LANGUAGE sql STABLE AS $$
  SELECT aviso_id FROM public.fixture_push_eligible LIMIT p_limite
$$;
CREATE TABLE public.fixture_http_calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
-- In a disposable Supabase preview this replaces pg_net's entry point inside
-- the test transaction. No request is enqueued, including hardcoded URLs.
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_http_calls VALUES (url, headers, body, timeout_milliseconds);
  RETURN 1;
END;
$$;
-- Emulate Supabase defaults: revoking PUBLIC alone is insufficient.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
