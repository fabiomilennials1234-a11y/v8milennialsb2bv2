-- Product materials: files (PDFs, images, catalogs) linked to products
-- Used by Copilot agent engine as sendable context

CREATE TABLE IF NOT EXISTS public.product_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT NOT NULL,
  material_type TEXT NOT NULL DEFAULT 'documento'
    CHECK (material_type IN ('pdf_comercial', 'apresentacao', 'catalogo', 'imagem', 'flyer', 'documento')),
  description TEXT,
  summary TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_materials_product ON product_materials(product_id);
CREATE INDEX IF NOT EXISTS idx_product_materials_org ON product_materials(organization_id);

-- RLS
ALTER TABLE product_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_materials_select ON product_materials FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY product_materials_manage ON product_materials FOR ALL
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

-- Auto-update updated_at
CREATE TRIGGER trg_product_materials_updated_at
  BEFORE UPDATE ON product_materials FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
