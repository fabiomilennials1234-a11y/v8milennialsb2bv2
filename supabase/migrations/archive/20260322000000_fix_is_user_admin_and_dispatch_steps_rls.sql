-- =================================================================
-- FIX DEFINITIVO: Dispatch Rules - RLS e is_user_admin()
--
-- Problemas encontrados:
--   1. is_user_admin() só checa user_roles, não team_members.role
--   2. INSERT em dispatch rules/steps exige admin (inconsistente com UPDATE/DELETE)
--   3. Regras órfãs (0 steps) acumuladas pelo bug
--
-- Solução:
--   1. Corrigir is_user_admin() para checar ambas as tabelas
--   2. Remover exigência de admin para INSERT em dispatch rules/steps
--      (manter apenas org membership, consistente com UPDATE/DELETE)
--   3. Limpar regras órfãs
-- =================================================================

-- ============================================
-- 1. CORRIGIR is_user_admin()
-- ============================================
CREATE OR REPLACE FUNCTION public.is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  )
$$;

-- ============================================
-- 2. FIX: campanha_dispatch_rules INSERT (remover admin)
-- ============================================
DROP POLICY IF EXISTS "campanha_dispatch_rules_insert" ON public.campanha_dispatch_rules;
CREATE POLICY "campanha_dispatch_rules_insert"
  ON public.campanha_dispatch_rules FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- 3. FIX: campanha_dispatch_rule_steps INSERT (remover admin)
-- ============================================
DROP POLICY IF EXISTS "campanha_dispatch_rule_steps_insert" ON public.campanha_dispatch_rule_steps;
CREATE POLICY "campanha_dispatch_rule_steps_insert"
  ON public.campanha_dispatch_rule_steps FOR INSERT TO authenticated
  WITH CHECK (
    rule_id IN (
      SELECT r.id FROM public.campanha_dispatch_rules r
      JOIN public.campanhas c ON c.id = r.campanha_id
      WHERE c.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- 4. FIX: pipe_dispatch_rules INSERT (remover admin)
-- ============================================
DROP POLICY IF EXISTS "pipe_dispatch_rules_insert" ON public.pipe_dispatch_rules;
CREATE POLICY "pipe_dispatch_rules_insert"
  ON public.pipe_dispatch_rules FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- 5. FIX: pipe_dispatch_rule_steps INSERT (remover admin)
-- ============================================
DROP POLICY IF EXISTS "pipe_dispatch_rule_steps_insert" ON public.pipe_dispatch_rule_steps;
CREATE POLICY "pipe_dispatch_rule_steps_insert"
  ON public.pipe_dispatch_rule_steps FOR INSERT TO authenticated
  WITH CHECK (
    rule_id IN (
      SELECT r.id FROM public.pipe_dispatch_rules r
      WHERE r.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- 6. LIMPEZA: remover regras órfãs (sem steps)
-- ============================================
DELETE FROM public.campanha_dispatch_rules
WHERE id NOT IN (
  SELECT DISTINCT rule_id FROM public.campanha_dispatch_rule_steps
);

DELETE FROM public.pipe_dispatch_rules
WHERE id NOT IN (
  SELECT DISTINCT rule_id FROM public.pipe_dispatch_rule_steps
);
