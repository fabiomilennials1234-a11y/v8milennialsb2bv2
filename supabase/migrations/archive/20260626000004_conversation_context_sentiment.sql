-- Item #17: Análise de sentimento com persistência
-- Adiciona coluna sentiment à tabela conversation_context_summary

ALTER TABLE public.conversation_context_summary
  ADD COLUMN IF NOT EXISTS sentiment text DEFAULT 'neutral'
    CHECK (sentiment IN ('positive', 'neutral', 'negative'));

COMMENT ON COLUMN public.conversation_context_summary.sentiment IS
  'Sentimento detectado heuristicamente na última mensagem do lead: positive, neutral ou negative.';
