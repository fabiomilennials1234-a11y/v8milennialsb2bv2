-- rollback/20271107160000_channel_messages_restrict_to_owner.sql
--
-- Devolve as policies de channel_messages aos textos LITERAIS de prod lidos em
-- 2026-10-06 (pg_policies, antes do apply) e remove o helper.
-- ⚠ Reabre o furo: org_access PERMISSIVE anula o recorte por responsável.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER POLICY channel_messages_select_by_owner ON public.channel_messages
  TO public
  USING (
    (organization_id IN (SELECT get_my_organization_ids() AS get_my_organization_ids))
    AND can_see_chat_scope(organization_id, lead_id, normalize_brazilian_phone(phone_number))
  );

CREATE POLICY channel_messages_org_access ON public.channel_messages
  AS PERMISSIVE FOR SELECT TO public
  USING (organization_id IN (SELECT get_my_organization_ids() AS get_my_organization_ids));

DROP FUNCTION private.chat_unrestricted_org_ids();

COMMIT;
