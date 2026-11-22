-- ════════════════════════════════════════════════════════════════════════════
-- whatsapp_thread_manifest: SECURITY DEFINER com o gate da RLS calculado UMA vez
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026; 42 k chamadas): conversa quente de um membro da
-- org de 60 caixas (14,3 k mensagens no telefone) = 2,9 s quente / 9,3 s frio;
-- a cauda (p90 26 k, p99 58 k mensagens por telefone) estoura o timeout de
-- 15 s. A função é SQL INVOKER: a RLS de whatsapp_messages roda POR LINHA
-- (`can_see_chat(org, telefone)` sem `(SELECT …)` na policy, + restritivas) sobre
-- TODAS as mensagens do telefone, e só então o top-100 é cortado. Mais 49 ms
-- fixos do InitPlan de private.whatsapp_readable_message_instance_ids().
--
-- CORREÇÃO: mesma assinatura, mesmo jsonb. SECURITY DEFINER que reproduz a RLS
-- de SELECT de whatsapp_messages para (org, telefone, caixas) — todas as
-- policies avaliadas como o `authenticated` as avalia — com cada termo
-- constante calculado UMA vez e os termos por linha só quando ativos:
--
--   PERMISSIVE (uma basta)
--     master_all / master_select_all       is_master_user()
--     whatsapp_messages_select_by_owner    org ∈ minhas orgs ∧ can_see_chat(org, tel)   ← constante
--     service_role_full_access             auth.role() = service_role (sem EXECUTE aqui)
--   RESTRICTIVE (todas)
--     whatsapp_messages_instance_read_access   master ∨ admin ativo da org ∨
--                                              caixa ∈ readable_message_instance_ids()  ← conjunto, 1×
--     scoped_whatsapp_user_restriction (prod)  org ∉ restritas ∨ caixa ∈ permitidas      ← conjunto, 1×
--     strict_owner_related_select (prod)       org ∉ strict ∨ strict_phone_visible(org, m.lead_id, tel)  ← por linha, só se org ∈ strict
--     riofix_balcao_chat_scope (prod)          sem balcão ∨ riofix_balcao_caller_chat(org, m.lead_id, tel) ← por linha, só com balcão
--
-- Com o índice (org, telefone, timestamp DESC, id DESC) de 20280123000400 o
-- Limit para em ~100 linhas: custo deixa de ser linear no histórico.
--
-- FALHA FECHADA (o risco do DEFINER é a policy NOVA que esta função não
-- conhece): `private.whatsapp_messages_policy_fingerprint()` faz o md5 das
-- policies SELECT/ALL de whatsapp_messages (nome, tipo, papéis, expressão) E
-- das 12 funções que elas chamam (assinatura, DEFINER, proconfig; sem corpo).
-- A função só responde se o fingerprint for um dos DOIS revisados — o de prod
-- (aa9b3228…: 8 policies + 12 funções, lido em prod 21/11/2026) ou o do repo
-- (7e5c0bc4…: banco montado só das migrations, sem as 3 restritivas prod-only).
-- Qualquer outro ⇒ RAISE a cada chamada (chat falha alto, nunca vaza calado),
-- e o bloco DO do fim recusa aplicar. Ramos prod-only por to_regprocedure +
-- EXECUTE: num banco sem os objetos de prod nada é preparado.
--
-- ERRO NOVO, DECLARADO: org inacessível agora dá 42501 (antes: manifest vazio
-- calado). O front só chama com a org do vínculo atual.
--
-- GRANTS: authenticated. service_role NÃO (nenhum caller em supabase/functions;
-- service_role bypassa RLS e o gate por auth.uid() não faria sentido).
--
-- Prova: supabase/tests/manifest_definer_isolamento_test.sql — md5(manifest
-- DEFINER) == SELECT equivalente sob RLS como authenticated, por persona.
--
-- BASE: corpo VIVO de prod (md5 234377896ca4a0bc07f02ec0b7874415, 21/11/2026
-- = repo 20271021000001). Pré-voo recusa outra base.
--
-- Rollback: supabase/migrations/rollback/20280123000800_thread_manifest_definer_gate_unico.sql

DO $preflight$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.whatsapp_thread_manifest(uuid,uuid[],text,timestamp with time zone,uuid,text)');
  IF v_md5 IS DISTINCT FROM '234377896ca4a0bc07f02ec0b7874415' THEN
    RAISE EXCEPTION 'pré-voo: whatsapp_thread_manifest diverge da base revisada (md5 %), abortado', v_md5;
  END IF;
END
$preflight$;

-- Fingerprint das policies de LEITURA de whatsapp_messages. Duas partes:
--   (1) cada policy SELECT/ALL: nome, tipo, papéis, expressão (deparse);
--   (2) cada função que essas policies chamam (pg_depend da policy → pg_proc):
--       assinatura, SECURITY DEFINER e proconfig — SEM o corpo. Pega troca de
--       função por outra assinatura, DEFINER ↔ INVOKER e search_path mexido,
--       sem acusar hotfix de corpo (esses têm pré-voo de md5 próprio).
-- search_path vazio: deparse e regprocedure saem totalmente qualificados e
-- iguais em qualquer sessão.
CREATE OR REPLACE FUNCTION private.whatsapp_messages_policy_fingerprint()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH pol AS (
    SELECT p.oid, p.polname, p.polpermissive, p.polcmd, p.polroles, p.polqual, p.polrelid
      FROM pg_catalog.pg_policy p
     WHERE p.polrelid = 'public.whatsapp_messages'::regclass
       AND p.polcmd IN ('r', '*')
  )
  SELECT md5(
    COALESCE((SELECT string_agg(
                p.polname || '|' || CASE WHEN p.polpermissive THEN 'P' ELSE 'R' END || '|' || p.polcmd::text || '|'
                || array_to_string(ARRAY(
                     SELECT CASE WHEN r.oid = 0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(r.oid)::text END
                       FROM unnest(p.polroles) AS r(oid) ORDER BY 1), ',')
                || '|' || COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
                E'\n' ORDER BY p.polname) FROM pol p), '')
    || E'\n--\n' ||
    COALESCE((SELECT string_agg(f.oid::regprocedure::text || '|' || f.prosecdef::text || '|' || COALESCE(f.proconfig::text, ''),
                                E'\n' ORDER BY f.oid::regprocedure::text)
                FROM pg_catalog.pg_proc f
               WHERE f.oid IN (SELECT d.refobjid FROM pg_catalog.pg_depend d JOIN pol p ON p.oid = d.objid
                                WHERE d.classid = 'pg_catalog.pg_policy'::regclass
                                  AND d.refclassid = 'pg_catalog.pg_proc'::regclass)), ''));
$function$;

REVOKE ALL ON FUNCTION private.whatsapp_messages_policy_fingerprint() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_thread_manifest(p_organization_id uuid, p_instance_ids uuid[], p_phone text, p_since_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_since_id uuid DEFAULT NULL::uuid, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_snap     text := private.whatsapp_messages_policy_fingerprint();
  v_prod     boolean;
  v_master   boolean := COALESCE(public.is_master_user(), false);
  v_boxes    uuid[];
  v_flag     boolean;
  v_strict   boolean := false;
  v_balcao   boolean := false;
  v_out      jsonb;
BEGIN
  -- (0) Tripwire: só responde sob um conjunto de policies revisado.
  IF v_snap = 'aa9b3228f5e4c80130235ca1b286c8b1' THEN
    v_prod := true;
  ELSIF v_snap = '7e5c0bc4e85ec7c8cfd93bb97ae5425b' THEN
    v_prod := false;
  ELSE
    RAISE EXCEPTION 'whatsapp_thread_manifest: policies de whatsapp_messages mudaram (fingerprint %) — revisar a função antes de liberar', v_snap
      USING ERRCODE = '42501';
  END IF;

  -- (1) Org acessível: master, ou membro/gestor ativo (get_my_organization_ids).
  IF p_organization_id IS NULL
     OR (NOT v_master AND NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_organization_id)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- (2) PERMISSIVE: master, ou a org (já provada acima) ∧ can_see_chat(org, tel).
  IF NOT v_master AND NOT COALESCE(public.can_see_chat(p_organization_id, p_phone), false) THEN
    v_boxes := '{}'::uuid[];
  -- (3) RESTRICTIVE instance_read_access: master ∨ admin ativo da org ∨ caixa legível.
  ELSIF v_master OR EXISTS (
          SELECT 1 FROM public.team_members tm
           WHERE tm.user_id = auth.uid() AND tm.is_active
             AND tm.role = 'admin'::public.app_role
             AND tm.organization_id = p_organization_id) THEN
    v_boxes := p_instance_ids;
  ELSE
    v_boxes := ARRAY(SELECT unnest(p_instance_ids)
                     INTERSECT
                     SELECT unnest(private.whatsapp_readable_message_instance_ids()));
  END IF;

  IF v_prod AND cardinality(v_boxes) > 0 THEN
    -- (4) RESTRICTIVE scoped_whatsapp_user_restriction: conjunto, uma vez.
    EXECUTE 'SELECT $1 = ANY(private.whatsapp_restricted_org_ids())'
      INTO v_flag USING p_organization_id;
    IF COALESCE(v_flag, false) THEN
      EXECUTE 'SELECT ARRAY(SELECT unnest($1) INTERSECT SELECT unnest(private.whatsapp_restriction_allowed_ids()))'
        INTO v_boxes USING v_boxes;
    END IF;
    -- (5) RESTRICTIVE strict_owner_related_select: por linha só se a org está no recorte.
    EXECUTE 'SELECT $1 = ANY(private.strict_lead_member_orgs())'
      INTO v_strict USING p_organization_id;
    v_strict := COALESCE(v_strict, false);
    -- (6) RESTRICTIVE riofix_balcao_chat_scope: por linha só com balcão ativo.
    EXECUTE 'SELECT private.riofix_balcao_current_scope() IS NOT NULL' INTO v_balcao;
    v_balcao := COALESCE(v_balcao, false);
  END IF;

  IF NOT v_strict AND NOT v_balcao THEN
    -- Caminho comum: nenhum predicado por linha. Plano estático em cache.
    WITH visible AS (
      SELECT m.id, m.xmin::text AS revision, m.timestamp
      FROM public.whatsapp_messages m
      WHERE m.organization_id = p_organization_id
        AND m.instance_id = ANY(v_boxes)
        AND m.normalized_phone = p_phone
        AND (p_since_timestamp IS NULL OR (m.timestamp, m.id) >= (p_since_timestamp, p_since_id))
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT CASE WHEN p_since_timestamp IS NULL THEN 100 ELSE NULL END
    ), snapshot AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revision', revision)
        ORDER BY timestamp, id), '[]'::jsonb) AS manifest,
        md5(COALESCE(string_agg(id::text || ':' || revision, ',' ORDER BY timestamp, id), '')) AS fingerprint
      FROM visible
    ) SELECT jsonb_build_object('fingerprint', fingerprint,
      'unchanged', fingerprint IS NOT DISTINCT FROM p_fingerprint,
      'manifest', CASE WHEN fingerprint IS NOT DISTINCT FROM p_fingerprint THEN NULL ELSE manifest END)
      INTO v_out
      FROM snapshot;
    RETURN v_out;
  END IF;

  -- Recorte por linha (org strict e/ou balcão Riofix): mesmo SELECT, com os
  -- predicados das policies por linha. O texto é CONSTANTE — só escolhe quais
  -- dos dois predicados entram; todo valor vai por USING.
  EXECUTE format($q$
    WITH visible AS (
      SELECT m.id, m.xmin::text AS revision, m.timestamp
      FROM public.whatsapp_messages m
      WHERE m.organization_id = $1
        AND m.instance_id = ANY($2)
        AND m.normalized_phone = $3
        AND ($4::timestamptz IS NULL OR (m.timestamp, m.id) >= ($4, $5))
        AND %s
        AND %s
      ORDER BY m.timestamp DESC, m.id DESC
      LIMIT CASE WHEN $4::timestamptz IS NULL THEN 100 ELSE NULL END
    ), snapshot AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'revision', revision)
        ORDER BY timestamp, id), '[]'::jsonb) AS manifest,
        md5(COALESCE(string_agg(id::text || ':' || revision, ',' ORDER BY timestamp, id), '')) AS fingerprint
      FROM visible
    ) SELECT jsonb_build_object('fingerprint', fingerprint,
      'unchanged', fingerprint IS NOT DISTINCT FROM $6,
      'manifest', CASE WHEN fingerprint IS NOT DISTINCT FROM $6 THEN NULL ELSE manifest END)
      FROM snapshot
  $q$,
    CASE WHEN v_strict THEN 'private.strict_phone_visible($1, m.lead_id, $3)' ELSE 'true' END,
    CASE WHEN v_balcao THEN 'private.riofix_balcao_caller_chat($1, m.lead_id, $3)' ELSE 'true' END)
  INTO v_out
  USING p_organization_id, v_boxes, p_phone, p_since_timestamp, p_since_id, p_fingerprint;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamp with time zone, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_thread_manifest(uuid, uuid[], text, timestamp with time zone, uuid, text) TO authenticated;

-- Falha fechada no apply: o conjunto de policies TEM de ser um dos revisados.
DO $tripwire$
DECLARE
  v_snap text := private.whatsapp_messages_policy_fingerprint();
BEGIN
  IF v_snap NOT IN ('aa9b3228f5e4c80130235ca1b286c8b1', '7e5c0bc4e85ec7c8cfd93bb97ae5425b') THEN
    RAISE EXCEPTION 'tripwire: policies de leitura de whatsapp_messages divergem das revisadas (fingerprint %) — abortado', v_snap;
  END IF;
  IF v_snap = 'aa9b3228f5e4c80130235ca1b286c8b1' AND (
       to_regprocedure('private.whatsapp_restricted_org_ids()') IS NULL
    OR to_regprocedure('private.whatsapp_restriction_allowed_ids()') IS NULL
    OR to_regprocedure('private.strict_lead_member_orgs()') IS NULL
    OR to_regprocedure('private.strict_phone_visible(uuid,uuid,text)') IS NULL
    OR to_regprocedure('private.riofix_balcao_current_scope()') IS NULL
    OR to_regprocedure('private.riofix_balcao_caller_chat(uuid,uuid,text)') IS NULL) THEN
    RAISE EXCEPTION 'tripwire: policies de prod sem as funções private.* que elas chamam — abortado';
  END IF;
END
$tripwire$;

NOTIFY pgrst, 'reload schema';
