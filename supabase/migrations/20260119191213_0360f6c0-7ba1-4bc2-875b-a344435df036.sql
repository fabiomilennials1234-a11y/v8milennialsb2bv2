-- Campanhas table
CREATE TABLE public.campanhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  team_goal INTEGER NOT NULL DEFAULT 30,
  individual_goal INTEGER DEFAULT 10,
  bonus_value NUMERIC DEFAULT 500,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Campaign stages (custom per campaign)
CREATE TABLE public.campanha_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3B82F6',
  position INTEGER NOT NULL DEFAULT 0,
  is_reuniao_marcada BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Which team members have access to which campaigns
CREATE TABLE public.campanha_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  meetings_count INTEGER DEFAULT 0,
  bonus_earned BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(campanha_id, team_member_id)
);

-- Leads in campaigns
CREATE TABLE public.campanha_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.campanha_stages(id) ON DELETE CASCADE,
  sdr_id UUID REFERENCES public.team_members(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_leads ENABLE ROW LEVEL SECURITY;

-- RLS Policies for campanhas
CREATE POLICY "Campanhas visíveis para team members" 
ON public.campanhas FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar campanhas" 
ON public.campanhas FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for campanha_stages
CREATE POLICY "Stages visíveis para team members" 
ON public.campanha_stages FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar stages" 
ON public.campanha_stages FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for campanha_members
CREATE POLICY "Members visíveis para team members" 
ON public.campanha_members FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar members" 
ON public.campanha_members FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for campanha_leads
CREATE POLICY "Leads visíveis para team members" 
ON public.campanha_leads FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar campanha leads" 
ON public.campanha_leads FOR ALL 
USING (is_team_member(auth.uid()));

-- Enable realtime for campanha_leads
ALTER PUBLICATION supabase_realtime ADD TABLE public.campanha_leads;

-- Add trigger for updated_at on campanhas
CREATE TRIGGER update_campanhas_updated_at
BEFORE UPDATE ON public.campanhas
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Add trigger for updated_at on campanha_leads
CREATE TRIGGER update_campanha_leads_updated_at
BEFORE UPDATE ON public.campanha_leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();