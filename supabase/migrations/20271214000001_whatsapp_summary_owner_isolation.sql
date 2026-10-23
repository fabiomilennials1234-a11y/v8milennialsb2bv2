-- Summary previews must obey the same owner rule as whatsapp_messages.
-- JR Tex reproduced the gap: an authenticated member could read 105 unrelated
-- summaries although both conversation-list RPCs and messages denied them.
-- RESTRICTIVE is essential: the existing permissive org policy must not OR
-- around this check. Keep the independent instance/strict-owner policies.
-- CLI-created migration sequenced after its existing chat helper dependencies.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE POLICY whatsapp_conversation_summary_owner_read_access
ON public.whatsapp_conversation_summary
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  organization_id = ANY ((SELECT private.chat_unrestricted_org_ids())::uuid[])
  OR public.can_see_chat(organization_id, normalized_phone)
);

COMMENT ON POLICY whatsapp_conversation_summary_owner_read_access
ON public.whatsapp_conversation_summary IS
  'Summary previews follow message ownership when chat_restrict_to_owner is enabled; existing instance and strict-owner restrictions still apply.';

COMMIT;
