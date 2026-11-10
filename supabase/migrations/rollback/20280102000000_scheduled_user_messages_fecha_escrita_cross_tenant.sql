-- Rollback de 20280102000000_scheduled_user_messages_fecha_escrita_cross_tenant.sql
-- Volta às policies INSERT/UPDATE vigentes em prod em 10/11/2026 (texto lido de
-- pg_policies) e remove os dois triggers e suas funções.
--
-- ATENÇÃO: reabre o furo cross-tenant da fila de envio. Usar só se a migration
-- quebrar um fluxo legítimo e o fix não puder esperar.

BEGIN;

DROP TRIGGER IF EXISTS trg_scheduled_user_messages_client_guard ON public.scheduled_user_messages;
DROP TRIGGER IF EXISTS trg_scheduled_user_messages_tenant_integrity ON public.scheduled_user_messages;
DROP FUNCTION IF EXISTS public.scheduled_user_messages_client_guard();
DROP FUNCTION IF EXISTS public.scheduled_user_messages_tenant_integrity();

DROP POLICY IF EXISTS "Members can insert own org scheduled messages" ON public.scheduled_user_messages;
DROP POLICY IF EXISTS "Members can update own scheduled messages" ON public.scheduled_user_messages;

CREATE POLICY "Members can insert own org scheduled messages"
  ON public.scheduled_user_messages
  FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT team_members.organization_id
    FROM public.team_members
    WHERE team_members.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "Members can update own scheduled messages"
  ON public.scheduled_user_messages
  FOR UPDATE
  USING (created_by IN (
    SELECT team_members.id
    FROM public.team_members
    WHERE team_members.user_id = (SELECT auth.uid())
  ));

COMMIT;
