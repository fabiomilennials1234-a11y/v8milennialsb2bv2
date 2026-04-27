-- Migration: Tabela de follow-up rules (se não existir) + política para membros da org
-- Description: Cria a tabela copilot_agent_followup_rules se ela não existir (caso a migration
--              20260126100000 não tenha sido aplicada) e adiciona política para membros da
--              organização gerenciarem regras (não apenas admins).
-- Date: 2026-02-10

-- =====================================================
-- 1. CRIAR TABELA SE NÃO EXISTIR
-- =====================================================

CREATE TABLE IF NOT EXISTS public.copilot_agent_followup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,

  trigger_type TEXT NOT NULL DEFAULT 'no_response',
  trigger_delay_hours INTEGER DEFAULT 24,
  trigger_delay_minutes INTEGER DEFAULT 0,
  max_followups INTEGER DEFAULT 3,

  filter_tags TEXT[] DEFAULT '{}',
  filter_tags_exclude TEXT[] DEFAULT '{}',
  filter_origins TEXT[] DEFAULT '{}',
  filter_pipes TEXT[] DEFAULT '{}',
  filter_stages TEXT[] DEFAULT '{}',
  filter_custom_fields JSONB DEFAULT '{}',

  use_last_context BOOLEAN DEFAULT true,
  context_lookback_days INTEGER DEFAULT 30,
  followup_style TEXT DEFAULT 'value',
  message_template TEXT,

  send_only_business_hours BOOLEAN DEFAULT true,
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '18:00',
  send_days TEXT[] DEFAULT ARRAY['seg', 'ter', 'qua', 'qui', 'sex'],
  timezone TEXT DEFAULT 'America/Sao_Paulo',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================
-- 2. ÍNDICES (SE NÃO EXISTIREM)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_followup_rules_agent
  ON public.copilot_agent_followup_rules(agent_id);

CREATE INDEX IF NOT EXISTS idx_followup_rules_active
  ON public.copilot_agent_followup_rules(is_active, priority DESC);

-- =====================================================
-- 3. RLS E TRIGGER
-- =====================================================

ALTER TABLE public.copilot_agent_followup_rules ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_copilot_agent_followup_rules_updated_at
  ON public.copilot_agent_followup_rules;
CREATE TRIGGER update_copilot_agent_followup_rules_updated_at
  BEFORE UPDATE ON public.copilot_agent_followup_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 4. POLÍTICAS RLS (DROP + CREATE para idempotência)
-- =====================================================

DROP POLICY IF EXISTS "Users can view followup rules from agents in their organization"
  ON public.copilot_agent_followup_rules;
CREATE POLICY "Users can view followup rules from agents in their organization"
  ON public.copilot_agent_followup_rules FOR SELECT
  USING (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Admins can manage followup rules"
  ON public.copilot_agent_followup_rules;
CREATE POLICY "Admins can manage followup rules"
  ON public.copilot_agent_followup_rules FOR ALL
  USING (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Nova política: membros da org podem criar/editar/remover regras (não só admins)
DROP POLICY IF EXISTS "Org members can manage followup rules for agents in their org"
  ON public.copilot_agent_followup_rules;
CREATE POLICY "Org members can manage followup rules for agents in their org"
  ON public.copilot_agent_followup_rules
  FOR ALL
  USING (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    agent_id IN (
      SELECT id
      FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id
        FROM public.team_members
        WHERE user_id = auth.uid()
      )
    )
  );
