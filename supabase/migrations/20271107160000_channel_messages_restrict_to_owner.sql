-- 20271107160000_channel_messages_restrict_to_owner.sql
--
-- ⚠ VERSÃO PROVISÓRIA. Renumerar contra o ledger de prod (schema_migrations)
--   na hora de aplicar.
--
-- ── O DEFEITO (lido em prod, pg_policies, 2026-10-06) ──────────────────────
-- channel_messages tinha DUAS policies PERMISSIVE de SELECT:
--   channel_messages_org_access       organization_id IN get_my_organization_ids()
--   channel_messages_select_by_owner  idem AND can_see_chat_scope(org, lead, phone)
-- PERMISSIVE combina por OR: a primeira contém a segunda, então o recorte por
-- responsável era DECORATIVO. Numa org com chat_restrict_to_owner = true,
-- qualquer membro lia toda mensagem da org (Instagram/Facebook/WhatsApp via
-- NotificaMe), por REST e por Realtime (a tabela está em supabase_realtime).
-- whatsapp_messages não tem esse furo: lá só existe a policy com o escopo.
--
-- Exposição medida em 2026-10-06: ZERO linha lida indevidamente hoje. As 3 orgs
-- restritas: Goletric Pinheiros (25.961 mensagens de Instagram, mas suspensa →
-- org_access_blocked, e 0 membros ativos), Goletric Perdizes (suspensa, 0
-- mensagens), Riofix (ativa, 9 membros, 0 mensagens e 0 canais sociais).
-- O furo é LATENTE: abre no dia em que a Riofix conectar um canal NotificaMe ou
-- a Pinheiros for reativada.
--
-- ── O CONSERTO ─────────────────────────────────────────────────────────────
-- Uma policy de SELECT só, com a semântica de whatsapp_messages:
--   * org NÃO restrita → todo leitor da org vê tudo (inclusive gestor de
--     portfólio, que não é team_member — idêntico ao org_access de hoje);
--   * org restrita     → só quem can_see_chat_scope libera (master, admin,
--     leads.view_all explícito, responsável pelo lead, leads.view_unassigned).
--
-- Performance: o ramo "org não restrita" é um InitPlan (o helper depende só de
-- auth.uid()), então nas orgs sem a política não sobra função DEFINER por
-- linha — hoje, para o membro comum, o OR já curto-circuitava no org_access;
-- agora curto-circuita no InitPlan. can_see_chat_scope por linha só roda em
-- org restrita, e fica por ÚLTIMO no OR.
--
-- Não muda: channel_messages_instance_read_access (RESTRICTIVE),
-- channel_messages_service_role, master_all_channel_messages. Escrita por
-- authenticated não existe (grant é SELECT-only desde 20270815104500); webhook
-- e RPCs escrevem como service_role / DEFINER.
--
-- ── COMO APLICAR ───────────────────────────────────────────────────────────
-- ALTER/DROP POLICY pega ACCESS EXCLUSIVE em channel_messages (39.809 linhas,
-- 122 MB). lock_timeout curto: se a fila do lock não andar, falha e reaplica.
-- Rollback: supabase/migrations/rollback/20271107160000_channel_messages_restrict_to_owner.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- Orgs do chamador em que a política de dono está DESLIGADA. Depende só de
-- auth.uid(): avaliada uma vez por consulta (InitPlan) dentro da policy.
CREATE FUNCTION private.chat_unrestricted_org_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(o.id), ARRAY[]::uuid[])
    FROM public.get_my_organization_ids() AS m(org_id)
    JOIN public.organizations o ON o.id = m.org_id
   WHERE NOT COALESCE(o.chat_restrict_to_owner, false);
$$;

COMMENT ON FUNCTION private.chat_unrestricted_org_ids() IS
  'Orgs acessíveis ao chamador (get_my_organization_ids) com chat_restrict_to_owner desligado. Ramo InitPlan da policy de SELECT de channel_messages.';

REVOKE ALL ON FUNCTION private.chat_unrestricted_org_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.chat_unrestricted_org_ids() FROM anon;
REVOKE ALL ON FUNCTION private.chat_unrestricted_org_ids() FROM service_role;
GRANT EXECUTE ON FUNCTION private.chat_unrestricted_org_ids() TO authenticated;

DROP POLICY channel_messages_org_access ON public.channel_messages;

ALTER POLICY channel_messages_select_by_owner ON public.channel_messages
  TO authenticated
  USING (
    organization_id = ANY ((SELECT private.chat_unrestricted_org_ids())::uuid[])
    OR (
      organization_id IN (SELECT public.get_my_organization_ids())
      AND public.can_see_chat_scope(
        organization_id, lead_id, public.normalize_brazilian_phone(phone_number))
    )
  );

-- Guarda: nenhuma outra PERMISSIVE de SELECT para leitor comum pode sobrar, ou
-- o recorte volta a ser decorativo.
DO $$
DECLARE
  v_extra text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO v_extra
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'channel_messages'
     AND permissive = 'PERMISSIVE'
     AND cmd IN ('SELECT', 'ALL')
     AND policyname NOT IN ('channel_messages_select_by_owner',
                            'channel_messages_service_role',
                            'master_all_channel_messages');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'channel_messages ainda tem PERMISSIVE de leitura fora do escopo: %', v_extra;
  END IF;
END
$$;

COMMIT;
