-- Private, operator-only snapshots for explicitly authorized movement repairs.
CREATE TABLE backup.pipeline_move_repair_snapshots (
  repair_key text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);
ALTER TABLE backup.pipeline_move_repair_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup.pipeline_move_repair_snapshots FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE backup.pipeline_move_repair_snapshots IS
  'Operator-only repair snapshots; deliberately no client policies or grants.';
