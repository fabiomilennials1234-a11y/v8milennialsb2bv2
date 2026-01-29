-- Enum para tipos de produto
CREATE TYPE public.product_type AS ENUM ('mrr', 'projeto');

-- Enum para origem do lead
CREATE TYPE public.lead_origin AS ENUM ('calendly', 'whatsapp', 'meta_ads', 'outro');

-- Enum para status do Pipe 1 - Confirmação
CREATE TYPE public.pipe_confirmacao_status AS ENUM (
  'reuniao_marcada',
  'confirmar_d3',
  'confirmar_d1',
  'pre_confirmada',
  'confirmacao_no_dia',
  'confirmada_no_dia',
  'compareceu',
  'perdido'
);

-- Enum para status do Pipe 2 - Propostas
CREATE TYPE public.pipe_propostas_status AS ENUM (
  'marcar_compromisso',
  'compromisso_marcado',
  'esfriou',
  'futuro',
  'vendido',
  'perdido'
);

-- Enum para status do Pipe 3 - WhatsApp SDR
CREATE TYPE public.pipe_whatsapp_status AS ENUM (
  'novo',
  'em_contato',
  'agendado',
  'compareceu'
);

-- Enum para roles de usuário
CREATE TYPE public.app_role AS ENUM ('admin', 'sdr', 'closer');

-- Tabela de perfis de usuário
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de roles de usuário (separada por segurança)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Tabela de equipe (SDRs e Closers)
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role app_role NOT NULL,
  ote_base DECIMAL(10,2) DEFAULT 0,
  ote_bonus DECIMAL(10,2) DEFAULT 0,
  commission_mrr_percent DECIMAL(5,2) DEFAULT 1.0,
  commission_projeto_percent DECIMAL(5,2) DEFAULT 0.5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de leads
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  origin lead_origin NOT NULL DEFAULT 'outro',
  utm_campaign TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_content TEXT,
  utm_term TEXT,
  rating INTEGER CHECK (rating >= 0 AND rating <= 10) DEFAULT 0,
  faturamento DECIMAL(12,2),
  urgency TEXT,
  segment TEXT,
  sdr_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  closer_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de tags
CREATE TABLE public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#F5C518',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de relacionamento lead-tags
CREATE TABLE public.lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, tag_id)
);

-- Tabela de histórico do lead
CREATE TABLE public.lead_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela Pipe 1 - Confirmação de Reunião
CREATE TABLE public.pipe_confirmacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status pipe_confirmacao_status NOT NULL DEFAULT 'reuniao_marcada',
  meeting_date TIMESTAMPTZ,
  sdr_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  closer_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela Pipe 2 - Gestão de Propostas
CREATE TABLE public.pipe_propostas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status pipe_propostas_status NOT NULL DEFAULT 'marcar_compromisso',
  product_type product_type,
  sale_value DECIMAL(12,2),
  contract_duration INTEGER,
  closer_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  commitment_date TIMESTAMPTZ,
  notes TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela Pipe 3 - Leads WhatsApp SDR
CREATE TABLE public.pipe_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status pipe_whatsapp_status NOT NULL DEFAULT 'novo',
  sdr_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  scheduled_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Metas
CREATE TABLE public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  target_value DECIMAL(12,2) NOT NULL,
  current_value DECIMAL(12,2) DEFAULT 0,
  team_member_id UUID REFERENCES public.team_members(id) ON DELETE CASCADE,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Premiações
CREATE TABLE public.awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  threshold DECIMAL(12,2) NOT NULL,
  prize_value DECIMAL(12,2),
  prize_description TEXT,
  month INTEGER,
  year INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de Comissões
CREATE TABLE public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  pipe_proposta_id UUID REFERENCES public.pipe_propostas(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL,
  type product_type NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de leads perdidos para reativação
CREATE TABLE public.leads_reativacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  reason TEXT,
  original_pipe TEXT,
  reactivation_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipe_confirmacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipe_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipe_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_reativacao ENABLE ROW LEVEL SECURITY;

-- Função para verificar role (evita recursão em RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Função para verificar se é membro do time autenticado
CREATE OR REPLACE FUNCTION public.is_team_member(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
  )
$$;

-- RLS Policies para profiles
CREATE POLICY "Profiles são visíveis para usuários autenticados"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários podem atualizar próprio perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Usuários podem inserir próprio perfil"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- RLS Policies para user_roles (apenas admins podem gerenciar)
CREATE POLICY "Roles visíveis para autenticados"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Apenas admins podem inserir roles"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Apenas admins podem deletar roles"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para team_members
CREATE POLICY "Team members visíveis para autenticados"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Apenas admins podem gerenciar team members"
  ON public.team_members FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para leads (todos do time podem ver e editar)
CREATE POLICY "Leads visíveis para autenticados"
  ON public.leads FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar leads"
  ON public.leads FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- RLS Policies para tags
CREATE POLICY "Tags visíveis para autenticados"
  ON public.tags FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Apenas admins podem gerenciar tags"
  ON public.tags FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para lead_tags
CREATE POLICY "Lead tags visíveis para autenticados"
  ON public.lead_tags FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar lead tags"
  ON public.lead_tags FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- RLS Policies para lead_history
CREATE POLICY "Lead history visível para autenticados"
  ON public.lead_history FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem inserir histórico"
  ON public.lead_history FOR INSERT
  TO authenticated
  WITH CHECK (public.is_team_member(auth.uid()));

-- RLS Policies para pipe_confirmacao
CREATE POLICY "Pipe confirmação visível para autenticados"
  ON public.pipe_confirmacao FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar pipe confirmação"
  ON public.pipe_confirmacao FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- RLS Policies para pipe_propostas
CREATE POLICY "Pipe propostas visível para autenticados"
  ON public.pipe_propostas FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar pipe propostas"
  ON public.pipe_propostas FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- RLS Policies para pipe_whatsapp
CREATE POLICY "Pipe WhatsApp visível para autenticados"
  ON public.pipe_whatsapp FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar pipe WhatsApp"
  ON public.pipe_whatsapp FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- RLS Policies para goals
CREATE POLICY "Goals visíveis para autenticados"
  ON public.goals FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Apenas admins podem gerenciar goals"
  ON public.goals FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para awards
CREATE POLICY "Awards visíveis para autenticados"
  ON public.awards FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Apenas admins podem gerenciar awards"
  ON public.awards FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para commissions
CREATE POLICY "Usuários podem ver próprias comissões"
  ON public.commissions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    team_member_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Apenas admins podem gerenciar comissões"
  ON public.commissions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies para leads_reativacao
CREATE POLICY "Leads reativação visíveis para autenticados"
  ON public.leads_reativacao FOR SELECT
  TO authenticated
  USING (public.is_team_member(auth.uid()));

CREATE POLICY "Team members podem gerenciar leads reativação"
  ON public.leads_reativacao FOR ALL
  TO authenticated
  USING (public.is_team_member(auth.uid()));

-- Trigger para criar perfil automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_pipe_confirmacao_updated_at
  BEFORE UPDATE ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_pipe_propostas_updated_at
  BEFORE UPDATE ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_pipe_whatsapp_updated_at
  BEFORE UPDATE ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_goals_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Enable realtime para tabelas principais
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipe_confirmacao;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipe_propostas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pipe_whatsapp;
ALTER PUBLICATION supabase_realtime ADD TABLE public.goals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.commissions;