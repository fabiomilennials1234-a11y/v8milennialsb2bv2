-- Private, operator-only snapshots for explicitly authorized movement repairs.
--
-- O schema `backup` foi criado em prod FORA de migration (dono postgres, sem
-- grants). Em banco novo (CI, `supabase start`) esta linha não existia e o
-- arquivo morria com 3F000 "schema backup does not exist", derrubando o pgTAP
-- e a integração. IF NOT EXISTS: em prod é no-op; em banco novo reproduz o ACL
-- de prod (só o dono).
CREATE SCHEMA IF NOT EXISTS backup;
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
