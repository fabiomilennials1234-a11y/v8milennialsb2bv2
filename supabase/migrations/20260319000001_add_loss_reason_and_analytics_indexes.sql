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

-- Add analytics feature to all subscription plans (features is JSONB column)
UPDATE subscription_plans
SET features = COALESCE(features, '{}')::jsonb || '{"analytics": true}'::jsonb
WHERE is_active = true;

-- Also register in feature_flags table with default enabled
INSERT INTO feature_flags (key, name, description, default_enabled, category)
VALUES ('analytics', 'Analytics', 'Painel de inteligência com métricas avançadas', true, 'modules')
ON CONFLICT (key) DO NOTHING;
