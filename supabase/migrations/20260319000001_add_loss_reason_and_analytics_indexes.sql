-- Add loss_reason field to pipe_propostas for Win/Loss analysis
ALTER TABLE pipe_propostas
  ADD COLUMN IF NOT EXISTS loss_reason text;

-- Comment for documentation
COMMENT ON COLUMN pipe_propostas.loss_reason IS
  'Motivo de perda do deal. Valores comuns: sem_budget, concorrencia, timing, follow_up_fraco, produto_nao_adequado, outro';

-- Indexes for analytics time-series queries
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_org_closed
  ON pipe_propostas (organization_id, closed_at)
  WHERE closed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_org_created
  ON pipe_whatsapp (organization_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_org_meeting
  ON pipe_confirmacao (organization_id, meeting_date)
  WHERE meeting_date IS NOT NULL;

-- Seed analytics feature into plan_features for all active plans
-- This enables the analytics module for organizations on these plans
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT id, 'analytics', true
FROM subscription_plans
WHERE is_active = true
ON CONFLICT DO NOTHING;
