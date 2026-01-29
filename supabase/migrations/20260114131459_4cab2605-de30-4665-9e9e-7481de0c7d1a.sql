-- Create lead_scores table for AI-powered lead scoring
CREATE TABLE public.lead_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 50 CHECK (score >= 0 AND score <= 100),
  factors JSONB DEFAULT '{}',
  predicted_conversion INTEGER DEFAULT 0 CHECK (predicted_conversion >= 0 AND predicted_conversion <= 100),
  recommended_action TEXT,
  last_calculated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id)
);

-- Enable RLS
ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Lead scores visíveis para autenticados"
ON public.lead_scores
FOR SELECT
USING (is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar lead scores"
ON public.lead_scores
FOR ALL
USING (is_team_member(auth.uid()));

-- Create trigger for updated_at
CREATE TRIGGER update_lead_scores_updated_at
BEFORE UPDATE ON public.lead_scores
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Enable realtime for lead_scores
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_scores;

-- Create index for faster lookups
CREATE INDEX idx_lead_scores_lead_id ON public.lead_scores(lead_id);
CREATE INDEX idx_lead_scores_score ON public.lead_scores(score DESC);