-- Field Changelog: tracks individual field-level changes on leads.
-- Powers the Historico tab "field_updated" timeline entries and audit trail.

CREATE TABLE IF NOT EXISTS field_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'lead',
  entity_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_field_changes_entity ON field_changes (entity_type, entity_id, changed_at DESC);
CREATE INDEX idx_field_changes_org ON field_changes (organization_id, changed_at DESC);

ALTER TABLE field_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own org field changes"
  ON field_changes FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Trigger: auto-capture field changes on leads UPDATE
CREATE OR REPLACE FUNCTION fn_track_lead_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_field text;
  v_tracked_fields text[] := ARRAY[
    'name', 'company_name', 'email', 'phone', 'origin',
    'rating', 'qualification_score', 'status',
    'responsible_id', 'sdr_id', 'closer_id',
    'ai_disabled', 'notes', 'expected_value',
    'city', 'state', 'segment', 'position'
  ];
  v_old_val text;
  v_new_val text;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_field IN ARRAY v_tracked_fields
  LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_field, v_field)
      INTO v_old_val, v_new_val
      USING OLD, NEW;

    IF v_old_val IS DISTINCT FROM v_new_val THEN
      INSERT INTO field_changes (organization_id, entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES (NEW.organization_id, 'lead', NEW.id, v_field, v_old_val, v_new_val, auth.uid());

      v_changes := v_changes || jsonb_build_object(
        v_field, jsonb_build_object('from', v_old_val, 'to', v_new_val)
      );
    END IF;
  END LOOP;

  -- Also insert into lead_history so it appears in the timeline
  IF v_changes != '{}'::jsonb THEN
    INSERT INTO lead_history (lead_id, organization_id, action, description, source, metadata, created_by)
    VALUES (
      NEW.id,
      NEW.organization_id,
      'field_updated',
      'Campos atualizados',
      'system',
      jsonb_build_object('changes', v_changes),
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_field_changes
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION fn_track_lead_field_changes();

-- RPC: get field changes for a lead (with user names)
CREATE OR REPLACE FUNCTION get_lead_field_changes(
  p_lead_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  entity_type text,
  entity_id uuid,
  field_name text,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz,
  user_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fc.id, fc.entity_type, fc.entity_id,
    fc.field_name, fc.old_value, fc.new_value,
    fc.changed_by, fc.changed_at,
    COALESCE(
      (SELECT tm.name FROM team_members tm WHERE tm.user_id = fc.changed_by LIMIT 1),
      'Sistema'
    ) AS user_name
  FROM field_changes fc
  WHERE fc.entity_id = p_lead_id
    AND fc.entity_type = 'lead'
    AND fc.organization_id IN (
      SELECT tm2.organization_id FROM team_members tm2 WHERE tm2.user_id = auth.uid()
    )
  ORDER BY fc.changed_at DESC
  LIMIT p_limit;
END;
$$;
