-- Rollback de 20271215000001_policies_admin_global_ganham_escopo_de_org.sql
--
-- Devolve as seis policies exatamente como estavam em prod em 23/10/2026
-- (texto de pg_get_expr). DROP + CREATE na mesma transação: ALTER POLICY não
-- consegue remover um WITH CHECK, e o original de duas delas não tinha.
--
-- ATENÇÃO: rollback REABRE o acesso cross-tenant de admin de qualquer org.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS follow_up_automations_select_global ON public.follow_up_automations;

DROP POLICY IF EXISTS "Apenas admins podem gerenciar comissões" ON public.commissions;
CREATE POLICY "Apenas admins podem gerenciar comissões" ON public.commissions AS PERMISSIVE FOR ALL TO authenticated USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));

DROP POLICY IF EXISTS "Usuários podem ver próprias comissões" ON public.commissions;
CREATE POLICY "Usuários podem ver próprias comissões" ON public.commissions AS PERMISSIVE FOR SELECT TO public USING ((has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR (team_member_id IN ( SELECT get_my_team_member_ids() AS get_my_team_member_ids))));

DROP POLICY IF EXISTS "Apenas admins podem gerenciar automações" ON public.follow_up_automations;
CREATE POLICY "Apenas admins podem gerenciar automações" ON public.follow_up_automations AS PERMISSIVE FOR ALL TO public USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));

DROP POLICY IF EXISTS "pipe_dispatch_rules_insert" ON public.pipe_dispatch_rules;
CREATE POLICY pipe_dispatch_rules_insert ON public.pipe_dispatch_rules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((organization_id IN ( SELECT team_members.organization_id
   FROM team_members
  WHERE (team_members.user_id = ( SELECT auth.uid() AS uid)))) OR ( SELECT is_user_admin() AS is_user_admin)));

DROP POLICY IF EXISTS "Apenas admins podem deletar roles" ON public.user_roles;
CREATE POLICY "Apenas admins podem deletar roles" ON public.user_roles AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role));

DROP POLICY IF EXISTS "Apenas admins podem inserir roles" ON public.user_roles;
CREATE POLICY "Apenas admins podem inserir roles" ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role));

COMMIT;
