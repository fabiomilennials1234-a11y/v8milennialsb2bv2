-- Item #8: LLM-as-a-judge — avaliação automática de qualidade das respostas
-- Tabela para armazenar avaliações de qualidade de cada turno de conversa

CREATE TABLE IF NOT EXISTS public.copilot_conversation_evaluations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id          UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
  lead_id           UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  turn_count        INTEGER NOT NULL DEFAULT 0,

  -- Mensagens avaliadas
  user_message      TEXT NOT NULL,
  agent_response    TEXT NOT NULL,

  -- Scores (0-10)
  score_relevance   NUMERIC(3,1) CHECK (score_relevance BETWEEN 0 AND 10),
  score_tone        NUMERIC(3,1) CHECK (score_tone BETWEEN 0 AND 10),
  score_goal_align  NUMERIC(3,1) CHECK (score_goal_align BETWEEN 0 AND 10),
  score_conciseness NUMERIC(3,1) CHECK (score_conciseness BETWEEN 0 AND 10),
  score_overall     NUMERIC(3,1) CHECK (score_overall BETWEEN 0 AND 10),

  -- Feedback textual do juiz
  strengths         TEXT,
  weaknesses        TEXT,
  suggestion        TEXT,

  -- Metadados
  model_used        TEXT DEFAULT 'google/gemini-2.0-flash-001',
  evaluated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_conversation_id
  ON public.copilot_conversation_evaluations(conversation_id);

CREATE INDEX IF NOT EXISTS idx_evaluations_org_id
  ON public.copilot_conversation_evaluations(organization_id);

CREATE INDEX IF NOT EXISTS idx_evaluations_agent_id
  ON public.copilot_conversation_evaluations(agent_id);

CREATE INDEX IF NOT EXISTS idx_evaluations_evaluated_at
  ON public.copilot_conversation_evaluations(evaluated_at DESC);

ALTER TABLE public.copilot_conversation_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_evaluations"
  ON public.copilot_conversation_evaluations FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_all_evaluations"
  ON public.copilot_conversation_evaluations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.copilot_conversation_evaluations IS
  'Avaliações automáticas de qualidade de respostas do agente (LLM-as-a-judge). Score 0-10 por dimensão.';
