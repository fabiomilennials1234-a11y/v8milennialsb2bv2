-- Sprint 3 S3.1 — organizations: whatsapp_provider_override + migration_status
--
-- Enables kill-switch panic button (override) and migration workflow tracking
-- for the Evolution→Uazapi rollout across 30 prod orgs.
--
-- Rollback:
-- ALTER TABLE public.organizations
--   DROP COLUMN IF EXISTS whatsapp_provider_override,
--   DROP COLUMN IF EXISTS whatsapp_migration_status,
--   DROP COLUMN IF EXISTS whatsapp_migration_completed_at;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS whatsapp_provider_override TEXT
    CHECK (whatsapp_provider_override IS NULL OR whatsapp_provider_override IN ('uazapi','evolution')),
  ADD COLUMN IF NOT EXISTS whatsapp_migration_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (whatsapp_migration_status IN ('not_started','pending','in_progress','migrated','failed')),
  ADD COLUMN IF NOT EXISTS whatsapp_migration_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.whatsapp_provider_override IS
  'Override do provider WhatsApp (panic switch). NULL = usa whatsapp_instances.provider.';
COMMENT ON COLUMN public.organizations.whatsapp_migration_status IS
  'Status migração Evolution→Uazapi: not_started | pending | in_progress | migrated | failed.';
COMMENT ON COLUMN public.organizations.whatsapp_migration_completed_at IS
  'Timestamp de conclusão da migração. Usado em auditoria + admin dashboard.';
