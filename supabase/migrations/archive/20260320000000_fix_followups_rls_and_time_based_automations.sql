-- ============================================
-- MIGRAÇÃO: Fix Follow-ups RLS + Automações baseadas em tempo
-- ============================================
-- 1. Corrige RLS para Closers/SDRs verem suas revisões
-- 2. Adiciona novos campos para automações baseadas em tempo
-- 3. Cria tabela de log para evitar duplicatas
-- ============================================

-- ============================================
-- PARTE 0: GARANTIR QUE FUNÇÕES AUXILIARES EXISTAM
-- ============================================

-- Função para obter organization_id do usuário atual
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
  AND is_active = true
  LIMIT 1
$$;

-- ============================================
-- PARTE 1: CORRIGIR RLS DA TABELA FOLLOW_UPS
-- ============================================

-- Remove a política antiga que dependia exclusivamente da tabela leads
DROP POLICY IF EXISTS "follow_ups_via_lead" ON follow_ups;

-- Remove política duplicada se existir (evita erro ao re-rodar)
DROP POLICY IF EXISTS "follow_ups_org_direct" ON follow_ups;

-- Cria política direta por organization_id (não depende mais da tabela leads)
CREATE POLICY "follow_ups_org_direct"
  ON follow_ups FOR ALL
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- PARTE 2: NOVOS CAMPOS NA TABELA follow_up_automations
-- ============================================

-- Tipo de gatilho: stage_change (existente), no_response_from_team, no_response_from_lead, not_confirmed
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'stage_change'
  CHECK (trigger_type IN ('stage_change', 'no_response_from_team', 'no_response_from_lead', 'not_confirmed'));

-- Tempo de espera em horas para disparar (para gatilhos baseados em tempo)
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS trigger_delay_hours INTEGER NOT NULL DEFAULT 0;

-- Tempo de espera em minutos (complementar às horas)
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS trigger_delay_minutes INTEGER NOT NULL DEFAULT 0;

-- Máximo de revisões criadas por lead para esta regra (evita spam)
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS max_triggers_per_lead INTEGER NOT NULL DEFAULT 3;

-- Se o copiloto pode resolver esta revisão automaticamente
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS copilot_can_handle BOOLEAN NOT NULL DEFAULT false;

-- Organization_id para multi-tenancy nas automações
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Etapas filtro (para regras baseadas em tempo que se aplicam a etapas específicas)
-- Armazena como array de TEXT, ex: ['novo', 'em_contato']
ALTER TABLE public.follow_up_automations
  ADD COLUMN IF NOT EXISTS filter_stages TEXT[];

-- Remover a constraint UNIQUE antiga que não contempla os novos tipos
-- e criar uma nova que inclui trigger_type
ALTER TABLE public.follow_up_automations
  DROP CONSTRAINT IF EXISTS follow_up_automations_pipe_type_stage_title_template_key;

-- Nova constraint única para stage_change (pipe_type + stage + title + trigger_type)
-- Para regras baseadas em tempo, a combinação é (org + pipe_type + trigger_type + title)
CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_automations_stage_unique
  ON public.follow_up_automations (pipe_type, stage, title_template, trigger_type)
  WHERE trigger_type = 'stage_change';

-- Índice para busca de regras baseadas em tempo por organização
CREATE INDEX IF NOT EXISTS idx_followup_automations_time_based
  ON public.follow_up_automations (organization_id, trigger_type, is_active)
  WHERE trigger_type != 'stage_change';

-- ============================================
-- PARTE 3: TABELA DE LOG PARA EVITAR DUPLICATAS
-- ============================================

-- Registra cada vez que uma regra baseada em tempo cria uma revisão para um lead
CREATE TABLE IF NOT EXISTS public.followup_automation_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES public.follow_up_automations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  follow_up_id UUID REFERENCES public.follow_ups(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índice para busca rápida de contagem por lead + automação
CREATE INDEX IF NOT EXISTS idx_followup_automation_log_lead_rule
  ON public.followup_automation_log (lead_id, automation_id);

-- Índice para busca por organização
CREATE INDEX IF NOT EXISTS idx_followup_automation_log_org
  ON public.followup_automation_log (organization_id);

-- RLS
ALTER TABLE public.followup_automation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "followup_automation_log_org"
  ON public.followup_automation_log FOR ALL
  TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- ============================================
-- PARTE 4: RPC PARA BUSCAR LEADS ELEGÍVEIS (Regras baseadas em tempo)
-- ============================================

-- Busca leads onde NÓS não respondemos (última mensagem é INCOMING e passou X tempo)
CREATE OR REPLACE FUNCTION public.get_leads_team_no_response(
  p_organization_id UUID,
  p_delay_hours INTEGER,
  p_delay_minutes INTEGER,
  p_pipe_type TEXT DEFAULT NULL,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  last_incoming_at TIMESTAMPTZ,
  phone_number TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      wm.lead_id,
      wm.phone_number,
      wm.direction,
      wm.timestamp,
      ROW_NUMBER() OVER (PARTITION BY wm.lead_id ORDER BY wm.timestamp DESC) AS rn
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_organization_id
      AND wm.lead_id IS NOT NULL
      AND wm.phone_number IS NOT NULL
  )
  SELECT
    lm.lead_id,
    lm.timestamp AS last_incoming_at,
    lm.phone_number
  FROM last_msg lm
  INNER JOIN leads l ON l.id = lm.lead_id
  WHERE lm.rn = 1
    AND lm.direction = 'incoming'
    AND (NOW() - lm.timestamp) >= (
      (p_delay_hours || ' hours')::interval +
      (p_delay_minutes || ' minutes')::interval
    )
    -- Filtro opcional por pipe_type
    AND (p_pipe_type IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp IS NOT NULL
        WHEN 'confirmacao' THEN EXISTS (SELECT 1 FROM pipe_confirmacao pc WHERE pc.lead_id = l.id)
        WHEN 'propostas' THEN EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id)
        ELSE TRUE
      END
    ))
    -- Filtro opcional por etapas específicas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp::text = ANY(p_filter_stages)
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipe_confirmacao pc
          WHERE pc.lead_id = l.id AND pc.status::text = ANY(p_filter_stages)
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipe_propostas pp
          WHERE pp.lead_id = l.id AND pp.status::text = ANY(p_filter_stages)
        )
        ELSE TRUE
      END
    ));
$$;

-- Busca leads onde O LEAD não nos respondeu (última mensagem é OUTGOING e passou X tempo)
CREATE OR REPLACE FUNCTION public.get_leads_no_response_from_lead(
  p_organization_id UUID,
  p_delay_hours INTEGER,
  p_delay_minutes INTEGER,
  p_pipe_type TEXT DEFAULT NULL,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  last_outgoing_at TIMESTAMPTZ,
  phone_number TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      wm.lead_id,
      wm.phone_number,
      wm.direction,
      wm.timestamp,
      ROW_NUMBER() OVER (PARTITION BY wm.lead_id ORDER BY wm.timestamp DESC) AS rn
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_organization_id
      AND wm.lead_id IS NOT NULL
      AND wm.phone_number IS NOT NULL
  )
  SELECT
    lm.lead_id,
    lm.timestamp AS last_outgoing_at,
    lm.phone_number
  FROM last_msg lm
  INNER JOIN leads l ON l.id = lm.lead_id
  WHERE lm.rn = 1
    AND lm.direction = 'outgoing'
    AND (NOW() - lm.timestamp) >= (
      (p_delay_hours || ' hours')::interval +
      (p_delay_minutes || ' minutes')::interval
    )
    AND (p_pipe_type IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp IS NOT NULL
        WHEN 'confirmacao' THEN EXISTS (SELECT 1 FROM pipe_confirmacao pc WHERE pc.lead_id = l.id)
        WHEN 'propostas' THEN EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id)
        ELSE TRUE
      END
    ))
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL OR (
      CASE p_pipe_type
        WHEN 'whatsapp' THEN l.pipe_whatsapp::text = ANY(p_filter_stages)
        WHEN 'confirmacao' THEN EXISTS (
          SELECT 1 FROM pipe_confirmacao pc
          WHERE pc.lead_id = l.id AND pc.status::text = ANY(p_filter_stages)
        )
        WHEN 'propostas' THEN EXISTS (
          SELECT 1 FROM pipe_propostas pp
          WHERE pp.lead_id = l.id AND pp.status::text = ANY(p_filter_stages)
        )
        ELSE TRUE
      END
    ));
$$;

-- Busca leads que NÃO CONFIRMARAM reunião (no funil de confirmação, reunião próxima sem confirmação)
CREATE OR REPLACE FUNCTION public.get_leads_not_confirmed(
  p_organization_id UUID,
  p_hours_before_meeting INTEGER,
  p_minutes_before_meeting INTEGER,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  meeting_date TIMESTAMPTZ,
  confirmacao_id UUID,
  current_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pc.lead_id,
    pc.meeting_date,
    pc.id AS confirmacao_id,
    pc.status::text AS current_status
  FROM pipe_confirmacao pc
  INNER JOIN leads l ON l.id = pc.lead_id AND l.organization_id = p_organization_id
  WHERE pc.meeting_date IS NOT NULL
    -- Reunião está no futuro mas dentro da janela de alerta
    AND pc.meeting_date > NOW()
    AND pc.meeting_date <= NOW() + (
      (p_hours_before_meeting || ' hours')::interval +
      (p_minutes_before_meeting || ' minutes')::interval
    )
    -- Status indica que NÃO confirmou ainda
    AND pc.status::text NOT IN ('confirmada_no_dia', 'compareceu', 'perdido')
    -- Filtro opcional por etapas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL
         OR pc.status::text = ANY(p_filter_stages));
$$;
