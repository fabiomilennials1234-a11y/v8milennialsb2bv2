-- Wave 6 — AI Next-Gen
-- AI Email Writer, Deal Insights, Next-Best-Action, Real-time Coaching, Competitive Intel.

-- ============================================================================
-- 1. AI Email Drafts
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  style text NOT NULL DEFAULT 'formal' CHECK (style IN ('formal', 'casual', 'follow_up', 'proposal', 'intro')),
  context_snapshot jsonb NOT NULL DEFAULT '{}',
  prompt text,
  generated_subject text,
  generated_body text,
  model_used text,
  tokens_used int,
  accepted boolean,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_email_drafts_org ON ai_email_drafts (organization_id);
CREATE INDEX idx_ai_email_drafts_deal ON ai_email_drafts (deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE ai_email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see own drafts"
  ON ai_email_drafts FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Org members create drafts"
  ON ai_email_drafts FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 2. Deal Insights / Health Scores
-- ============================================================================

CREATE TABLE IF NOT EXISTS deal_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  health_score int NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  positive_factors jsonb NOT NULL DEFAULT '[]',
  negative_factors jsonb NOT NULL DEFAULT '[]',
  suggestions jsonb NOT NULL DEFAULT '[]',
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  predicted_close_probability numeric(5,2),
  model_used text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX idx_deal_insights_deal ON deal_insights (deal_id, computed_at DESC);
CREATE INDEX idx_deal_insights_org ON deal_insights (organization_id);
CREATE INDEX idx_deal_insights_risk ON deal_insights (organization_id, risk_level) WHERE risk_level IN ('high', 'critical');

ALTER TABLE deal_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see deal insights"
  ON deal_insights FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "System inserts deal insights"
  ON deal_insights FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. Next-Best-Action recommendations
-- ============================================================================

CREATE TABLE IF NOT EXISTS next_best_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  deal_id uuid,
  action_type text NOT NULL CHECK (action_type IN ('call', 'email', 'meeting', 'follow_up', 'send_proposal', 'escalate', 'other')),
  title text NOT NULL,
  reason text NOT NULL,
  priority int NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 100),
  due_by timestamptz,
  completed_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nba_user_pending ON next_best_actions (user_id, organization_id)
  WHERE completed_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX idx_nba_priority ON next_best_actions (organization_id, priority DESC)
  WHERE completed_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE next_best_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own actions"
  ON next_best_actions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users manage own actions"
  ON next_best_actions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System inserts actions"
  ON next_best_actions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- RPC: Get prioritized actions for current user
CREATE OR REPLACE FUNCTION get_next_best_actions(p_limit int DEFAULT 10)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  lead_name text,
  deal_id uuid,
  action_type text,
  title text,
  reason text,
  priority int,
  due_by timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nba.id,
    nba.lead_id,
    l.name AS lead_name,
    nba.deal_id,
    nba.action_type,
    nba.title,
    nba.reason,
    nba.priority,
    nba.due_by,
    nba.metadata
  FROM next_best_actions nba
  LEFT JOIN leads l ON l.id = nba.lead_id
  WHERE nba.user_id = auth.uid()
    AND nba.completed_at IS NULL
    AND nba.dismissed_at IS NULL
  ORDER BY nba.priority DESC, nba.due_by ASC NULLS LAST
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- 4. Coaching Suggestions (real-time)
-- ============================================================================

CREATE TABLE IF NOT EXISTS coaching_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('response', 'objection_handling', 'tone_alert', 'battle_card', 'upsell_opportunity')),
  content text NOT NULL,
  context_message_id uuid,
  was_used boolean DEFAULT false,
  dismissed boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coaching_conv ON coaching_suggestions (conversation_id, created_at DESC);
CREATE INDEX idx_coaching_user ON coaching_suggestions (user_id, organization_id)
  WHERE was_used = false AND dismissed = false;

ALTER TABLE coaching_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own coaching"
  ON coaching_suggestions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users update own coaching"
  ON coaching_suggestions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System inserts coaching"
  ON coaching_suggestions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. Competitors & Battle Cards
-- ============================================================================

CREATE TABLE IF NOT EXISTS competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  aliases jsonb DEFAULT '[]',
  website text,
  strengths jsonb DEFAULT '[]',
  weaknesses jsonb DEFAULT '[]',
  battlecard_md text,
  win_rate_vs numeric(5,2),
  total_encounters int NOT NULL DEFAULT 0,
  total_wins int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitors_org ON competitors (organization_id) WHERE is_active = true;

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see competitors"
  ON competitors FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage competitors"
  ON competitors FOR ALL
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
    )
  );

-- Competitor mentions detected in conversations
CREATE TABLE IF NOT EXISTS competitor_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  message_id uuid,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  deal_id uuid,
  matched_keyword text NOT NULL,
  snippet text,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comp_mentions_org ON competitor_mentions (organization_id, detected_at DESC);
CREATE INDEX idx_comp_mentions_comp ON competitor_mentions (competitor_id, detected_at DESC);
CREATE INDEX idx_comp_mentions_deal ON competitor_mentions (deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE competitor_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members see mentions"
  ON competitor_mentions FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "System inserts mentions"
  ON competitor_mentions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- RPC: Win rate vs each competitor
CREATE OR REPLACE FUNCTION get_competitor_stats(p_org_id uuid)
RETURNS TABLE(
  competitor_id uuid,
  competitor_name text,
  total_encounters bigint,
  total_wins bigint,
  win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL OR v_org_id != p_org_id THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    c.id AS competitor_id,
    c.name AS competitor_name,
    c.total_encounters::bigint,
    c.total_wins::bigint,
    CASE WHEN c.total_encounters > 0
      THEN ROUND((c.total_wins::numeric / c.total_encounters) * 100, 1)
      ELSE 0
    END AS win_rate
  FROM competitors c
  WHERE c.organization_id = p_org_id AND c.is_active = true
  ORDER BY c.total_encounters DESC;
END;
$$;
