-- =============================================================================
-- Wave 4.2: Health score history for sparkline visualization
-- =============================================================================

CREATE TABLE IF NOT EXISTS client_health_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  health_score INTEGER NOT NULL,
  health_status TEXT NOT NULL,
  segment TEXT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(client_id, snapshot_date)
);

CREATE INDEX idx_health_snapshots_client ON client_health_snapshots(client_id, snapshot_date DESC);
CREATE INDEX idx_health_snapshots_org ON client_health_snapshots(organization_id);

-- RLS
ALTER TABLE client_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_snapshots_select_org" ON client_health_snapshots
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "health_snapshots_service_all" ON client_health_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants
GRANT ALL ON client_health_snapshots TO service_role;
GRANT SELECT ON client_health_snapshots TO authenticated;
