-- ============================================================================
-- Wave 1.3 — Unified Activity Model
-- ============================================================================

-- ============================================================================
-- 1. activities
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'task', 'whatsapp_msg', 'system')),
  subject TEXT,
  description TEXT,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_sec INTEGER,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('connected', 'voicemail', 'no_answer', 'busy', 'cancelled', 'completed', 'rescheduled')),
  metadata JSONB DEFAULT '{}',
  is_automated BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'automation', 'email_sync', 'call_log', 'webhook', 'migration', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_activities_org ON public.activities (organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON public.activities (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_company ON public.activities (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_deal ON public.activities (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_lead ON public.activities (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_type ON public.activities (type);
CREATE INDEX IF NOT EXISTS idx_activities_org_type ON public.activities (organization_id, type);
CREATE INDEX IF NOT EXISTS idx_activities_open_tasks ON public.activities (due_date) WHERE due_date IS NOT NULL AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activities_assigned ON public.activities (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_created ON public.activities (created_at DESC);

-- ============================================================================
-- 3. RLS
-- ============================================================================

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_select" ON public.activities FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "activities_insert" ON public.activities FOR INSERT
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "activities_update" ON public.activities FOR UPDATE
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "activities_delete" ON public.activities FOR DELETE
  USING (organization_id = public.get_user_organization_id());

-- ============================================================================
-- 4. updated_at trigger
-- ============================================================================

CREATE TRIGGER update_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- 5. Data migration: follow_ups → activities
-- ============================================================================

CREATE OR REPLACE FUNCTION public.migrate_follow_ups_to_activities()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_count INT := 0;
BEGIN
  v_org_id := public.get_user_organization_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  INSERT INTO public.activities (
    organization_id, type, subject, description, lead_id,
    owner_id, assigned_to, due_date, completed_at,
    source, created_at, metadata
  )
  SELECT
    f.organization_id,
    'task',
    f.title,
    f.description,
    f.lead_id,
    f.created_by,
    (SELECT tm.id FROM public.team_members tm WHERE tm.user_id = f.assigned_to AND tm.organization_id = f.organization_id LIMIT 1),
    f.due_date,
    f.completed_at,
    'migration',
    f.created_at,
    jsonb_build_object('original_follow_up_id', f.id, 'type', f.type, 'priority', f.priority)
  FROM public.follow_ups f
  WHERE f.organization_id = v_org_id
    AND NOT EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.metadata->>'original_follow_up_id' = f.id::TEXT
        AND a.organization_id = v_org_id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('migrated_count', v_count);
END;
$$;

-- ============================================================================
-- 6. Activity logging helper
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_activity(
  p_type TEXT,
  p_subject TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_contact_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_deal_id UUID DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_id UUID;
BEGIN
  v_org_id := public.get_user_organization_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  INSERT INTO public.activities (
    organization_id, type, subject, description,
    contact_id, company_id, deal_id, lead_id,
    owner_id, metadata
  ) VALUES (
    v_org_id, p_type, p_subject, p_description,
    p_contact_id, p_company_id, p_deal_id, p_lead_id,
    auth.uid(), p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 7. get_activities RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_activities(
  p_contact_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_deal_id UUID DEFAULT NULL,
  p_lead_id UUID DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  type TEXT,
  subject TEXT,
  description TEXT,
  contact_id UUID,
  company_id UUID,
  deal_id UUID,
  lead_id UUID,
  owner_id UUID,
  owner_email TEXT,
  assigned_to UUID,
  assigned_name TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_sec INTEGER,
  outcome TEXT,
  metadata JSONB,
  is_automated BOOLEAN,
  source TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := public.get_user_organization_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.type, a.subject, a.description,
    a.contact_id, a.company_id, a.deal_id, a.lead_id,
    a.owner_id,
    u.email AS owner_email,
    a.assigned_to,
    tm.name AS assigned_name,
    a.due_date, a.completed_at, a.duration_sec, a.outcome,
    a.metadata, a.is_automated, a.source, a.created_at
  FROM public.activities a
  LEFT JOIN auth.users u ON a.owner_id = u.id
  LEFT JOIN public.team_members tm ON a.assigned_to = tm.id
  WHERE a.organization_id = v_org_id
    AND (p_contact_id IS NULL OR a.contact_id = p_contact_id)
    AND (p_company_id IS NULL OR a.company_id = p_company_id)
    AND (p_deal_id IS NULL OR a.deal_id = p_deal_id)
    AND (p_lead_id IS NULL OR a.lead_id = p_lead_id)
    AND (p_type IS NULL OR a.type = p_type)
  ORDER BY a.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================================================
-- 8. GRANTs
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_follow_ups_to_activities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_activities(UUID, UUID, UUID, UUID, TEXT, INT, INT) TO authenticated;

-- ============================================================================
-- 9. Realtime
-- ============================================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE activities; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
