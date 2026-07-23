-- Migration: Create Conversation Summaries Table
-- Description: Armazena resumos de conversas gerados pela IA para visualização interna
-- Date: 2026-01-27

-- Tabela para armazenar resumos de conversas
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Resumo principal
  summary TEXT NOT NULL,
  
  -- Pontos-chave extraídos (array de strings)
  key_points JSONB DEFAULT '[]',
  
  -- Análise de sentimento
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  
  -- Temperatura do lead
  lead_temperature TEXT CHECK (lead_temperature IN ('cold', 'warm', 'hot')),
  
  -- Objeções identificadas
  objections JSONB DEFAULT '[]',
  
  -- Perguntas feitas pelo lead
  questions_asked JSONB DEFAULT '[]',
  
  -- Próxima ação sugerida
  next_action TEXT,
  
  -- Contagem de mensagens no momento do resumo
  message_count INT DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_lead ON public.conversation_summaries(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_org ON public.conversation_summaries(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conv ON public.conversation_summaries(conversation_id);

-- Trigger para updated_at
CREATE TRIGGER update_conversation_summaries_updated_at
  BEFORE UPDATE ON public.conversation_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

-- Policy: Usuários podem visualizar resumos da sua organização
CREATE POLICY "Users can view summaries from their organization"
  ON public.conversation_summaries FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

-- Policy: Service role pode gerenciar resumos (para Edge Functions)
CREATE POLICY "Service role can manage summaries"
  ON public.conversation_summaries FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comentários para documentação
COMMENT ON TABLE public.conversation_summaries IS 'Resumos de conversas com leads gerados pela IA para visualização interna';
COMMENT ON COLUMN public.conversation_summaries.summary IS 'Resumo textual da conversa gerado pela IA';
COMMENT ON COLUMN public.conversation_summaries.key_points IS 'Array de pontos-chave extraídos da conversa';
COMMENT ON COLUMN public.conversation_summaries.sentiment IS 'Sentimento geral detectado na conversa (positive, neutral, negative)';
COMMENT ON COLUMN public.conversation_summaries.lead_temperature IS 'Temperatura/interesse do lead (cold, warm, hot)';
COMMENT ON COLUMN public.conversation_summaries.objections IS 'Array de objeções levantadas pelo lead';
COMMENT ON COLUMN public.conversation_summaries.questions_asked IS 'Array de perguntas feitas pelo lead';
COMMENT ON COLUMN public.conversation_summaries.next_action IS 'Próxima ação sugerida baseada na conversa';
