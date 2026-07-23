-- =============================================================================
-- Migration: Central de Ajuda
-- Cria: help_categories, help_articles
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabela help_categories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- null = global
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'HelpCircle',
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(slug, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_help_categories_org ON help_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_help_categories_sort ON help_categories(sort_order);

-- RLS
ALTER TABLE help_categories ENABLE ROW LEVEL SECURITY;

-- Todos podem ler (global ou da sua org)
CREATE POLICY "help_categories_read" ON help_categories
  FOR SELECT USING (
    organization_id IS NULL OR organization_id = public.get_user_organization_id()
  );

-- Apenas admins podem inserir/atualizar/deletar
CREATE POLICY "help_categories_admin_write" ON help_categories
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
    AND public.is_user_admin()
  ) WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND public.is_user_admin()
  );

CREATE POLICY "help_categories_service_role" ON help_categories
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- 2. Tabela help_articles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES help_categories(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- null = global
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL DEFAULT '',
  media JSONB DEFAULT '[]'::jsonb,  -- [{url, type: "image"|"gif", caption}]
  tags TEXT[] DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_help_articles_org ON help_articles(organization_id);
CREATE INDEX IF NOT EXISTS idx_help_articles_published ON help_articles(is_published);
CREATE INDEX IF NOT EXISTS idx_help_articles_sort ON help_articles(sort_order);
CREATE INDEX IF NOT EXISTS idx_help_articles_tags ON help_articles USING GIN(tags);

-- RLS
ALTER TABLE help_articles ENABLE ROW LEVEL SECURITY;

-- Todos podem ler artigos publicados (global ou da sua org)
CREATE POLICY "help_articles_read" ON help_articles
  FOR SELECT USING (
    is_published = true
    AND (organization_id IS NULL OR organization_id = public.get_user_organization_id())
  );

-- Admins podem ler todos (incluindo rascunhos)
CREATE POLICY "help_articles_admin_read" ON help_articles
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND public.is_user_admin()
  );

-- Admins podem inserir/atualizar/deletar
CREATE POLICY "help_articles_admin_write" ON help_articles
  FOR ALL USING (
    organization_id = public.get_user_organization_id()
    AND public.is_user_admin()
  ) WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND public.is_user_admin()
  );

CREATE POLICY "help_articles_service_role" ON help_articles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_help_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_help_articles_updated_at
  BEFORE UPDATE ON help_articles
  FOR EACH ROW
  EXECUTE FUNCTION update_help_articles_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Storage bucket para midia de ajuda
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('help-media', 'help-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (sem SET ROLE para compatibilidade)

DO $$ BEGIN
CREATE POLICY "help_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'help-media');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
CREATE POLICY "help_media_admin_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'help-media'
    AND auth.role() = 'authenticated'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
CREATE POLICY "help_media_admin_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'help-media'
    AND auth.role() = 'authenticated'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Fim das políticas de storage
