-- Loss Reasons: per-org taxonomy for "Perdido" status in pipe_propostas.
-- System defaults seeded on first migration; orgs can add custom reasons.

CREATE TABLE IF NOT EXISTS loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  is_system boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_loss_reasons_org ON loss_reasons (organization_id, display_order);

ALTER TABLE loss_reasons ENABLE ROW LEVEL SECURITY;

-- Org members can see their org's loss reasons
CREATE POLICY "Users see own org loss reasons"
  ON loss_reasons FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Org members can insert loss reasons for their org
CREATE POLICY "Users insert own org loss reasons"
  ON loss_reasons FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Org members can update their org's loss reasons
CREATE POLICY "Users update own org loss reasons"
  ON loss_reasons FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Org members can delete non-system loss reasons for their org
CREATE POLICY "Users delete own org loss reasons"
  ON loss_reasons FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
    AND is_system = false
  );

-- Seed system defaults for all existing organizations
INSERT INTO loss_reasons (organization_id, name, category, is_system, display_order)
SELECT o.id, d.name, d.category, true, d.display_order
FROM organizations o
CROSS JOIN (
  VALUES
    ('Preco',        'financeiro', 1),
    ('Timing',       'timing',    2),
    ('Concorrente',  'competidor', 3),
    ('Sem Budget',   'financeiro', 4),
    ('Sem Decisao',  'processo',  5),
    ('Escopo',       'produto',   6),
    ('Outro',        'outro',     7)
) AS d(name, category, display_order)
ON CONFLICT DO NOTHING;

-- Function to auto-seed loss reasons when a new org is created
CREATE OR REPLACE FUNCTION fn_seed_loss_reasons_for_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO loss_reasons (organization_id, name, category, is_system, display_order)
  VALUES
    (NEW.id, 'Preco',       'financeiro', true, 1),
    (NEW.id, 'Timing',      'timing',     true, 2),
    (NEW.id, 'Concorrente', 'competidor', true, 3),
    (NEW.id, 'Sem Budget',  'financeiro', true, 4),
    (NEW.id, 'Sem Decisao', 'processo',   true, 5),
    (NEW.id, 'Escopo',      'produto',    true, 6),
    (NEW.id, 'Outro',       'outro',      true, 7);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_loss_reasons
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION fn_seed_loss_reasons_for_org();

-- Add loss_reason_id FK to pipe_propostas (nullable, only set when status = 'perdido')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipe_propostas' AND column_name = 'loss_reason_id'
  ) THEN
    ALTER TABLE pipe_propostas ADD COLUMN loss_reason_id uuid REFERENCES loss_reasons(id) ON DELETE SET NULL;
  END IF;
END $$;
