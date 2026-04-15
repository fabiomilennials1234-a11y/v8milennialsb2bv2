-- ============================================
-- MIGRAÇÃO: Adicionar metric_type e job_title em pending_org_invites
-- ============================================
-- Permite preservar a escolha do admin no pré-cadastro (convite),
-- propagando metric_type e job_title quando o usuário se vincula à org.
-- ============================================

ALTER TABLE public.pending_org_invites
  ADD COLUMN IF NOT EXISTS metric_type TEXT DEFAULT 'meetings'
    CHECK (metric_type IN ('meetings', 'sales')),
  ADD COLUMN IF NOT EXISTS job_title TEXT;
