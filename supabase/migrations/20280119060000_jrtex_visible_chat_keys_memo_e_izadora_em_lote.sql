-- 20280119060000_jrtex_visible_chat_keys_memo_e_izadora_em_lote.sql
--
-- private.jrtex_visible_chat_keys() — continuação de 20280119050000. A lista de
-- conversas da JR Tex seguia em 0,2–0,9 s por usuário (Izadora 1,3–1,6 s) mesmo
-- depois do semi-join.
--
-- MEDIDO (prod, 18/11/2026, pg_stat_xact_user_functions): a função responde por
-- ~77% da lista e é chamada 3 vezes por lista (uma por view private.*), cada vez
-- recalculando o mesmo universo de pares; na Izadora, o ramo "chat novo" chama
-- private.jrtex_izadora_new_chat 2.625 vezes (≈875 pares × 3) — ≈800 ms.
--
-- CORREÇÃO (só o corpo; mesma assinatura, ACL e retorno):
--   1. MEMO POR STATEMENT. O resultado depende só de (usuário, snapshot). As 3
--      avaliações de uma lista ocorrem no mesmo statement de topo, então a 2ª e a
--      3ª reaproveitam a 1ª. O cache é um GUC local à transação
--      (jrtex.k<uuid sem hífens>) cujo valor começa por statement_timestamp(): outro
--      comando do cliente (o PostgREST manda um por requisição) nunca lê valor velho.
--      Só um script multi-statement numa única mensagem simple-query leria o da
--      avaliação anterior; nenhum caminho autenticado faz isso (service_role tem
--      auth.uid() NULL e a função sai antes do cache). Fica no mesmo
--      limite de confiança de auth.uid(), que lê request.jwt.claims (também um GUC):
--      quem consegue forjar este GUC já forja a identidade. Sem login não cacheia.
--   2. IZADORA EM LOTE. A decisão de jrtex_izadora_new_chat por par vira três CTEs
--      materializadas (leads, leads com entrada de funil, resumo da instância com a
--      marca "bloqueado") avaliadas uma vez e só quando v_new_chat. A lógica é a
--      mesma: telefone do par (ou do lead) casa com um resumo não-grupo da
--      instância, o lead do par (se houver) tem esse telefone, e nada
--      (telefone, lead do par, lead do resumo) tem entrada de funil. O NULL do IN é
--      tratado com coalesce para não excluir chat órfão.
--
-- EQUIVALÊNCIA. Em prod, em transação com ROLLBACK, o conjunto de chaves
-- (DISTINCT, ordenado) saiu IGUAL para os 21 usuários ativos da JR Tex e para
-- chamada sem login (22/22). Chamada fria por usuário: ~90 ms (igual); Izadora
-- 738 → 187 ms. Por lista (3 chamadas → 1 fria + 2 em cache): ~285 → ~95 ms para
-- membros; Izadora ~2,2 s → ~190 ms.
--
-- TRAVA. Função fora do repo. O bloco lê o prosrc VIVO: corpo da 20280119050000
-- (md5 66550eb8ed128999fb48fc4d00e7bd6b) → troca; já no corpo novo (md5 46f2fee8d636ace9f515619d2f4bcf38) → no-op; qualquer
-- outro → ABORTA. Sem a função (banco montado só do repo) não faz nada.
--
-- Rollback: supabase/migrations/rollback/20280119060000_jrtex_visible_chat_keys_memo_e_izadora_em_lote.sql

DO $apply$
DECLARE
  v_oid oid := to_regprocedure('private.jrtex_visible_chat_keys()');
  v_md5 text;
BEGIN
  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_md5 = '46f2fee8d636ace9f515619d2f4bcf38' THEN
    RETURN;
  END IF;
  IF v_md5 <> '66550eb8ed128999fb48fc4d00e7bd6b' THEN
    RAISE EXCEPTION 'private.jrtex_visible_chat_keys() divergiu do corpo revisado (md5 % <> 66550eb8ed128999fb48fc4d00e7bd6b) — abortado para não sobrescrever corpo não revisado', v_md5;
  END IF;

  EXECUTE $def$CREATE OR REPLACE FUNCTION private.jrtex_visible_chat_keys()
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_keys text[]; v_suffix text; v_user uuid:=auth.uid(); v_new_chat boolean; v_ck text; v_cache text;
BEGIN
 v_suffix:=private.jrtex_lead_scope_for_user(v_user,'30bb5c27-88f4-4f91-9493-835405ae2e11');
 IF v_user IS NULL THEN RETURN ARRAY[]::text[]; END IF;
 v_ck:='jrtex.k'||replace(v_user::text,'-','');
 v_cache:=current_setting(v_ck,true);
 IF v_cache IS NOT NULL AND v_cache<>'' AND left(v_cache,length(statement_timestamp()::text)+1)=statement_timestamp()::text||'|' THEN
 RETURN substr(v_cache,length(statement_timestamp()::text)+2)::text[];
 END IF;
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
 iza_leads AS MATERIALIZED (
   SELECT l.id, l.normalized_phone FROM public.leads l
   WHERE v_new_chat AND l.organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11' AND l.deleted_at IS NULL
 ),
 iza_pe_leads AS MATERIALIZED (
   SELECT DISTINCT pe.lead_id FROM public.pipeline_entries pe
   WHERE v_new_chat AND pe.organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11'
     AND pe.lead_id IN (SELECT il.id FROM iza_leads il)
 ),
 iza_summary AS MATERIALIZED (
   SELECT s.normalized_phone phone, s.lead_id,
          coalesce(s.normalized_phone IN (SELECT il.normalized_phone FROM iza_leads il WHERE il.id IN (SELECT x.lead_id FROM iza_pe_leads x))
           OR s.lead_id IN (SELECT x.lead_id FROM iza_pe_leads x), false) AS blocked
   FROM public.whatsapp_conversation_summary s
   WHERE v_new_chat AND s.organization_id='30bb5c27-88f4-4f91-9493-835405ae2e11'
     AND s.instance_id='45149134-35d6-4be2-8668-81d6210542c0'::uuid AND NOT s.is_group
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
 WHEN v_new_chat THEN EXISTS(
   SELECT 1 FROM iza_summary z
   WHERE z.phone=coalesce(nullif(pair.phone,''),(SELECT il.normalized_phone FROM iza_leads il WHERE il.id=pair.lead_id))
     AND (pair.lead_id IS NULL OR EXISTS(SELECT 1 FROM iza_leads il WHERE il.id=pair.lead_id AND il.normalized_phone=z.phone))
     AND NOT z.blocked
     AND NOT (pair.lead_id IS NOT NULL AND pair.lead_id IN (SELECT x.lead_id FROM iza_pe_leads x)))
 ELSE false END;
 PERFORM set_config(v_ck,statement_timestamp()::text||'|'||v_keys::text,true);
 RETURN v_keys;
END;
$function$
$def$;
END
$apply$;

NOTIFY pgrst, 'reload schema';
