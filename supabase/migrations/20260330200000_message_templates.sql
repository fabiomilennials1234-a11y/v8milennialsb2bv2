-- ================================================================
-- Migration: Message Templates
-- Tabela de templates de mensagem com slash commands por org.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. Tabela message_templates
-- ============================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command          TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  media_url        TEXT,
  media_type       TEXT        DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'video', 'audio', 'document')),
  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT message_templates_command_format
    CHECK (command ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT message_templates_unique_command
    UNIQUE (organization_id, command)
);

COMMENT ON TABLE public.message_templates IS 'Templates de mensagem com slash commands por organização';
COMMENT ON COLUMN public.message_templates.command IS 'Slug do comando sem / (ex: saudacao). Lowercase, números, hifens.';
COMMENT ON COLUMN public.message_templates.body IS 'Corpo da mensagem com variáveis {nome}, {empresa}, etc.';

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.message_templates_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER set_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.message_templates_updated_at();

CREATE INDEX IF NOT EXISTS idx_message_templates_org
  ON public.message_templates (organization_id);

-- ============================================
-- 2. RLS
-- ============================================

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ver todos os templates
CREATE POLICY "message_templates_select_org"
  ON public.message_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem criar templates
CREATE POLICY "message_templates_insert_org"
  ON public.message_templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem editar templates
CREATE POLICY "message_templates_update_org"
  ON public.message_templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem deletar templates
CREATE POLICY "message_templates_delete_org"
  ON public.message_templates FOR DELETE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- ============================================
-- 3. Feature flag
-- ============================================

INSERT INTO public.feature_flags (key, name, description, category, default_enabled)
VALUES (
  'message_templates',
  'Templates de Mensagem',
  'Templates de mensagem com slash commands no chat',
  'modules',
  false
)
ON CONFLICT (key) DO NOTHING;

-- Habilitar nos planos Torque 2.0 e V8
UPDATE public.subscription_plans
SET features = features || '{"message_templates": true}'::JSONB
WHERE name IN ('torque-2.0', 'torque-v8');

-- Manter desabilitado no Torque 1.0
UPDATE public.subscription_plans
SET features = features || '{"message_templates": false}'::JSONB
WHERE name = 'torque-1.0';
