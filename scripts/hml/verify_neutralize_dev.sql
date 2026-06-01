-- verify_neutralize_dev.sql — ONE-OFF, NON-DESTRUCTIVE verification of
-- neutralize_hml.sql against a real (dev) Supabase schema.
--
-- Everything runs inside a single transaction that ROLLS BACK at the end:
-- the database state is left UNTOUCHED. Safe to run against dev. NEVER prod.
--
-- Usage:
--   psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f scripts/hml/verify_neutralize_dev.sql
-- A clean exit (code 0) with "VERIFY OK" means neutralize works on this schema.
-- Any failed assertion RAISEs and aborts the transaction (nothing persists).

\set ON_ERROR_STOP on
BEGIN;

-- Seed live rows under REAL dev FK parents, then run neutralize, then assert.
DO $$
DECLARE
  v_org      uuid;
  v_user     uuid;
  v_instance uuid;
  n          int;
  leaked     int;
BEGIN
  SELECT id INTO v_org  FROM public.organizations LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no organization in target DB'; END IF;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'no auth.users in target DB'; END IF;

  -- live rows the neutralize must clear / flip
  INSERT INTO public.whatsapp_instances (instance_name, organization_id)
    VALUES ('hml-verify', v_org) RETURNING id INTO v_instance;
  INSERT INTO public.whatsapp_instance_secrets (instance_id, organization_id, uazapi_token)
    VALUES (v_instance, v_org, 'tok-verify');
  INSERT INTO public.copilot_agents (created_by, main_objective, name, organization_id, is_active)
    VALUES (v_user, 'verify', 'hml-verify-agent', v_org, true);
  INSERT INTO public.cron_config (key, value)
    VALUES ('hml_verify_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/x')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;

-- Run the real artifact under test.
\i scripts/hml/neutralize_hml.sql

-- Assert every vector was severed.
DO $$
DECLARE
  n      int;
  leaked int;
  agent_active int;
BEGIN
  SELECT count(*) INTO n FROM public.whatsapp_instance_secrets;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL layer2: whatsapp_instance_secrets not empty (%).', n; END IF;

  SELECT count(*) INTO leaked FROM public.cron_config WHERE value LIKE '%jsjsmuncfkbsbzqzqhfq%';
  IF leaked <> 0 THEN RAISE EXCEPTION 'FAIL layer3: cron_config still has prod URL (%).', leaked; END IF;

  SELECT count(*) INTO agent_active FROM public.copilot_agents WHERE is_active;
  IF agent_active <> 0 THEN RAISE EXCEPTION 'FAIL layer4: % copilot_agents still active.', agent_active; END IF;

  RAISE NOTICE 'VERIFY OK — all checked outbound vectors severed.';
END $$;

ROLLBACK;
