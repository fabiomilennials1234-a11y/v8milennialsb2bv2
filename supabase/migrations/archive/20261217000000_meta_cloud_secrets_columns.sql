-- ============================================================
-- Migration: Meta Cloud credential columns + RPCs
-- Date: 2026-11-25
-- Branch: feat/meta-cloud-api
-- NOTE: re-timestamped 20261125000000 → 20261217000000. The original version
--   collided with an existing migration (20261125000000_deleted_leads_log) that
--   was already applied, so `db push` SKIPPED this file and the schema never
--   landed in prod. New version sits after the latest migration to apply cleanly.
-- Cert: docs/meta-cloud-cert/CERTIFICATION.md — Rule 9 (credentials fail-closed
--       and isolated).
-- Description:
--   Adds Meta WhatsApp Cloud API credentials to whatsapp_instance_secrets — the
--   SAME RLS deny-all table that already isolates uazapi_token. The system-user /
--   WABA access token MUST live here (service_role-only via RPC), NEVER in a
--   selectable column or provider_config JSONB (any org member could SELECT those).
--
--   - meta_waba_id / meta_phone_number_id / meta_access_token: nullable, set only
--     for provider='meta_cloud' instances (provisioned by Embedded Signup, later slice).
--   - uazapi_token relaxed to NULLABLE: a Meta instance has no Uazapi token; the
--     new CHECK guarantees each secrets row carries at least one provider credential.
--   - get/set_meta_cloud_credentials: SECURITY DEFINER, service_role ONLY,
--     mirroring get/set_uazapi_credentials.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.get_meta_cloud_credentials(UUID);
--   ALTER TABLE public.whatsapp_instance_secrets
--     DROP CONSTRAINT IF EXISTS chk_secrets_has_credential,
--     DROP COLUMN IF EXISTS meta_access_token,
--     DROP COLUMN IF EXISTS meta_phone_number_id,
--     DROP COLUMN IF EXISTS meta_waba_id;
--   -- NOTE: re-adding NOT NULL on uazapi_token requires no meta rows to exist.
-- ============================================================

-- ============================================================
-- 1. Colunas Meta Cloud (nullable) + relaxar uazapi_token
-- ============================================================

ALTER TABLE public.whatsapp_instance_secrets
  ADD COLUMN IF NOT EXISTS meta_waba_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_phone_number_id  TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token     TEXT;

-- Meta instances carry no uazapi_token. Existing rows all have it → safe.
ALTER TABLE public.whatsapp_instance_secrets
  ALTER COLUMN uazapi_token DROP NOT NULL;

-- Invariant: every secrets row holds at least one provider credential.
-- Existing rows all have uazapi_token → CHECK validates immediately.
ALTER TABLE public.whatsapp_instance_secrets
  ADD CONSTRAINT chk_secrets_has_credential
  CHECK (uazapi_token IS NOT NULL OR meta_access_token IS NOT NULL);

COMMENT ON COLUMN public.whatsapp_instance_secrets.meta_waba_id IS
  'Meta WhatsApp Business Account (WABA) id. Set for provider=meta_cloud. service_role only.';
COMMENT ON COLUMN public.whatsapp_instance_secrets.meta_phone_number_id IS
  'Meta Cloud phone_number_id — used to route inbound webhooks to this instance/org. service_role only.';
COMMENT ON COLUMN public.whatsapp_instance_secrets.meta_access_token IS
  'Meta system-user / WABA access token. Sensível — nunca exposto ao cliente.';

-- Inbound webhook routing resolves org by phone_number_id (partial index — only Meta rows).
CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_secrets_meta_phone
  ON public.whatsapp_instance_secrets(meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;

-- ============================================================
-- 2. HELPER RPC: get_meta_cloud_credentials
--    SECURITY DEFINER, service_role only. Mirrors get_uazapi_credentials.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_meta_cloud_credentials(p_instance_id UUID)
RETURNS TABLE(
  meta_waba_id         TEXT,
  meta_phone_number_id TEXT,
  meta_access_token    TEXT,
  organization_id      UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.meta_waba_id,
    s.meta_phone_number_id,
    s.meta_access_token,
    s.organization_id
  FROM public.whatsapp_instance_secrets s
  WHERE s.instance_id = p_instance_id;
END;
$$;

COMMENT ON FUNCTION public.get_meta_cloud_credentials(UUID) IS
  'Retorna credenciais Meta Cloud de uma instância. Exclusivo service_role. '
  'SECURITY DEFINER — não expõe a tabela whatsapp_instance_secrets diretamente.';

REVOKE EXECUTE ON FUNCTION public.get_meta_cloud_credentials(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_meta_cloud_credentials(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_meta_cloud_credentials(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_meta_cloud_credentials(UUID) TO service_role;

-- ============================================================
-- 3. HELPER RPC: set_meta_cloud_credentials
--    Upsert. SECURITY DEFINER, service_role only. Optional fields preserved
--    via COALESCE if not provided.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_meta_cloud_credentials(
  p_instance_id         UUID,
  p_organization_id     UUID,
  p_meta_waba_id        TEXT,
  p_meta_phone_number_id TEXT,
  p_meta_access_token   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.whatsapp_instance_secrets(
    instance_id,
    organization_id,
    meta_waba_id,
    meta_phone_number_id,
    meta_access_token
  )
  VALUES (
    p_instance_id,
    p_organization_id,
    p_meta_waba_id,
    p_meta_phone_number_id,
    p_meta_access_token
  )
  ON CONFLICT (instance_id) DO UPDATE
    SET meta_waba_id         = COALESCE(EXCLUDED.meta_waba_id, whatsapp_instance_secrets.meta_waba_id),
        meta_phone_number_id = COALESCE(EXCLUDED.meta_phone_number_id, whatsapp_instance_secrets.meta_phone_number_id),
        meta_access_token    = COALESCE(EXCLUDED.meta_access_token, whatsapp_instance_secrets.meta_access_token),
        updated_at           = now();
END;
$$;

COMMENT ON FUNCTION public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT) IS
  'Upsert de credenciais Meta Cloud para uma instância. Exclusivo service_role. '
  'Preserva campos existentes se não fornecidos (COALESCE).';

REVOKE EXECUTE ON FUNCTION public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_meta_cloud_credentials(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
