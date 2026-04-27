-- Add coaching_tips column to conversation_summaries
-- Stores actionable sales coaching tips from the AI specialist

ALTER TABLE public.conversation_summaries
  ADD COLUMN IF NOT EXISTS coaching_tips JSONB DEFAULT '[]';

COMMENT ON COLUMN public.conversation_summaries.coaching_tips
  IS 'Array de dicas práticas de coaching comercial geradas pela IA';
