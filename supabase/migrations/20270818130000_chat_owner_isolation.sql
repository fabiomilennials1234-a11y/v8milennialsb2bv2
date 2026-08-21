-- ============================================================================
-- Politica de isolamento por responsavel no chat (PRD #1629, fatia #1633)
--
-- REGRA: o membro ve o chat de um lead se, e somente se, ve o lead.
--
-- ESTADO ANTES DESTA MIGRATION, medido em producao 2026-08-17:
--   whatsapp_messages tinha TRES policies SELECT permissivas. Policies
--   permissivas se combinam por OR, e uma delas era
--     organization_id = get_user_organization_id()
--   ou seja, todo membro lia toda conversa da org. A policy restritiva ao lado
--   (whatsapp_messages_select_by_responsibility) era letra morta duas vezes:
--   anulada pelo OR, e apoiada em `assigned_to`, preenchida em 0 de 2.472.395
--   linhas.
--
-- COBERTURA DO CASAMENTO: normalized_phone esta preenchida em 2.472.395 de
-- 2.472.395 linhas de whatsapp_messages (100%), com indice; e `leads` tem
-- indice UNIQUE (organization_id, normalized_phone), entao a relacao
-- conversa<->lead e 1:1 dentro da org. Nao ha coluna denormalizada de dono,
-- nao ha trigger e nao ha backfill: reatribuir um lead move a conversa na hora.
--
-- NO-OP COM A POLITICA DESLIGADA. chat_restrict_to_owner nasce false nas 104
-- orgs; enquanto estiver false o predicado devolve true para qualquer membro
-- da org, reproduzindo exatamente o comportamento de hoje.
-- ============================================================================

-- ============================================================
-- 1) O interruptor da organizacao
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS chat_restrict_to_owner boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.chat_restrict_to_owner IS
  'Politica de isolamento por responsavel. Ligada, o membro nao-admin so alcanca o chat dos leads de que e responsavel, e o default global de leads.view_all deixa de valer (so override explicito abre). Escrita apenas via set_org_chat_restriction() -- a tabela nao tem policy de UPDATE para admin de org.';

-- ============================================================
-- 2) O predicado canonico
-- ============================================================
-- SECURITY DEFINER e requisito, nao estilo: subquery direta em `leads` dentro
-- da expressao de uma policy faz o Postgres avaliar a RLS de `leads`, o que
-- dispara a recursao documentada no CLAUDE.md.
--
-- AS QUATRO COLUNAS DE RESPONSAVEL. leads_select_by_responsibility_and_permissions
-- usa pre_sale_responsible_id, sale_responsible_id, sdr_id e closer_id. Elas nao
-- estao unificadas: closer_id diverge de sale_responsible_id em 7.702 leads e
-- sdr_id de pre_sale_responsible_id em 1.503. Espelhar as quatro e o que torna
-- "ve o chat sse ve o lead" literalmente verdade.
--
-- is_user_admin() NAO e org-aware (devolve true se o usuario e admin em
-- QUALQUER org). Isso e espelhado de proposito: e o que a policy de `leads`
-- usa, e divergir aqui criaria lead visivel com chat sumido para admin
-- multi-org. A escrita da politica (funcao 3) usa checagem org-aware.
CREATE OR REPLACE FUNCTION public.can_see_chat(p_org_id uuid, p_normalized_phone text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF public.is_user_admin() THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes desta migration.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal. Com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer -- so uma linha EXPLICITA em member_feature_permissions
  -- abre a visao. E isso que faz o contratado novo nascer restrito sem o
  -- admin precisar lembrar de nada.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id  = p_org_id
      AND l.normalized_phone = p_normalized_phone
      AND l.deleted_at IS NULL
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$$;

COMMENT ON FUNCTION public.can_see_chat(uuid, text) IS
  'Predicado canonico do isolamento de chat. Consumido pelas policies de whatsapp_messages e pelo gate de escrita do whatsapp-api-proxy. Devolve true quando: master; admin; politica da org desligada; override explicito leads.view_all; ou existe lead com esse normalized_phone de que o usuario e responsavel (4 colunas) -- ou sem responsavel, com override explicito leads.view_unassigned.';

REVOKE ALL ON FUNCTION public.can_see_chat(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 3) A escrita da politica
-- ============================================================
-- `organizations` nao tem policy de UPDATE para admin de org -- so
-- master_all_organizations. E esse par (tabela write-locked + RPC que
-- autoriza) que torna a politica inalteravel pelo membro.
--
-- Aqui a checagem de admin E org-aware: escrever politica de uma org que voce
-- nao administra e outra coisa, e errada em qualquer leitura.
-- permission_audit_log.table_name tem CHECK com vocabulario fechado, e ele so
-- admite 'organization_role_permissions' (tabela que nao existe mais em
-- producao -- to_regclass = NULL) e 'feature_permissions'. Abrir para
-- 'organizations', que e onde a politica passa a morar.
ALTER TABLE public.permission_audit_log
  DROP CONSTRAINT IF EXISTS permission_audit_log_table_name_check;

ALTER TABLE public.permission_audit_log
  ADD CONSTRAINT permission_audit_log_table_name_check
  CHECK (table_name = ANY (ARRAY[
    'organization_role_permissions'::text,
    'feature_permissions'::text,
    'organizations'::text
  ]));

CREATE OR REPLACE FUNCTION public.set_org_chat_restriction(p_org_id uuid, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old boolean;
BEGIN
  IF p_org_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'set_org_chat_restriction: argumentos obrigatorios' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = auth.uid()
        AND organization_id = p_org_id
        AND role = 'admin'
        AND is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'forbidden: apenas admin da organizacao altera esta politica'
      USING ERRCODE = '42501';
  END IF;

  SELECT chat_restrict_to_owner INTO v_old FROM public.organizations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organizacao nao encontrada' USING ERRCODE = '02000';
  END IF;

  UPDATE public.organizations
  SET chat_restrict_to_owner = p_enabled
  WHERE id = p_org_id;

  INSERT INTO public.permission_audit_log
    (organization_id, changed_by_user_id, changed_by_role, table_name,
     permission_key, role, old_enabled, new_enabled)
  VALUES
    (p_org_id, auth.uid(),
     CASE WHEN public.is_master_user() THEN 'master' ELSE 'admin' END,
     'organizations', 'chat_restrict_to_owner', 'member', v_old, p_enabled);

  RETURN p_enabled;
END;
$$;

COMMENT ON FUNCTION public.set_org_chat_restriction(uuid, boolean) IS
  'Unico caminho de escrita da politica de isolamento de chat. Autoriza antes de agir: master, ou admin ATIVO na org alvo. Registra em permission_audit_log.';

REVOKE ALL ON FUNCTION public.set_org_chat_restriction(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_chat_restriction(uuid, boolean) TO authenticated;

-- ============================================================
-- 4) Consolidar as policies de whatsapp_messages
-- ============================================================
-- As duas que caem sao: a que escancara por org, e a que depende de
-- assigned_to (0 de 2.472.395 preenchidas). master_select_all_whatsapp_messages
-- fica.
DROP POLICY IF EXISTS "whatsapp_messages_select_org"             ON public.whatsapp_messages;
DROP POLICY IF EXISTS "whatsapp_messages_select_by_responsibility" ON public.whatsapp_messages;

CREATE POLICY "whatsapp_messages_select_by_owner"
  ON public.whatsapp_messages FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat(organization_id, normalized_phone)
  );

-- whatsapp_messages_update_org e org-wide em producao
-- (organization_id = get_user_organization_id()) e faz OR com a restritiva ao
-- lado -- a mesma armadilha do SELECT, um andar abaixo.
--
-- Pelo PostgREST ela nao e alcancavel: todo filtro referencia uma coluna, e ai
-- o Postgres aplica tambem a policy de SELECT para localizar as linhas alvo.
-- Por SQL direto (RPC, edge function assinando com o JWT do usuario) ela e.
--
-- Sonda executada como role `authenticated` em 2026-08-17, com a politica
-- ligada e duas conversas na org -- uma do lead do Member1, outra do lead de
-- outro responsavel:
--   controle positivo: SELECT devolveu 1 linha (so a do proprio lead)
--   UPDATE sem WHERE:  alterou 2 linhas (invadiu a do colega)
-- Depois deste DROP, a mesma sonda altera 1.
DROP POLICY IF EXISTS "whatsapp_messages_update_org"              ON public.whatsapp_messages;
DROP POLICY IF EXISTS "whatsapp_messages_update_by_responsibility" ON public.whatsapp_messages;

CREATE POLICY "whatsapp_messages_update_by_owner"
  ON public.whatsapp_messages FOR UPDATE
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat(organization_id, normalized_phone)
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat(organization_id, normalized_phone)
  );
