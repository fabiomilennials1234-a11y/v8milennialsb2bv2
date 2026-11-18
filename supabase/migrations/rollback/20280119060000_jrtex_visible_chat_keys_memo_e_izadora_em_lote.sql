-- Rollback de 20280119060000_jrtex_visible_chat_keys_memo_e_izadora_em_lote.sql
--
-- Restaura o corpo anterior de private.jrtex_visible_chat_keys() (md5 66550eb8ed128999fb48fc4d00e7bd6b,
-- o da 20280119050000). Corpo atual = o desta migration → restaura; já no corpo
-- anterior → nada a fazer; qualquer outro → ABORTA.

DO $rollback$
DECLARE
  v_oid oid := to_regprocedure('private.jrtex_visible_chat_keys()');
  v_md5 text;
BEGIN
  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_md5 = '66550eb8ed128999fb48fc4d00e7bd6b' THEN
    RETURN;
  END IF;
  IF v_md5 <> '46f2fee8d636ace9f515619d2f4bcf38' THEN
    RAISE EXCEPTION 'private.jrtex_visible_chat_keys() não está no corpo desta migration (md5 % <> 46f2fee8d636ace9f515619d2f4bcf38) — abortado', v_md5;
  END IF;

  EXECUTE $def$CREATE OR REPLACE FUNCTION private.jrtex_visible_chat_keys()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_keys text[]; v_suffix text; v_user uuid:=auth.uid(); v_new_chat boolean;
BEGIN
 v_suffix:=private.jrtex_lead_scope_for_user(v_user,'30bb5c27-88f4-4f91-9493-835405ae2e11');
 IF v_user IS NULL THEN RETURN ARRAY[]::text[]; END IF;
 v_new_chat:=private.jrtex_izadora_inbox_scope(v_user,'30bb5c27-88f4-4f91-9493-835405ae2e11');
 WITH pairs AS MATERIALIZED (
 SELECT lead_id,normalized_phone phone FROM public.whatsapp_messages WHERE organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' GROUP BY 1,2
 UNION SELECT lead_id,normalized_phone FROM public.whatsapp_conversation_summary WHERE organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11'
 UNION SELECT d.lead_id,public.normalize_brazilian_phone(d.p) FROM (SELECT lead_id,COALESCE(phone_number,contact_external_id) p FROM public.channel_messages WHERE organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' GROUP BY 1,2) d
 UNION SELECT NULL::uuid,public.normalize_brazilian_phone(d.k) FROM (SELECT substring(conversation_key FROM '^[^:]*:[^:]*:(.*)$') k FROM public.conversation_read_state WHERE organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' GROUP BY 1) d
 UNION SELECT NULL::uuid,normalized_phone FROM public.whatsapp_conversations WHERE organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11'
 ), allowed AS MATERIALIZED (
 SELECT DISTINCT l.id,l.normalized_phone FROM public.leads l
 JOIN public.pipeline_entries pe ON pe.lead_id=l.id AND pe.organization_id=l.organization_id
 JOIN public.pipelines p ON p.id=pe.pipeline_id AND p.organization_id=pe.organization_id
 WHERE l.organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' AND l.deleted_at IS NULL
 AND btrim(p.name) ~* ('(^|[^[:alnum:]])'||v_suffix||'$')
 UNION
 SELECT l.id,l.normalized_phone FROM public.leads l
 JOIN public.team_members tm ON tm.organization_id=l.organization_id AND tm.user_id=v_user AND tm.is_active
 WHERE v_suffix IS NULL AND l.organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' AND l.deleted_at IS NULL
 AND (tm.id IN(l.pre_sale_responsible_id,l.sale_responsible_id,l.sdr_id,l.closer_id)
 OR EXISTS(SELECT 1 FROM public.lead_owners own WHERE own.lead_id=l.id AND own.organization_id=l.organization_id AND own.team_member_id=tm.id AND own.role='co')
 OR EXISTS(SELECT 1 FROM public.pipeline_entries pe WHERE pe.lead_id=l.id AND pe.organization_id=l.organization_id AND (pe.assigned_to=tm.id OR tm.id::text IN(pe.metadata->>'pre_sale_responsible_id',pe.metadata->>'sale_responsible_id',pe.metadata->>'sdr_id',pe.metadata->>'closer_id',pe.metadata->>'responsible_id'))))
 ),
 karine_principal AS MATERIALIZED (
   SELECT s.lead_id, s.normalized_phone
   FROM public.whatsapp_conversation_summary s
   WHERE v_user = '85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea'::uuid
     AND s.organization_id = '30bb5c27-88f4-4f91-9493-835405ae2e11'::uuid
     AND s.instance_id = '859ee852-2102-4a5d-b249-98a6fe0b601c'::uuid
     AND NOT s.is_group
     AND private.jrtex_karine_orphan_chat(v_user, s.organization_id, s.lead_id, s.normalized_phone)
 )
 SELECT coalesce(array_agg(jsonb_build_array(pair.lead_id,pair.phone)::text),ARRAY[]::text[]) INTO v_keys
 FROM pairs pair WHERE CASE
 WHEN (pair.lead_id IS NOT NULL AND pair.lead_id IN (SELECT a.id FROM allowed a))
   OR (pair.lead_id IS NULL AND pair.phone IN (SELECT a.normalized_phone FROM allowed a)) THEN true
 WHEN (pair.lead_id IS NULL AND pair.phone IN (SELECT k.normalized_phone FROM karine_principal k))
   OR (pair.lead_id IS NOT NULL AND (pair.lead_id, pair.phone) IN (SELECT k.lead_id, k.normalized_phone FROM karine_principal k)) THEN true
 WHEN v_new_chat THEN private.jrtex_izadora_new_chat(v_user,'30bb5c27-88f4-4f91-9493-835405ae2e11',pair.lead_id,pair.phone)
 ELSE false END;
 RETURN v_keys;
END;
$function$
$def$;
END
$rollback$;

NOTIFY pgrst, 'reload schema';
