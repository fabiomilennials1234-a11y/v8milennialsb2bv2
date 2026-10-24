SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='60s';
-- Performance fix for 20271117000102, same defect as 20271117000103.
--
-- 102 prefixed can_see_chat_scope with private.strict_phone_visible(). Chat
-- list RPCs call can_see_chat_scope once per conversation, and every call
-- re-evaluated strict_lead_member_orgs() (scan of organizations by feature
-- flag + team_members + is_master_user), in every organization. The official
-- WhatsApp inbox went from ~70 ms to 4-5 s.
--
-- strict_phone_visible is NOT (p_org = ANY(strict_lead_member_orgs())) OR ...
-- and strict_lead_member_orgs() only ever lists organizations carrying the
-- strict_lead_owner_access flag. So when p_org does not carry the flag the
-- call is always true: a primary-key lookup on organizations answers it.
-- NULL p_org: both forms end false through chat_scope_for_recipient.

CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT (NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=p_org_id
           AND o.feature_flags @> '{"strict_lead_owner_access":true}'::jsonb)
         OR private.strict_phone_visible(p_org_id,p_lead_id,p_normalized_phone))
   AND private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$function$;

-- Keep 102's rollback able to verify and restore this RPC.
UPDATE private.strict_lead_rpc_restore
  SET hardened_definition=pg_get_functiondef('public.can_see_chat_scope(uuid,uuid,text)'::regprocedure)
  WHERE signature='can_see_chat_scope(uuid,uuid,text)';
