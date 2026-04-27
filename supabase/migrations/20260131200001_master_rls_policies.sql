-- Migration: Master RLS Policies
-- Description: Adiciona policies RLS para permitir acesso master a todas as tabelas principais
-- Date: 2026-01-31

-- ============================================
-- POLICIES PARA ORGANIZATIONS
-- ============================================

-- Master pode ver todas as organizacoes
CREATE POLICY "master_select_all_organizations"
ON public.organizations FOR SELECT
USING (public.is_master_user());

-- Master pode gerenciar todas as organizacoes
CREATE POLICY "master_all_organizations"
ON public.organizations FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA LEADS
-- ============================================

CREATE POLICY "master_select_all_leads"
ON public.leads FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_leads"
ON public.leads FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA TEAM_MEMBERS
-- ============================================

CREATE POLICY "master_select_all_team_members"
ON public.team_members FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_team_members"
ON public.team_members FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA USER_ROLES
-- ============================================

CREATE POLICY "master_select_all_user_roles"
ON public.user_roles FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_user_roles"
ON public.user_roles FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA PROFILES
-- ============================================

CREATE POLICY "master_select_all_profiles"
ON public.profiles FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_profiles"
ON public.profiles FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA CAMPANHAS
-- ============================================

CREATE POLICY "master_select_all_campanhas"
ON public.campanhas FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_campanhas"
ON public.campanhas FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA WHATSAPP_INSTANCES
-- ============================================

CREATE POLICY "master_select_all_whatsapp_instances"
ON public.whatsapp_instances FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_whatsapp_instances"
ON public.whatsapp_instances FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA COPILOT_AGENTS
-- ============================================

CREATE POLICY "master_select_all_copilot_agents"
ON public.copilot_agents FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_copilot_agents"
ON public.copilot_agents FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA CONVERSATIONS
-- ============================================

CREATE POLICY "master_select_all_conversations"
ON public.conversations FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_conversations"
ON public.conversations FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA WHATSAPP_MESSAGES
-- ============================================

CREATE POLICY "master_select_all_whatsapp_messages"
ON public.whatsapp_messages FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_whatsapp_messages"
ON public.whatsapp_messages FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA TAGS
-- ============================================

CREATE POLICY "master_select_all_tags"
ON public.tags FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_tags"
ON public.tags FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA PRODUCTS
-- ============================================

CREATE POLICY "master_select_all_products"
ON public.products FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_products"
ON public.products FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA COMMISSIONS
-- ============================================

CREATE POLICY "master_select_all_commissions"
ON public.commissions FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_commissions"
ON public.commissions FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA GOALS
-- ============================================

CREATE POLICY "master_select_all_goals"
ON public.goals FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_goals"
ON public.goals FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA AWARDS
-- ============================================

CREATE POLICY "master_select_all_awards"
ON public.awards FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_awards"
ON public.awards FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA FOLLOW_UPS
-- ============================================

CREATE POLICY "master_select_all_follow_ups"
ON public.follow_ups FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_follow_ups"
ON public.follow_ups FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA PIPE TABLES
-- ============================================

-- pipe_whatsapp
CREATE POLICY "master_select_all_pipe_whatsapp"
ON public.pipe_whatsapp FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_pipe_whatsapp"
ON public.pipe_whatsapp FOR ALL
USING (public.is_master_user());

-- pipe_confirmacao
CREATE POLICY "master_select_all_pipe_confirmacao"
ON public.pipe_confirmacao FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_pipe_confirmacao"
ON public.pipe_confirmacao FOR ALL
USING (public.is_master_user());

-- pipe_propostas
CREATE POLICY "master_select_all_pipe_propostas"
ON public.pipe_propostas FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_pipe_propostas"
ON public.pipe_propostas FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA CAMPAIGN_TEMPLATES
-- ============================================

CREATE POLICY "master_select_all_campaign_templates"
ON public.campaign_templates FOR SELECT
USING (public.is_master_user());

CREATE POLICY "master_all_campaign_templates"
ON public.campaign_templates FOR ALL
USING (public.is_master_user());

-- ============================================
-- POLICIES PARA APPLICATION_LOGS
-- ============================================

CREATE POLICY "master_select_all_application_logs"
ON public.application_logs FOR SELECT
USING (public.is_master_user());

-- ============================================
-- FIM DA MIGRATION
-- ============================================
