-- ============================================================================
-- ETAPA 1: Refatoração completa de Roles e Permissões
-- ============================================================================
-- Objetivo: simplificar o enum app_role para apenas 'admin' e 'member',
-- adicionar job_title e metric_type em team_members, e criar o novo
-- sistema de feature_permissions + member_feature_permissions.
-- ============================================================================

-- ─── 1.0 Limpar team_members órfãos (user_id aponta para auth.users deletado) ──
-- Sem isso, qualquer UPDATE em team_members falha por FK constraint.
UPDATE public.team_members
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM auth.users);

-- NOTA: 'member' já adicionado ao enum app_role pela migration anterior
-- (20260803000000_add_member_enum_value.sql)

-- ─── 1.2 Adicionar campos novos em team_members ────────────────────────────
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS metric_type TEXT DEFAULT 'meetings'
    CHECK (metric_type IN ('meetings', 'sales'));

-- Migrar job_title a partir do role antigo (ANTES de migrar roles)
UPDATE public.team_members SET job_title = 'Closer'  WHERE role = 'closer'  AND job_title IS NULL;
UPDATE public.team_members SET job_title = 'SDR'     WHERE role = 'sdr'     AND job_title IS NULL;
UPDATE public.team_members SET job_title = 'BDR'     WHERE role = 'bdr'     AND job_title IS NULL;
UPDATE public.team_members SET job_title = 'Cliente'  WHERE role = 'cliente' AND job_title IS NULL;
UPDATE public.team_members SET job_title = 'Agency'   WHERE role = 'agency'  AND job_title IS NULL;
UPDATE public.team_members SET job_title = 'Admin'    WHERE role = 'admin'   AND job_title IS NULL;

-- Migrar metric_type
UPDATE public.team_members SET metric_type = 'sales'    WHERE role IN ('closer', 'agency') AND metric_type IS NULL;
UPDATE public.team_members SET metric_type = 'meetings' WHERE role IN ('sdr', 'bdr')       AND metric_type IS NULL;
UPDATE public.team_members SET metric_type = 'meetings' WHERE metric_type IS NULL;

-- ─── 1.1b Migrar dados de roles (agency→admin, sdr/closer/bdr/cliente→member) ──
-- team_members
UPDATE public.team_members SET role = 'admin'  WHERE role = 'agency';
UPDATE public.team_members SET role = 'member' WHERE role IN ('sdr', 'closer', 'bdr', 'cliente');

-- user_roles (tabela deprecated mas ainda syncada via trigger)
-- Primeiro, deletar linhas agency/sdr/closer/bdr/cliente que já têm duplicata com o role alvo
DELETE FROM public.user_roles
  WHERE role = 'agency'
    AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin');
DELETE FROM public.user_roles
  WHERE role IN ('sdr', 'closer', 'bdr', 'cliente')
    AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'member');
-- Depois, migrar os restantes
UPDATE public.user_roles SET role = 'admin'  WHERE role = 'agency';
UPDATE public.user_roles SET role = 'member' WHERE role IN ('sdr', 'closer', 'bdr', 'cliente');

-- ─── 1.3 Criar tabela feature_permissions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  module        TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  is_admin_only BOOLEAN NOT NULL DEFAULT false,
  default_value BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.feature_permissions ENABLE ROW LEVEL SECURITY;

-- Qualquer usuário autenticado pode ler
CREATE POLICY "anyone_can_read_features"
  ON public.feature_permissions FOR SELECT
  USING (true);

-- Apenas master pode gerenciar
CREATE POLICY "master_can_manage_features"
  ON public.feature_permissions FOR ALL
  USING (public.is_master_user());

-- ─── 1.4 Criar tabela member_feature_permissions ───────────────────────────
CREATE TABLE IF NOT EXISTS public.member_feature_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id  UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key     TEXT NOT NULL REFERENCES public.feature_permissions(key),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_member_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_member_features_member ON public.member_feature_permissions(team_member_id);
CREATE INDEX IF NOT EXISTS idx_member_features_org    ON public.member_feature_permissions(organization_id, feature_key);

ALTER TABLE public.member_feature_permissions ENABLE ROW LEVEL SECURITY;

-- Admin da org pode gerenciar
CREATE POLICY "admin_manage_member_features"
  ON public.member_feature_permissions FOR ALL
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.is_active = true
    )
  );

-- Membro pode ler suas próprias permissões
CREATE POLICY "member_read_own_features"
  ON public.member_feature_permissions FOR SELECT
  USING (
    team_member_id IN (
      SELECT tm.id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
  );

-- Master pode tudo
CREATE POLICY "master_manage_member_features"
  ON public.member_feature_permissions FOR ALL
  USING (public.is_master_user());

-- ─── 1.5 Popular feature_permissions ───────────────────────────────────────
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order) VALUES

-- MÓDULO: Leads
('leads.view',          'Leads', 'Ver leads',           'Acessa a página de leads e visualiza a lista', false, true,  10),
('leads.create',        'Leads', 'Criar lead',           'Cria novos leads manualmente', false, true,  20),
('leads.edit',          'Leads', 'Editar lead',          'Edita informações de leads existentes', false, true,  30),
('leads.delete',        'Leads', 'Excluir lead',         'Exclui leads permanentemente', false, false, 40),
('leads.import',        'Leads', 'Importar leads',       'Faz upload de CSV/Excel para importar leads em lote', false, true,  50),
('leads.export',        'Leads', 'Exportar leads',       'Exporta leads para CSV/Excel', false, false, 60),
('leads.view_all',      'Leads', 'Ver leads de todos',   'Vê leads atribuídos a outros membros. Se desabilitado, vê apenas os próprios', false, false, 70),

-- MÓDULO: Pipeline
('pipeline.view',            'Pipeline', 'Ver funis',                    'Acessa os funis de qualificação, confirmação e propostas', false, true,  10),
('pipeline.move_cards',      'Pipeline', 'Mover cards',                  'Arrasta cards entre estágios nos funis', false, true,  20),
('pipeline.delete_cards',    'Pipeline', 'Excluir cards',                'Remove cards dos funis', false, false, 30),
('pipeline.delete_all_stage','Pipeline', 'Excluir todos de um estágio',  'Limpa todos os cards de um estágio de uma vez. Ação irreversível', false, false, 40),
('pipeline.configure',       'Pipeline', 'Configurar funis',             'Altera configurações, estágios e regras dos funis', true,  true,  50),
('pipeline.custom_create',   'Pipeline', 'Criar funis customizados',     'Cria novos funis personalizados', true, true, 60),
('pipeline.custom_delete',   'Pipeline', 'Excluir funis customizados',   'Exclui funis personalizados inteiros', true, false, 70),

-- MÓDULO: Campanhas
('campaigns.view',           'Campanhas', 'Ver campanhas',               'Acessa a página de campanhas', false, true,  10),
('campaigns.create',         'Campanhas', 'Criar campanha',              'Cria novas campanhas', false, true,  20),
('campaigns.edit',           'Campanhas', 'Editar campanha',             'Edita configurações e estágios de campanhas', false, true,  30),
('campaigns.delete',         'Campanhas', 'Excluir campanha',            'Exclui campanhas permanentemente', false, false, 40),
('campaigns.import_leads',   'Campanhas', 'Importar leads na campanha',  'Adiciona leads em lote a uma campanha', false, true,  50),
('campaigns.send_messages',  'Campanhas', 'Disparar mensagens',          'Envia mensagens em massa pela campanha', false, true,  60),
('campaigns.manage_stages',  'Campanhas', 'Gerenciar estágios',          'Cria, edita e exclui estágios da campanha', false, true,  70),

-- MÓDULO: WhatsApp
('whatsapp.view',            'WhatsApp', 'Ver chat',                     'Acessa o chat do WhatsApp', false, true,  10),
('whatsapp.send_messages',   'WhatsApp', 'Enviar mensagens',             'Envia mensagens de texto, áudio e imagem', false, true,  20),
('whatsapp.create_lead',     'WhatsApp', 'Criar lead pelo chat',         'Cria um novo lead a partir de uma conversa', false, true,  30),
('whatsapp.manage_tags',     'WhatsApp', 'Gerenciar tags na conversa',   'Adiciona e remove tags em conversas', false, true,  40),
('whatsapp.toggle_copilot',  'WhatsApp', 'Ativar/desativar Copilot',     'Liga e desliga a IA em conversas individuais', false, true,  50),
('whatsapp.archive',         'WhatsApp', 'Arquivar conversas',           'Arquiva e desarquiva conversas', true,  true,  60),
('whatsapp.delete',          'WhatsApp', 'Excluir conversas',            'Exclui conversas permanentemente', true,  false, 70),
('whatsapp.manage_instances','WhatsApp', 'Gerenciar instâncias',         'Conecta, desconecta e configura instâncias do WhatsApp', true, true, 80),

-- MÓDULO: Copilot (IA)
('copilot.view',             'Copilot', 'Ver agentes IA',                'Acessa a página do Copilot', false, true,  10),
('copilot.create',           'Copilot', 'Criar agente IA',               'Cria novos agentes de IA', false, true,  20),
('copilot.edit',             'Copilot', 'Editar agente IA',              'Configura e edita agentes existentes', false, true,  30),
('copilot.delete',           'Copilot', 'Excluir agente IA',             'Exclui agentes permanentemente', false, false, 40),
('copilot.toggle',           'Copilot', 'Ativar/desativar agente',       'Liga e desliga agentes de IA', false, true,  50),
('copilot.view_metrics',     'Copilot', 'Ver métricas LLM',              'Visualiza métricas de uso e custo da IA', false, true,  60),

-- MÓDULO: Automações
('workflows.view',           'Automações', 'Ver automações',             'Acessa a página de automações', false, true,  10),
('workflows.create',         'Automações', 'Criar automação',            'Cria novos workflows de automação', true,  true,  20),
('workflows.edit',           'Automações', 'Editar automação',           'Edita workflows existentes', true,  true,  30),
('workflows.toggle',         'Automações', 'Ativar/desativar automação', 'Liga e desliga workflows', true,  true,  40),
('workflows.delete',         'Automações', 'Excluir automação',          'Exclui workflows permanentemente', true,  false, 50),

-- MÓDULO: Produtos
('products.view',            'Produtos', 'Ver produtos',                 'Acessa o catálogo de produtos', false, true,  10),
('products.create',          'Produtos', 'Criar produto',                'Adiciona novos produtos ao catálogo', false, true,  20),
('products.edit',            'Produtos', 'Editar produto',               'Edita produtos existentes', false, true,  30),
('products.delete',          'Produtos', 'Excluir produto',              'Remove produtos do catálogo', false, false, 40),
('products.import',          'Produtos', 'Importar produtos',            'Importa produtos em lote via arquivo', false, true,  50),

-- MÓDULO: Agenda
('agenda.view',              'Agenda', 'Ver agenda',                     'Acessa o calendário', false, true,  10),
('agenda.create',            'Agenda', 'Criar evento',                   'Cria eventos e reuniões no calendário', false, true,  20),
('agenda.edit',              'Agenda', 'Editar evento',                  'Edita eventos existentes', false, true,  30),
('agenda.delete',            'Agenda', 'Excluir evento',                 'Remove eventos do calendário', false, true,  40),

-- MÓDULO: Performance
('performance.view',         'Performance', 'Ver pódio',                 'Acessa a página de performance e ranking', false, true,  10),
('performance.manage_goals', 'Performance', 'Gerenciar metas',           'Cria e edita metas da equipe', true,  true,  20),
('performance.manage_awards','Performance', 'Gerenciar premiações',      'Cria e edita premiações e badges', true,  true,  30),

-- MÓDULO: Comissões
('commissions.view',         'Comissões', 'Ver comissões',               'Acessa a página de comissões', false, true,  10),
('commissions.view_all',     'Comissões', 'Ver comissões de todos',      'Vê comissões de todos os membros. Se desabilitado, vê apenas as próprias', true, false, 20),

-- MÓDULO: Follow-ups
('followups.view',           'Follow-ups', 'Ver follow-ups',             'Acessa a página de revisão e follow-ups', false, true,  10),
('followups.delete',         'Follow-ups', 'Excluir follow-up',          'Remove follow-ups permanentemente', false, false, 20),
('followups.bulk_archive',   'Follow-ups', 'Arquivar em lote',           'Arquiva múltiplos follow-ups de uma vez', false, true,  30),
('followups.configure',      'Follow-ups', 'Configurar automações',      'Define regras de automação de follow-up', true,  true,  40),

-- MÓDULO: Configurações
('settings.view',            'Configurações', 'Ver configurações',       'Acessa a página de configurações', false, true,  10),
('settings.tags',            'Configurações', 'Gerenciar tags',          'Cria, edita e exclui tags do sistema', true,  true,  20),
('settings.integrations',    'Configurações', 'Gerenciar integrações',   'Configura Meta, Google Calendar, TinyERP e webhooks', true, true, 30),
('settings.notifications',   'Configurações', 'Preferências de notificação', 'Configura preferências pessoais de notificação', false, true, 40),

-- MÓDULO: Upsell/Carteira
('upsell.view',              'Carteira', 'Ver carteira',                 'Acessa a gestão de carteira de clientes', false, true,  10),
('upsell.create',            'Carteira', 'Criar cliente',                'Adiciona novos clientes à carteira', false, true,  20),
('upsell.move',              'Carteira', 'Mover clientes',               'Move clientes entre estágios da carteira', false, true,  30),

-- MÓDULO: Marketing
('marketing.view',           'Marketing', 'Ver marketing',               'Acessa a página de analytics de marketing', false, true,  10),
('marketing.configure',      'Marketing', 'Configurar investimentos',    'Define investimentos por origem de lead', true, true, 20),

-- MÓDULO: Equipe
('team.view',                'Equipe', 'Ver equipe',                     'Acessa a página de gestão de equipe', true,  true,  10),
('team.create_member',       'Equipe', 'Criar membro',                   'Adiciona novos usuários à organização', true,  true,  20),
('team.edit_member',         'Equipe', 'Editar membro',                  'Edita dados e configurações de membros', true,  true,  30),
('team.delete_member',       'Equipe', 'Excluir membro',                 'Remove membros da organização', true,  false, 40),
('team.manage_permissions',  'Equipe', 'Gerenciar permissões',           'Configura permissões individuais de cada membro', true, true, 50)

ON CONFLICT (key) DO NOTHING;

-- ─── 1.6 Atualizar função is_admin_or_closer() ────────────────────────────
-- Agora aponta para is_user_admin() direto (closer não tem mais privilégio especial por role)
CREATE OR REPLACE FUNCTION public.is_admin_or_closer()
RETURNS BOOLEAN AS $$
  SELECT public.is_user_admin();
$$ LANGUAGE sql SECURITY DEFINER;

-- ─── 1.7 Criar função has_feature_permission() ────────────────────────────
CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_team_member_id UUID;
  v_is_admin BOOLEAN;
  v_enabled BOOLEAN;
  v_default BOOLEAN;
  v_admin_only BOOLEAN;
BEGIN
  -- Master admin tem tudo
  IF public.is_master_user() THEN RETURN true; END IF;

  -- Buscar team_member do usuário atual
  SELECT id, (role = 'admin') INTO v_team_member_id, v_is_admin
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = public.get_user_organization_id()
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  -- Admin tem acesso a tudo
  IF v_is_admin THEN RETURN true; END IF;

  -- Verificar se feature é admin-only
  SELECT fp.is_admin_only, fp.default_value INTO v_admin_only, v_default
  FROM public.feature_permissions fp WHERE fp.key = p_feature_key;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_admin_only THEN RETURN false; END IF;

  -- Verificar permissão individual do membro
  SELECT mfp.enabled INTO v_enabled
  FROM public.member_feature_permissions mfp
  WHERE mfp.team_member_id = v_team_member_id AND mfp.feature_key = p_feature_key;

  -- Se não tem registro, usar default
  RETURN COALESCE(v_enabled, v_default);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
