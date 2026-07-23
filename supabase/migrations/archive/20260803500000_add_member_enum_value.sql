-- ============================================================================
-- Pré-requisito: Adicionar 'member' ao enum app_role
-- ============================================================================
-- ALTER TYPE ADD VALUE não pode rodar na mesma transação que usa o novo valor.
-- Por isso esta migration é separada da principal.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'member';
