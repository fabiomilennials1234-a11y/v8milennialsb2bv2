-- Competitions: ranked sales/meetings contests with prizes per position
CREATE TABLE IF NOT EXISTS public.competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  criteria TEXT NOT NULL DEFAULT 'absolute_value' CHECK (criteria IN ('absolute_value', 'goal_percentage')),
  metric_type TEXT NOT NULL DEFAULT 'sales' CHECK (metric_type IN ('sales', 'meetings')),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competition_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(competition_id, team_member_id)
);

CREATE TABLE IF NOT EXISTS public.competition_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 5),
  prize_name TEXT NOT NULL,
  prize_description TEXT,
  prize_value NUMERIC(12,2),
  prize_icon TEXT DEFAULT '🏆',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(competition_id, position)
);

-- Indexes
CREATE INDEX idx_competitions_org_status ON competitions(organization_id, status);
CREATE INDEX idx_competition_participants_comp ON competition_participants(competition_id);
CREATE INDEX idx_competition_prizes_comp ON competition_prizes(competition_id);

-- RLS
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_prizes ENABLE ROW LEVEL SECURITY;

-- Competitions: org members can read, admins can write
CREATE POLICY "competitions_select" ON competitions FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "competitions_insert" ON competitions FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT tm.organization_id FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

CREATE POLICY "competitions_update" ON competitions FOR UPDATE
  USING (organization_id IN (
    SELECT tm.organization_id FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

CREATE POLICY "competitions_delete" ON competitions FOR DELETE
  USING (organization_id IN (
    SELECT tm.organization_id FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

-- Participants: readable by org, writable by admin
CREATE POLICY "competition_participants_select" ON competition_participants FOR SELECT
  USING (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  ));

CREATE POLICY "competition_participants_insert" ON competition_participants FOR INSERT
  WITH CHECK (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

CREATE POLICY "competition_participants_delete" ON competition_participants FOR DELETE
  USING (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

-- Prizes: readable by org, writable by admin
CREATE POLICY "competition_prizes_select" ON competition_prizes FOR SELECT
  USING (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  ));

CREATE POLICY "competition_prizes_insert" ON competition_prizes FOR INSERT
  WITH CHECK (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

CREATE POLICY "competition_prizes_update" ON competition_prizes FOR UPDATE
  USING (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

CREATE POLICY "competition_prizes_delete" ON competition_prizes FOR DELETE
  USING (competition_id IN (
    SELECT c.id FROM competitions c
    JOIN team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
  ));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_competitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_competitions_updated_at
  BEFORE UPDATE ON competitions FOR EACH ROW
  EXECUTE FUNCTION update_competitions_updated_at();
