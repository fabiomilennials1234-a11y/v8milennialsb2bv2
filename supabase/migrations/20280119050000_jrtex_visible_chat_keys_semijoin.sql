-- 20280119050000_jrtex_visible_chat_keys_semijoin.sql
--
-- private.jrtex_visible_chat_keys() — função só de prod (fora do ledger) que as
-- cinco views private.* (whatsapp_messages, whatsapp_conversation_summary,
-- whatsapp_conversations, conversation_read_state, channel_messages) avaliam, uma
-- vez por consulta, para todo usuário da JR Tex sob o recorte strict.
--
-- SINTOMA. Medido em prod em 18/11/2026 com pg_stat_xact_user_functions: 72% da
-- lista de conversas de um membro da JR Tex (544 de 757 ms) e 72% da da Karine
-- (743 de 1.027 ms) ficam nesta função, chamada 3 vezes por lista.
--
-- CAUSA. (a) cada fonte entrava inteira no UNION (≈23 mil linhas, das quais 768
-- pares distintos) e o UNION ordenava/deduplicava tudo; (b) o filtro final era um
-- EXISTS com OR contra uma CTE materializada, que o planner não consegue
-- transformar em semi-join por hash, então virava laço aninhado
-- (pares × allowed); na Karine, idem contra karine_principal (≈1,5 mil linhas).
--
-- CORREÇÃO (só o corpo; mesma assinatura, mesma ACL, mesmo retorno):
--   1. cada fonte é agrupada ANTES do UNION (GROUP BY nas colunas brutas, e o
--      normalize_brazilian_phone roda sobre os distintos, não sobre as 12 mil
--      linhas de conversation_read_state);
--   2. o EXISTS (… OR …) vira dois testes `IN (subconsulta)` independentes, que o
--      planner executa como hashed SubPlan; o da Karine usa `(lead, telefone) IN`.
--   A condição é a mesma: lead com id ∈ allowed, OU sem lead e telefone ∈
--   allowed; para a Karine, telefone ∈ karine_principal e (sem lead OU mesmo
--   lead). Um IN que dá NULL (telefone nulo em allowed) cai no próximo WHEN do
--   CASE, exatamente como o EXISTS falso de antes.
--
-- EQUIVALÊNCIA. Em prod, em transação com ROLLBACK, o conjunto de chaves
-- (DISTINCT, ordenado, md5) saiu IGUAL para os 21 usuários ativos da JR Tex e
-- para chamada sem login (22/22). Tempo por chamada: 140–640 ms → 77–125 ms.
-- Lista da Karine 1,05–1,3 s → 0,57 s; membro 1,0 s → 0,5 s.
--
-- TRAVA. A função não existe no repo. O bloco lê o prosrc VIVO e confere o md5
-- do corpo revisado em 18/11/2026 (5215a7eb7308647988718b838e50db2b); se divergir, ABORTA (nunca
-- sobrescreve corpo que não foi revisado). Já no corpo novo (66550eb8ed128999fb48fc4d00e7bd6b) é no-op.
-- Sem a função (banco montado só do repo) não faz nada.
--
-- Rollback: supabase/migrations/rollback/20280119050000_jrtex_visible_chat_keys_semijoin.sql

DO $apply$
DECLARE
  v_oid oid := to_regprocedure('private.jrtex_visible_chat_keys()');
  v_src text;
  v_md5 text;
BEGIN
  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  v_md5 := md5(v_src);
  IF v_md5 = '66550eb8ed128999fb48fc4d00e7bd6b' THEN
    RETURN;
  END IF;
  IF v_md5 <> '5215a7eb7308647988718b838e50db2b' THEN
    RAISE EXCEPTION 'private.jrtex_visible_chat_keys() divergiu do corpo revisado (md5 % <> 5215a7eb7308647988718b838e50db2b) — abortado para não sobrescrever corpo não revisado', v_md5;
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
$apply$;

NOTIFY pgrst, 'reload schema';
