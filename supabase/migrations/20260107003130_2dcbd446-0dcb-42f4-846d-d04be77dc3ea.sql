-- Create follow_ups table for task management
CREATE TABLE public.follow_ups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.team_members(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  source_pipe TEXT CHECK (source_pipe IN ('whatsapp', 'confirmacao', 'propostas')),
  source_pipe_id UUID,
  is_automated BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create follow_up_automations table for default tasks per stage
CREATE TABLE public.follow_up_automations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipe_type TEXT NOT NULL CHECK (pipe_type IN ('whatsapp', 'confirmacao', 'propostas')),
  stage TEXT NOT NULL,
  title_template TEXT NOT NULL,
  description_template TEXT,
  days_offset INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pipe_type, stage, title_template)
);

-- Enable RLS
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_automations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for follow_ups
CREATE POLICY "Follow ups visíveis para autenticados" 
ON public.follow_ups 
FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar follow ups" 
ON public.follow_ups 
FOR ALL 
USING (is_team_member(auth.uid()));

-- RLS Policies for follow_up_automations
CREATE POLICY "Automações visíveis para autenticados" 
ON public.follow_up_automations 
FOR SELECT 
USING (is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar automações" 
ON public.follow_up_automations 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Triggers for updated_at
CREATE TRIGGER update_follow_ups_updated_at
BEFORE UPDATE ON public.follow_ups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_follow_up_automations_updated_at
BEFORE UPDATE ON public.follow_up_automations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Insert default automations
INSERT INTO public.follow_up_automations (pipe_type, stage, title_template, description_template, days_offset, priority) VALUES
('whatsapp', 'novo', 'Primeiro contato com lead', 'Realizar primeiro contato via WhatsApp', 0, 'high'),
('whatsapp', 'em_contato', 'Follow up de qualificação', 'Continuar qualificação do lead', 1, 'normal'),
('whatsapp', 'agendado', 'Confirmar agendamento', 'Confirmar presença na reunião agendada', 0, 'high'),
('confirmacao', 'reuniao_marcada', 'Lembrete de reunião', 'Enviar lembrete da reunião', 0, 'urgent'),
('confirmacao', 'confirmado', 'Preparar material', 'Preparar apresentação para a reunião', 0, 'normal'),
('propostas', 'marcar_compromisso', 'Agendar apresentação', 'Entrar em contato para agendar apresentação', 0, 'high'),
('propostas', 'proposta_enviada', 'Follow up da proposta', 'Verificar recebimento e dúvidas sobre proposta', 2, 'normal'),
('propostas', 'negociacao', 'Negociação em andamento', 'Dar continuidade na negociação', 1, 'high');