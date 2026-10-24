-- Roll this migration back BEFORE 20271117000102. Restores the per-call strict check.
CREATE OR REPLACE FUNCTION public.can_see_chat_scope(p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT private.strict_phone_visible(p_org_id,p_lead_id,p_normalized_phone)
 AND private.chat_scope_for_recipient(auth.uid(),p_org_id,p_lead_id,p_normalized_phone);
$function$;

UPDATE private.strict_lead_rpc_restore
  SET hardened_definition=pg_get_functiondef('public.can_see_chat_scope(uuid,uuid,text)'::regprocedure)
  WHERE signature='can_see_chat_scope(uuid,uuid,text)';
