-- Migration: Link Copilot Agent to WhatsApp Instance
-- Description: Permite vincular um agente Copilot a uma instância específica de WhatsApp
-- Assim, cada instância pode ter seu próprio agente de IA

-- 1. Adicionar campo whatsapp_instance_id na tabela copilot_agents
ALTER TABLE public.copilot_agents 
ADD COLUMN IF NOT EXISTS whatsapp_instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

-- 2. Adicionar campo agent_id na tabela whatsapp_instances (relação inversa para facilitar queries)
ALTER TABLE public.whatsapp_instances
ADD COLUMN IF NOT EXISTS copilot_agent_id UUID REFERENCES public.copilot_agents(id) ON DELETE SET NULL;

-- 3. Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_copilot_agents_whatsapp_instance 
  ON public.copilot_agents(whatsapp_instance_id) 
  WHERE whatsapp_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_agent 
  ON public.whatsapp_instances(copilot_agent_id) 
  WHERE copilot_agent_id IS NOT NULL;

-- 4. Comentários explicativos
COMMENT ON COLUMN public.copilot_agents.whatsapp_instance_id IS 'Instância de WhatsApp onde este agente está ativo. Se NULL, não responde automaticamente.';
COMMENT ON COLUMN public.whatsapp_instances.copilot_agent_id IS 'Agente Copilot vinculado a esta instância. Se NULL, mensagens não são processadas por IA.';

-- 5. Garantir que tabela conversations existe (caso migração anterior não tenha rodado)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'NEW_LEAD',
  turn_count INT DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  context JSONB DEFAULT '{}',
  short_term_memory JSONB DEFAULT '[]',
  long_term_memory JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id)
);

-- 6. Garantir que tabela conversation_messages existe
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Garantir que tabela agent_decision_logs existe
CREATE TABLE IF NOT EXISTS public.agent_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  state_before TEXT,
  state_after TEXT,
  action_decided TEXT,
  reasoning TEXT,
  capabilities_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Criar índices para as tabelas de conversação
CREATE INDEX IF NOT EXISTS idx_conversations_org ON public.conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON public.conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_state ON public.conversations(state);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv ON public.conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_decision_logs_conv ON public.agent_decision_logs(conversation_id);

-- 9. Habilitar RLS nas tabelas
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_decision_logs ENABLE ROW LEVEL SECURITY;

-- 10. Criar policies permissivas para service role (Edge Functions)
DO $$
BEGIN
  -- Conversations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_conversations_all' AND tablename = 'conversations') THEN
    CREATE POLICY "service_role_conversations_all" ON public.conversations FOR ALL USING (true);
  END IF;
  
  -- Conversation Messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_conv_messages_all' AND tablename = 'conversation_messages') THEN
    CREATE POLICY "service_role_conv_messages_all" ON public.conversation_messages FOR ALL USING (true);
  END IF;
  
  -- Agent Decision Logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_decision_logs_all' AND tablename = 'agent_decision_logs') THEN
    CREATE POLICY "service_role_decision_logs_all" ON public.agent_decision_logs FOR ALL USING (true);
  END IF;
END $$;

-- 11. Função para vincular agente a instância (usada pela UI)
CREATE OR REPLACE FUNCTION public.link_agent_to_instance(
  p_agent_id UUID,
  p_instance_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Remover vínculo anterior do agente
  UPDATE public.copilot_agents SET whatsapp_instance_id = NULL WHERE whatsapp_instance_id = p_instance_id;
  
  -- Remover vínculo anterior da instância
  UPDATE public.whatsapp_instances SET copilot_agent_id = NULL WHERE copilot_agent_id = p_agent_id;
  
  -- Criar novo vínculo (bidirecional)
  UPDATE public.copilot_agents SET whatsapp_instance_id = p_instance_id WHERE id = p_agent_id;
  UPDATE public.whatsapp_instances SET copilot_agent_id = p_agent_id WHERE id = p_instance_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. Função para desvincular agente de instância
CREATE OR REPLACE FUNCTION public.unlink_agent_from_instance(
  p_agent_id UUID
) RETURNS VOID AS $$
DECLARE
  v_instance_id UUID;
BEGIN
  -- Buscar instância vinculada
  SELECT whatsapp_instance_id INTO v_instance_id FROM public.copilot_agents WHERE id = p_agent_id;
  
  -- Remover vínculos
  UPDATE public.copilot_agents SET whatsapp_instance_id = NULL WHERE id = p_agent_id;
  IF v_instance_id IS NOT NULL THEN
    UPDATE public.whatsapp_instances SET copilot_agent_id = NULL WHERE id = v_instance_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
