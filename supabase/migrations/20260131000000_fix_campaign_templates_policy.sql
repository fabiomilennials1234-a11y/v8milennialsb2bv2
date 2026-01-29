-- Migration: Fix campaign_templates RLS policy
-- Description: Cria tabelas de template se não existirem e corrige policies
-- Date: 2026-01-26

-- ============================================
-- FASE 1: Criar tabelas se não existirem
-- ============================================

-- Tabela de Templates de Mensagem
CREATE TABLE IF NOT EXISTS public.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  content TEXT NOT NULL,

  -- Variáveis disponíveis no template
  available_variables TEXT[] DEFAULT ARRAY['nome', 'empresa', 'email', 'telefone', 'origem', 'segmento', 'faturamento'],

  -- Estatísticas
  times_used INTEGER DEFAULT 0,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de vínculo Campanha-Templates (N:N)
CREATE TABLE IF NOT EXISTS public.campanha_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_template_per_campanha UNIQUE (campanha_id, template_id)
);

-- Tabela de Lotes de Disparo Agendado
CREATE TABLE IF NOT EXISTS public.campaign_dispatch_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.campaign_templates(id) ON DELETE CASCADE,

  -- Agendamento
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'processing', 'completed', 'failed', 'cancelled')),

  -- Filtro de leads (opcional)
  lead_filter JSONB DEFAULT NULL,

  -- Estatísticas
  total_leads INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,

  -- Auditoria
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- ============================================
-- FASE 2: Criar indexes se não existirem
-- ============================================

CREATE INDEX IF NOT EXISTS idx_campaign_templates_org ON public.campaign_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_templates_active ON public.campaign_templates(organization_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_campanha_templates_campanha ON public.campanha_templates(campanha_id);
CREATE INDEX IF NOT EXISTS idx_campanha_templates_template ON public.campanha_templates(template_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_status ON public.campaign_dispatch_batches(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_batches_campanha ON public.campaign_dispatch_batches(campanha_id);

-- ============================================
-- FASE 3: Habilitar RLS
-- ============================================

ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_dispatch_batches ENABLE ROW LEVEL SECURITY;

-- ============================================
-- FASE 4: Remover policies antigas
-- ============================================

DROP POLICY IF EXISTS "Admins can insert templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Admins can update templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Admins can delete templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Users can view org templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Members can insert templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Members can update templates" ON public.campaign_templates;
DROP POLICY IF EXISTS "Members can delete templates" ON public.campaign_templates;

DROP POLICY IF EXISTS "Admins can manage campanha templates" ON public.campanha_templates;
DROP POLICY IF EXISTS "Users can view campanha templates" ON public.campanha_templates;
DROP POLICY IF EXISTS "Members can manage campanha templates" ON public.campanha_templates;

DROP POLICY IF EXISTS "Admins can manage dispatch batches" ON public.campaign_dispatch_batches;
DROP POLICY IF EXISTS "Users can view dispatch batches" ON public.campaign_dispatch_batches;
DROP POLICY IF EXISTS "Members can manage dispatch batches" ON public.campaign_dispatch_batches;

-- ============================================
-- FASE 5: Criar novas policies (para membros)
-- ============================================

-- Policies para campaign_templates
CREATE POLICY "Users can view org templates" ON public.campaign_templates FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can insert templates" ON public.campaign_templates FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can update templates" ON public.campaign_templates FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can delete templates" ON public.campaign_templates FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

-- Policies para campanha_templates
CREATE POLICY "Users can view campanha templates" ON public.campanha_templates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campanhas c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE c.id = campanha_id AND tm.user_id = auth.uid()
  ));

CREATE POLICY "Members can manage campanha templates" ON public.campanha_templates FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.campanhas c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE c.id = campanha_id AND tm.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campanhas c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE c.id = campanha_id AND tm.user_id = auth.uid()
  ));

-- Policies para campaign_dispatch_batches
CREATE POLICY "Users can view dispatch batches" ON public.campaign_dispatch_batches FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can manage dispatch batches" ON public.campaign_dispatch_batches FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

-- ============================================
-- FIM DA MIGRATION
-- ============================================
