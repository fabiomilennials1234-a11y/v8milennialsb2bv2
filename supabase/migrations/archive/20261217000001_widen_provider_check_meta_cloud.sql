-- ============================================================
-- Migration: widen whatsapp_instances.provider CHECK → include 'meta_cloud'
-- Date: 2026-11-25
-- Branch: feat/meta-cloud-api
-- NOTE: re-timestamped 20261125000001 → 20261217000001. The original version
--   collided with an existing migration (20261125000001_metrics_rpcs_meeting_events)
--   already applied, so `db push` SKIPPED this file. New version applies cleanly
--   after the latest migration; the DO-block replaces the current provider CHECK
--   regardless of position.
-- Cert: docs/meta-cloud-cert/CERTIFICATION.md — Rule 15 (named DROP/ADD; APPLY
--       only AFTER the meta_cloud-aware code is deployed in every edge bundle
--       that calls getWhatsAppProvider).
--
-- ⚠️ SEQUENCING — DEPLOY GATE:
--   This migration is the ENABLING gate: it makes provider='meta_cloud' rows
--   INSERTABLE. It must land in prod ONLY after the isolation code is live:
--     - _shared/whatsapp-dispatch.ts resolveInstance provider-scope (Rule 1)
--     - getWhatsAppProvider meta_cloud branch + MetaCloudProvider (Rules 3-5)
--     - the 11 inline dispatch resolvers (Rule 2)
--   Nothing creates meta_cloud rows yet (Embedded Signup = later slice), so this
--   is inert on its own — but order still matters for safety.
--
--   Deliberately does NOT touch organizations.whatsapp_provider_override
--   (Rule 5): that org-wide kill-switch stays ('uazapi','evolution') and the
--   factory ignores it for meta_cloud instances.
--
-- ROLLBACK (only valid if NO meta_cloud rows exist):
--   ALTER TABLE public.whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;
--   ALTER TABLE public.whatsapp_instances
--     ADD CONSTRAINT whatsapp_instances_provider_check CHECK (provider IN ('evolution','uazapi'));
-- ============================================================

-- 1. Drop the existing provider CHECK regardless of its (auto-generated) name.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_instances'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%provider%'
      AND pg_get_constraintdef(oid) ILIKE '%uazapi%'
  LOOP
    EXECUTE format('ALTER TABLE public.whatsapp_instances DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 2. Add the widened, explicitly-named constraint.
ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;

ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_check
  CHECK (provider IN ('evolution', 'uazapi', 'meta_cloud'));

COMMENT ON COLUMN public.whatsapp_instances.provider IS
  'Provedor da instância WhatsApp: evolution (legado), uazapi (atual) ou '
  'meta_cloud (API oficial Meta, conexão via Embedded Signup).';
