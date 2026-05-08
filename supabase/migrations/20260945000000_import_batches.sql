-- Import Batches: tracks each CSV/XLSX import so it can be rolled back.
-- Each lead created by an import gets tagged with the batch UUID.

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name text,
  total_rows int NOT NULL DEFAULT 0,
  imported_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  rolled_back boolean NOT NULL DEFAULT false,
  rolled_back_at timestamptz,
  rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_batches_org ON import_batches (organization_id, created_at DESC);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own org batches"
  ON import_batches FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert own org batches"
  ON import_batches FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Add import_batch_id column to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_import_batch ON leads (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- RPC: rollback an import batch (soft-delete all leads from that batch)
CREATE OR REPLACE FUNCTION rollback_import_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch import_batches;
  v_deleted_count int;
BEGIN
  SELECT * INTO v_batch FROM import_batches WHERE id = p_batch_id;

  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('error', 'Batch not found');
  END IF;

  IF v_batch.rolled_back THEN
    RETURN jsonb_build_object('error', 'Batch already rolled back');
  END IF;

  -- Verify caller belongs to same org
  IF NOT EXISTS (
    SELECT 1 FROM team_members
    WHERE user_id = auth.uid() AND organization_id = v_batch.organization_id
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- Soft-delete leads (set deleted_at if column exists, otherwise hard delete pipe entries and mark batch)
  UPDATE leads
  SET deleted_at = now()
  WHERE import_batch_id = p_batch_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Mark batch as rolled back
  UPDATE import_batches
  SET rolled_back = true,
      rolled_back_at = now(),
      rolled_back_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- RPC: get import history for org
CREATE OR REPLACE FUNCTION get_import_batches(p_limit int DEFAULT 20)
RETURNS TABLE(
  id uuid,
  file_name text,
  total_rows int,
  imported_count int,
  skipped_count int,
  error_count int,
  rolled_back boolean,
  rolled_back_at timestamptz,
  created_at timestamptz,
  created_by_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ib.id, ib.file_name, ib.total_rows,
    ib.imported_count, ib.skipped_count, ib.error_count,
    ib.rolled_back, ib.rolled_back_at, ib.created_at,
    COALESCE(
      (SELECT tm.name FROM team_members tm WHERE tm.user_id = ib.created_by LIMIT 1),
      'Sistema'
    ) AS created_by_name
  FROM import_batches ib
  WHERE ib.organization_id IN (
    SELECT tm2.organization_id FROM team_members tm2 WHERE tm2.user_id = auth.uid()
  )
  ORDER BY ib.created_at DESC
  LIMIT p_limit;
END;
$$;
