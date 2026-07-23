-- 20261128000004_meta_app_config.sql
-- Meta agency integration (ADR-0009). APPLIED TO PROD 2026-06-15.
-- Deny-all config table holding the Torque Meta token + business id. Mirrors
-- the whatsapp_instance_secrets pattern: no RLS policies, no grants to
-- anon/authenticated -> only service_role (edge functions) can read.
--
-- The single config row (system_user_token, business_id) is inserted/rotated
-- out-of-band via a privileged channel — NEVER committed here, so no live
-- credential lands in git. See meta_app_config in prod for the live value.

CREATE TABLE public.meta_app_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),  -- single-row guard
  system_user_token text NOT NULL,
  business_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_app_config ENABLE ROW LEVEL SECURITY;
-- No policies, no grants -> service_role only (fail-closed).
