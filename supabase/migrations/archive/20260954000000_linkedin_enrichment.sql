-- Wave 2.5 — LinkedIn Enrichment
-- Table for tracking enrichment requests per contact/lead.

CREATE TABLE IF NOT EXISTS enrichment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'linkedin',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for org-scoped queries
CREATE INDEX idx_enrichment_requests_org ON enrichment_requests (organization_id);
CREATE INDEX idx_enrichment_requests_contact ON enrichment_requests (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_enrichment_requests_lead ON enrichment_requests (lead_id) WHERE lead_id IS NOT NULL;

-- RLS: org members can see their org's enrichment requests
ALTER TABLE enrichment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view enrichment requests"
  ON enrichment_requests FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members can insert enrichment requests"
  ON enrichment_requests FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_enrichment_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enrichment_requests_updated_at
  BEFORE UPDATE ON enrichment_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_enrichment_requests_updated_at();
