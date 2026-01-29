-- Migration: Copilot AI Agents Feature
-- Description: Creates tables for AI agent configuration system
-- Date: 2026-01-25

-- =====================================================
-- ENUMS
-- =====================================================

-- Enum para tipos de template de agente
CREATE TYPE public.agent_template_type AS ENUM (
  'qualificador',
  'sdr',
  'followup',
  'agendador',
  'prospectador',
  'custom'
);

-- Enum para tom de voz
CREATE TYPE public.agent_tone AS ENUM (
  'formal',
  'casual',
  'profissional',
  'amigavel',
  'energetico',
  'consultivo'
);

-- Enum para estilo de comunicação
CREATE TYPE public.agent_style AS ENUM (
  'direto',
  'detalhado',
  'consultivo',
  'persuasivo',
  'educativo'
);

-- Enum para nível de energia
CREATE TYPE public.agent_energy AS ENUM (
  'baixa',
  'moderada',
  'alta',
  'muito_alta'
);

-- =====================================================
-- TABELAS
-- =====================================================

-- Tabela principal de agentes
CREATE TABLE public.copilot_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identificação
  name TEXT NOT NULL,
  template_type agent_template_type NOT NULL DEFAULT 'custom',

  -- Personalidade
  personality_tone agent_tone NOT NULL DEFAULT 'profissional',
  personality_style agent_style NOT NULL DEFAULT 'consultivo',
  personality_energy agent_energy NOT NULL DEFAULT 'moderada',

  -- Configurações
  skills TEXT[] DEFAULT '{}',
  allowed_topics TEXT[] DEFAULT '{}',
  forbidden_topics TEXT[] DEFAULT '{}',
  main_objective TEXT NOT NULL,

  -- System Prompt gerado (cache)
  system_prompt TEXT,
  system_prompt_version INTEGER DEFAULT 1,

  -- Status
  is_active BOOLEAN DEFAULT false,
  is_default BOOLEAN DEFAULT false,

  -- Metadados
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT unique_agent_name_per_org UNIQUE (organization_id, name)
);

-- Tabela de FAQs dos agentes
CREATE TABLE public.copilot_agent_faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,

  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  position INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de regras por etapa do Kanban
CREATE TABLE public.copilot_agent_kanban_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,

  -- Identificação da etapa
  pipe_type TEXT NOT NULL, -- 'confirmacao', 'propostas', 'whatsapp', 'campanha'
  stage_name TEXT NOT NULL, -- Nome específico do status/stage

  -- Regras da etapa
  goal TEXT NOT NULL,
  behavior TEXT NOT NULL,
  allowed_actions TEXT[] DEFAULT '{}',
  forbidden_actions TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma regra por combinação pipe_type + stage_name por agente
  CONSTRAINT unique_agent_pipe_stage UNIQUE (agent_id, pipe_type, stage_name)
);

-- =====================================================
-- ÍNDICES PARA PERFORMANCE
-- =====================================================

CREATE INDEX idx_copilot_agents_org ON public.copilot_agents(organization_id);
CREATE INDEX idx_copilot_agents_active ON public.copilot_agents(is_active);
CREATE INDEX idx_copilot_agents_default ON public.copilot_agents(organization_id, is_default);
CREATE INDEX idx_copilot_agent_faqs_agent ON public.copilot_agent_faqs(agent_id);
CREATE INDEX idx_copilot_agent_kanban_rules_agent ON public.copilot_agent_kanban_rules(agent_id);
CREATE INDEX idx_copilot_agent_kanban_rules_pipe ON public.copilot_agent_kanban_rules(pipe_type, stage_name);

-- =====================================================
-- TRIGGERS PARA UPDATED_AT
-- =====================================================

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para copilot_agents
CREATE TRIGGER update_copilot_agents_updated_at
  BEFORE UPDATE ON public.copilot_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para copilot_agent_faqs
CREATE TRIGGER update_copilot_agent_faqs_updated_at
  BEFORE UPDATE ON public.copilot_agent_faqs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para copilot_agent_kanban_rules
CREATE TRIGGER update_copilot_agent_kanban_rules_updated_at
  BEFORE UPDATE ON public.copilot_agent_kanban_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Ativar RLS nas tabelas
ALTER TABLE public.copilot_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_agent_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_agent_kanban_rules ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- POLICIES PARA copilot_agents
-- =====================================================

-- Usuários podem visualizar agentes da sua organização
CREATE POLICY "Users can view agents from their organization"
  ON public.copilot_agents FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

-- Admins podem inserir agentes
CREATE POLICY "Admins can insert agents"
  ON public.copilot_agents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Admins podem atualizar agentes da sua organização
CREATE POLICY "Admins can update agents from their organization"
  ON public.copilot_agents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Admins podem deletar agentes da sua organização
CREATE POLICY "Admins can delete agents from their organization"
  ON public.copilot_agents FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- =====================================================
-- POLICIES PARA copilot_agent_faqs
-- =====================================================

-- Usuários podem visualizar FAQs de agentes da sua organização
CREATE POLICY "Users can view FAQs from agents in their organization"
  ON public.copilot_agent_faqs FOR SELECT
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

-- Admins podem gerenciar FAQs
CREATE POLICY "Admins can manage FAQs"
  ON public.copilot_agent_faqs FOR ALL
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

-- =====================================================
-- POLICIES PARA copilot_agent_kanban_rules
-- =====================================================

-- Usuários podem visualizar regras de Kanban de agentes da sua organização
CREATE POLICY "Users can view Kanban rules from agents in their organization"
  ON public.copilot_agent_kanban_rules FOR SELECT
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

-- Admins podem gerenciar regras de Kanban
CREATE POLICY "Admins can manage Kanban rules"
  ON public.copilot_agent_kanban_rules FOR ALL
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

-- =====================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =====================================================

COMMENT ON TABLE public.copilot_agents IS 'Armazena configurações de agentes de IA personalizáveis para automação de vendas';
COMMENT ON TABLE public.copilot_agent_faqs IS 'Perguntas frequentes configuradas para cada agente, usadas na geração do System Prompt';
COMMENT ON TABLE public.copilot_agent_kanban_rules IS 'Regras específicas de comportamento do agente por etapa do Kanban/Pipeline';

COMMENT ON COLUMN public.copilot_agents.system_prompt IS 'System Prompt gerado automaticamente - cache para performance';
COMMENT ON COLUMN public.copilot_agents.system_prompt_version IS 'Versão do prompt gerado - incrementa a cada atualização';
COMMENT ON COLUMN public.copilot_agents.is_default IS 'Apenas um agente pode ser padrão por organização';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.pipe_type IS 'Tipo de pipeline: confirmacao, propostas, whatsapp, campanha';
COMMENT ON COLUMN public.copilot_agent_kanban_rules.stage_name IS 'Nome exato do status/stage no pipeline';
