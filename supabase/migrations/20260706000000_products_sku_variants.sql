-- ============================================================
-- Migration: Adicionar SKU e variações aos produtos (B2B)
-- ============================================================

-- 1. Novos campos na tabela products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS has_variants BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_unit TEXT;

-- Índice único de SKU por organização
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_org
  ON public.products (organization_id, sku)
  WHERE sku IS NOT NULL;

-- 2. Função para gerar SKU automático
CREATE OR REPLACE FUNCTION public.generate_product_sku(
  p_organization_id UUID,
  p_type TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  prefix TEXT;
  next_seq INT;
  new_sku TEXT;
BEGIN
  -- Mapear tipo para prefixo
  prefix := CASE p_type
    WHEN 'mrr' THEN 'MRR'
    WHEN 'projeto' THEN 'PRJ'
    WHEN 'unitario' THEN 'UNI'
    ELSE 'PRD'
  END;

  -- Contar produtos existentes com esse prefixo na org
  SELECT COUNT(*) + 1 INTO next_seq
  FROM public.products
  WHERE organization_id = p_organization_id
    AND sku LIKE prefix || '-%';

  new_sku := prefix || '-' || LPAD(next_seq::TEXT, 4, '0');

  -- Garantir unicidade (loop de segurança)
  WHILE EXISTS (
    SELECT 1 FROM public.products
    WHERE organization_id = p_organization_id AND sku = new_sku
  ) LOOP
    next_seq := next_seq + 1;
    new_sku := prefix || '-' || LPAD(next_seq::TEXT, 4, '0');
  END LOOP;

  RETURN new_sku;
END;
$$;

-- 3. Gerar SKU para produtos existentes que não têm
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, organization_id, type
    FROM public.products
    WHERE sku IS NULL
    ORDER BY created_at
  LOOP
    UPDATE public.products
    SET sku = public.generate_product_sku(r.organization_id, r.type)
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- 4. Tabela de variações
CREATE TABLE public.product_variants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  ticket NUMERIC,
  ticket_minimo NUMERIC,
  weight NUMERIC,
  grammage NUMERIC,
  dimensions TEXT,
  color TEXT,
  size TEXT,
  custom_attributes JSONB DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índices
CREATE UNIQUE INDEX idx_product_variants_sku_org
  ON public.product_variants (organization_id, sku)
  WHERE sku IS NOT NULL;

CREATE INDEX idx_product_variants_product_id
  ON public.product_variants (product_id);

CREATE INDEX idx_product_variants_org_id
  ON public.product_variants (organization_id);

-- Trigger updated_at
CREATE TRIGGER update_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 5. RLS para product_variants
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Variações visíveis para autenticados"
  ON public.product_variants
  FOR SELECT
  USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar variações"
  ON public.product_variants
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Função para gerar SKU de variação
CREATE OR REPLACE FUNCTION public.generate_variant_sku(
  p_organization_id UUID,
  p_parent_sku TEXT
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_seq INT;
  new_sku TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO next_seq
  FROM public.product_variants
  WHERE organization_id = p_organization_id
    AND sku LIKE p_parent_sku || '-%';

  new_sku := p_parent_sku || '-' || LPAD(next_seq::TEXT, 2, '0');

  WHILE EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE organization_id = p_organization_id AND sku = new_sku
  ) LOOP
    next_seq := next_seq + 1;
    new_sku := p_parent_sku || '-' || LPAD(next_seq::TEXT, 2, '0');
  END LOOP;

  RETURN new_sku;
END;
$$;
