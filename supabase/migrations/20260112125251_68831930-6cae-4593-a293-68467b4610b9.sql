-- Add "calor" (heat) field to pipe_propostas table for lead priority scoring
ALTER TABLE public.pipe_propostas 
ADD COLUMN calor integer DEFAULT 5 CHECK (calor >= 0 AND calor <= 10);

-- Add comment to explain the field
COMMENT ON COLUMN public.pipe_propostas.calor IS 'Heat score (0-10) indicating probability of closing this month. Higher = more likely to close.';

-- Add "acoes_do_dia" table for daily action tasks
CREATE TABLE public.acoes_do_dia (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  proposta_id UUID REFERENCES public.pipe_propostas(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  confirmacao_id UUID REFERENCES public.pipe_confirmacao(id) ON DELETE SET NULL,
  follow_up_id UUID REFERENCES public.follow_ups(id) ON DELETE SET NULL,
  is_completed BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.acoes_do_dia ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only see their own daily actions
CREATE POLICY "Users can view their own daily actions" 
ON public.acoes_do_dia 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own daily actions" 
ON public.acoes_do_dia 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily actions" 
ON public.acoes_do_dia 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own daily actions" 
ON public.acoes_do_dia 
FOR DELETE 
USING (auth.uid() = user_id);

-- Enable realtime for daily actions
ALTER PUBLICATION supabase_realtime ADD TABLE public.acoes_do_dia;