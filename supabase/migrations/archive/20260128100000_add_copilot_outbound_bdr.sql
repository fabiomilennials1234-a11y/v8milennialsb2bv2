-- Adicionar suporte a BDR/Outbound nos agentes Copilot
-- Permite que agentes iniciem conversas automaticamente com leads de campanhas

-- 1. Modo de operação (inbound, outbound, hybrid)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS operation_mode TEXT DEFAULT 'inbound' 
CHECK (operation_mode IN ('inbound', 'outbound', 'hybrid'));

-- 2. Gatilhos de ativação (condições IF para o agente entrar em ação)
-- Estrutura: { required: { tags: [], origins: [], has_phone: true }, optional: [...] }
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS activation_triggers JSONB DEFAULT NULL;

-- 3. Configuração de outbound
-- Estrutura: { delay_minutes: 5, first_message_template: "...", available_variables: [...] }
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS outbound_config JSONB DEFAULT NULL;

-- 4. Ações automáticas baseadas no resultado da conversa
-- Estrutura: { on_qualify: {...}, on_disqualify: {...}, on_need_human: {...} }
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS automation_actions JSONB DEFAULT NULL;

-- 5. Vincular agente a campanha específica (opcional)
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS campaign_id UUID DEFAULT NULL REFERENCES public.campanhas(id) ON DELETE SET NULL;

-- 6. Tabela para log de disparos de outbound
CREATE TABLE IF NOT EXISTS public.outbound_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.copilot_agents(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  
  -- Status do disparo
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  
  -- Mensagem enviada
  message_content TEXT,
  message_id TEXT, -- ID da mensagem no WhatsApp
  
  -- Timing
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  
  -- Metadados
  trigger_reason JSONB, -- Qual gatilho ativou
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_org ON public.outbound_dispatch_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_agent ON public.outbound_dispatch_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_lead ON public.outbound_dispatch_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_status ON public.outbound_dispatch_log(status);
CREATE INDEX IF NOT EXISTS idx_outbound_dispatch_scheduled ON public.outbound_dispatch_log(scheduled_at) WHERE status = 'pending';

-- RLS
ALTER TABLE public.outbound_dispatch_log ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Users can view their org outbound logs" ON public.outbound_dispatch_log;
CREATE POLICY "Users can view their org outbound logs" ON public.outbound_dispatch_log
  FOR SELECT USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can manage their org outbound logs" ON public.outbound_dispatch_log;
CREATE POLICY "Users can manage their org outbound logs" ON public.outbound_dispatch_log
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

-- Comentários
COMMENT ON COLUMN public.copilot_agents.operation_mode IS 'Modo de operação: inbound (espera lead), outbound (inicia conversa), hybrid (ambos)';
COMMENT ON COLUMN public.copilot_agents.activation_triggers IS 'Condições para ativação do agente: tags, origens, campos personalizados';
COMMENT ON COLUMN public.copilot_agents.outbound_config IS 'Configuração de outbound: delay, template da primeira mensagem';
COMMENT ON COLUMN public.copilot_agents.automation_actions IS 'Ações automáticas: on_qualify, on_disqualify, on_need_human';
COMMENT ON COLUMN public.copilot_agents.campaign_id IS 'Campanha vinculada ao agente (opcional)';
COMMENT ON TABLE public.outbound_dispatch_log IS 'Log de disparos de mensagens outbound';
