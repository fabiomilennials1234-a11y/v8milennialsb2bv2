-- ============================================================================
-- Wave 1.1 — Contact / Company / Deal Separation
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. companies
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  industry TEXT,
  size_range TEXT,
  revenue_range TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'BR',
  parent_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Functional unique on normalized name (dedup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_org_lower_name
  ON public.companies (organization_id, LOWER(TRIM(name)));

CREATE INDEX IF NOT EXISTS idx_companies_org ON public.companies (organization_id);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON public.companies (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_parent ON public.companies (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON public.companies USING gin (name gin_trgm_ops);

CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_select" ON public.companies FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "companies_insert" ON public.companies FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "companies_update" ON public.companies FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "companies_delete" ON public.companies FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 2. contacts
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  normalized_phone TEXT,
  job_title TEXT,
  linkedin_url TEXT,
  avatar_url TEXT,
  source TEXT,
  source_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  is_primary BOOLEAN DEFAULT false,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_phone_unique
  ON public.contacts (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_org ON public.contacts (organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON public.contacts (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_phone ON public.contacts (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_source_lead ON public.contacts (source_lead_id) WHERE source_lead_id IS NOT NULL;

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select" ON public.contacts FOR SELECT
  USING (organization_id = public.get_user_organization_id() AND deleted_at IS NULL);

CREATE POLICY "contacts_insert" ON public.contacts FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "contacts_update" ON public.contacts FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "contacts_delete" ON public.contacts FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 3. deals
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  value DECIMAL(14,2),
  currency TEXT DEFAULT 'BRL',
  pipeline_id UUID,
  stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  source_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  probability INTEGER CHECK (probability >= 0 AND probability <= 100),
  expected_close_date DATE,
  closed_at TIMESTAMPTZ,
  won BOOLEAN,
  loss_reason TEXT,
  loss_reason_id UUID,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_org ON public.deals (organization_id);
CREATE INDEX IF NOT EXISTS idx_deals_company ON public.deals (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner ON public.deals (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON public.deals (pipeline_id) WHERE pipeline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage ON public.deals (stage_id) WHERE stage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_won ON public.deals (won) WHERE won IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_expected_close ON public.deals (expected_close_date) WHERE expected_close_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_source_lead ON public.deals (source_lead_id) WHERE source_lead_id IS NOT NULL;

CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals_select" ON public.deals FOR SELECT
  USING (organization_id = public.get_user_organization_id() AND deleted_at IS NULL);

CREATE POLICY "deals_insert" ON public.deals FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "deals_update" ON public.deals FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "deals_delete" ON public.deals FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 4. deal_contacts (junction)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deal_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant',
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(deal_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal ON public.deal_contacts (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_contacts_contact ON public.deal_contacts (contact_id);

-- RLS (inherit org scope via deals)
ALTER TABLE public.deal_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_contacts_select" ON public.deal_contacts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_id
      AND d.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "deal_contacts_insert" ON public.deal_contacts FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_id
      AND d.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "deal_contacts_update" ON public.deal_contacts FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_id
      AND d.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "deal_contacts_delete" ON public.deal_contacts FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = deal_id
      AND d.organization_id = public.get_user_organization_id()
  ));

-- ============================================================================
-- 5. Backward-compatible FKs on leads
-- ============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_entity_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact ON public.leads (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company_entity ON public.leads (company_entity_id) WHERE company_entity_id IS NOT NULL;

-- ============================================================================
-- 6. Data migration RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_leads_to_contacts_companies(
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_lead RECORD;
  v_company_id UUID;
  v_contact_id UUID;
  v_migrated INT := 0;
  v_company_count INT := 0;
  v_contact_count INT := 0;
BEGIN
  -- Resolve caller org
  v_org_id := public.get_user_organization_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found for current user';
  END IF;

  FOR v_lead IN
    SELECT id, name, email, phone, normalized_phone, company
    FROM public.leads
    WHERE organization_id = v_org_id
      AND contact_id IS NULL
      AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT p_batch_size
  LOOP
    v_company_id := NULL;

    -- Upsert company if lead has company text
    IF v_lead.company IS NOT NULL AND TRIM(v_lead.company) <> '' THEN
      -- Try to find existing company first (functional index match)
      SELECT id INTO v_company_id
      FROM public.companies
      WHERE organization_id = v_org_id
        AND LOWER(TRIM(name)) = LOWER(TRIM(v_lead.company));

      IF v_company_id IS NULL THEN
        INSERT INTO public.companies (organization_id, name)
          VALUES (v_org_id, TRIM(v_lead.company))
          RETURNING id INTO v_company_id;
        v_company_count := v_company_count + 1;
      END IF;
    END IF;

    -- Insert contact
    INSERT INTO public.contacts (
      organization_id, company_id, name, email, phone,
      normalized_phone, source, source_lead_id
    ) VALUES (
      v_org_id, v_company_id, v_lead.name, v_lead.email, v_lead.phone,
      v_lead.normalized_phone, 'migration', v_lead.id
    )
    RETURNING id INTO v_contact_id;

    v_contact_count := v_contact_count + 1;

    -- Link back to lead
    UPDATE public.leads
    SET contact_id = v_contact_id,
        company_entity_id = v_company_id
    WHERE id = v_lead.id;

    v_migrated := v_migrated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'migrated_count', v_migrated,
    'company_count', v_company_count,
    'contact_count', v_contact_count
  );
END;
$$;

-- ============================================================================
-- 7. Compat view
-- ============================================================================

CREATE OR REPLACE VIEW public.leads_compat AS
SELECT
  l.*,
  c.job_title   AS contact_job_title,
  c.linkedin_url AS contact_linkedin,
  co.domain      AS company_domain,
  co.industry    AS company_industry,
  co.size_range  AS company_size,
  co.revenue_range AS company_revenue,
  co.website     AS company_website
FROM public.leads l
LEFT JOIN public.contacts c ON l.contact_id = c.id
LEFT JOIN public.companies co ON l.company_entity_id = co.id;

-- ============================================================================
-- 8. GRANTs
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_contacts TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_leads_to_contacts_companies(INT) TO authenticated;

-- ============================================================================
-- 9. Realtime
-- ============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE companies; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE contacts; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE deals; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
