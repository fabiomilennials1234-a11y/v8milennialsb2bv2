-- Recent Items: tracks which entities (leads, deals, etc.) each user recently viewed.
-- Used by command palette and sidebar to show "recent" quick-access list.

CREATE TABLE IF NOT EXISTS recent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_label text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recent_items_user_viewed ON recent_items (user_id, viewed_at DESC);
CREATE UNIQUE INDEX idx_recent_items_user_entity ON recent_items (user_id, entity_type, entity_id);

ALTER TABLE recent_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own recents"
  ON recent_items FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own recents"
  ON recent_items FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own recents"
  ON recent_items FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own recents"
  ON recent_items FOR DELETE
  USING (user_id = auth.uid());

-- RPC: upsert a recent view — if already exists, bump viewed_at + update label.
CREATE OR REPLACE FUNCTION track_recent_view(
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM team_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO recent_items (user_id, organization_id, entity_type, entity_id, entity_label, viewed_at)
  VALUES (auth.uid(), v_org_id, p_entity_type, p_entity_id, p_entity_label, now())
  ON CONFLICT (user_id, entity_type, entity_id)
  DO UPDATE SET viewed_at = now(), entity_label = COALESCE(EXCLUDED.entity_label, recent_items.entity_label);

  -- Keep max 50 recent items per user
  DELETE FROM recent_items
  WHERE id IN (
    SELECT id FROM recent_items
    WHERE user_id = auth.uid()
    ORDER BY viewed_at DESC
    OFFSET 50
  );
END;
$$;

-- RPC: get recent items for current user
CREATE OR REPLACE FUNCTION get_recent_items(
  p_limit int DEFAULT 10,
  p_entity_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  entity_type text,
  entity_id uuid,
  entity_label text,
  viewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT ri.id, ri.entity_type, ri.entity_id, ri.entity_label, ri.viewed_at
  FROM recent_items ri
  WHERE ri.user_id = auth.uid()
    AND (p_entity_type IS NULL OR ri.entity_type = p_entity_type)
  ORDER BY ri.viewed_at DESC
  LIMIT p_limit;
END;
$$;
