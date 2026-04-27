-- Item #18: A/B Testing de prompts
-- Permite testar variantes de prompt para um agente e comparar métricas

CREATE TABLE IF NOT EXISTS public.copilot_agent_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identificação da variante
  name            TEXT NOT NULL,           -- ex: "Variante A — Tom mais direto"
  description     TEXT,
  is_control      BOOLEAN DEFAULT false,   -- true = variante de controle (original)
  is_active       BOOLEAN DEFAULT true,

  -- Configuração do experimento
  traffic_pct     INTEGER DEFAULT 50       -- % do tráfego para esta variante (0-100)
                  CHECK (traffic_pct BETWEEN 0 AND 100),

  -- Override de configuração (o que muda entre variantes)
  system_prompt_override TEXT,             -- prompt completo alternativo
  temperature_override   TEXT              -- 'criativo'|'balanceado'|'preciso'
                  CHECK (temperature_override IN ('criativo', 'balanceado', 'preciso')),

  -- Métricas acumuladas (atualizado pelo sistema)
  total_conversations INTEGER DEFAULT 0,
  total_turns         INTEGER DEFAULT 0,
  avg_score_overall   NUMERIC(4,2) DEFAULT 0,   -- média do LLM-as-a-judge
  avg_score_goal_align NUMERIC(4,2) DEFAULT 0,
  qualification_rate  NUMERIC(5,2) DEFAULT 0,   -- % leads qualificados
  meetings_scheduled  INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_agent_id  ON public.copilot_agent_variants(agent_id);
CREATE INDEX IF NOT EXISTS idx_variants_org_id    ON public.copilot_agent_variants(organization_id);
CREATE INDEX IF NOT EXISTS idx_variants_active    ON public.copilot_agent_variants(is_active);

-- Tabela de atribuições: qual variante cada conversa está usando
CREATE TABLE IF NOT EXISTS public.copilot_ab_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      UUID NOT NULL REFERENCES public.copilot_agent_variants(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, lead_id)  -- 1 atribuição por lead/agente
);

CREATE INDEX IF NOT EXISTS idx_ab_assignments_variant_id  ON public.copilot_ab_assignments(variant_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_agent_id    ON public.copilot_ab_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_lead_id     ON public.copilot_ab_assignments(lead_id);

-- RLS
ALTER TABLE public.copilot_agent_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_ab_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_select_variants"
  ON public.copilot_agent_variants FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "org_members_all_variants"
  ON public.copilot_agent_variants FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "service_role_all_variants"
  ON public.copilot_agent_variants FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_all_ab_assignments"
  ON public.copilot_ab_assignments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "org_members_select_ab_assignments"
  ON public.copilot_ab_assignments FOR SELECT
  USING (agent_id IN (
    SELECT id FROM public.copilot_agents ca
    WHERE ca.organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  ));

COMMENT ON TABLE public.copilot_agent_variants IS
  'Variantes de prompt para A/B Testing. Cada variante recebe uma % do tráfego e tem métricas acumuladas.';

COMMENT ON TABLE public.copilot_ab_assignments IS
  'Atribuição determinística de leads a variantes A/B (1 por lead/agente).';
