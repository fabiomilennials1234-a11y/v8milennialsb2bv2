-- 20270826000000_org_suspensa_corta_acesso.sql
--
-- Org suspensa/cancelada/expirada passa a perder acesso aos DADOS, não só à tela.
--
-- Antes: `subscription_status` era conhecido apenas pelo front
-- (SubscriptionProtectedRoute). Qualquer token válido continuava lendo e
-- escrevendo via PostgREST, porque nenhuma policy consultava o status da org.
--
-- Agora: o choke é `get_my_organization_ids()` — 239 policies o consultam.
-- Excluir a org bloqueada dali corta leitura e escrita em toda a superfície de
-- dados de uma vez, sem tocar em policy nenhuma.
--
-- O que continua acessível de propósito, para a tela de bloqueio funcionar e o
-- cliente conseguir regularizar:
--   * `team_members` da própria pessoa  — policy `team_members_select_own`
--     (`user_id = auth.uid()`), independente de org.
--   * `organizations` da própria org    — policy repontada para o helper CRU.
--   * `org_get_subscription_status()`   — passa a exigir vínculo CRU, não acesso.
--
-- Master (`is_master_user()`) e `service_role` seguem passando por fora — as
-- policies de master são independentes e o service_role bypassa RLS.
--
-- Efeito em prod no momento do apply: NENHUM. As 5 orgs hoje `suspended` têm
-- `billing_override = true`, e override vence o bloqueio (mesma regra do
-- `is_blocked` de `org_get_subscription_status`). O gate só passa a morder
-- quando o master suspende limpando o override.

-- ---------------------------------------------------------------------------
-- 1. Predicado único de bloqueio
-- ---------------------------------------------------------------------------
-- Espelha `is_blocked` de `org_get_subscription_status()`. Se um dia divergirem,
-- o front mostra a tela de bloqueio e o banco continua servindo dados (ou o
-- inverso) — por isso a regra mora aqui, e a RPC passa a chamar este predicado.
CREATE OR REPLACE FUNCTION public.org_access_blocked(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT o.subscription_status IN ('suspended', 'cancelled', 'expired')
             AND NOT COALESCE(o.billing_override, false)
      FROM public.organizations o
      WHERE o.id = p_org_id
    ),
    -- org inexistente: não é "bloqueada", é inexistente. Quem chama já trata
    -- ausência de vínculo; devolver true aqui só embaralharia os dois casos.
    false
  );
$function$;

COMMENT ON FUNCTION public.org_access_blocked(uuid) IS
  'true quando a org está suspensa/cancelada/expirada SEM billing_override. Fonte única do bloqueio — usada pelas policies (via get_my_organization_ids) e por org_get_subscription_status.';

-- ---------------------------------------------------------------------------
-- 2. Vínculo CRU — membership sem olhar status de assinatura
-- ---------------------------------------------------------------------------
-- É o corpo que `get_my_organization_ids()` tinha até aqui. Existe para as
-- poucas superfícies que precisam responder MESMO com a org bloqueada
-- (identidade e billing). Não usar em policy de dado de cliente.
CREATE OR REPLACE FUNCTION public.get_my_member_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$;

COMMENT ON FUNCTION public.get_my_member_organization_ids() IS
  'Vínculo CRU: orgs onde o usuário é membro ativo ou gestor de portfólio, IGNORANDO bloqueio de assinatura. Só para identidade e billing. Dado de cliente usa get_my_organization_ids().';

-- ---------------------------------------------------------------------------
-- 3. Helpers de acesso — agora excluem org bloqueada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM public.get_my_member_organization_ids() AS m(org_id)
  WHERE NOT public.org_access_blocked(m.org_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM (
    SELECT organization_id AS org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    UNION
    SELECT * FROM public.get_my_gestor_organization_ids()
  ) AS m
  WHERE NOT public.org_access_blocked(m.org_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_team_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true
    AND NOT public.org_access_blocked(organization_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_team_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
    AND NOT public.org_access_blocked(organization_id);
$function$;

-- ---------------------------------------------------------------------------
-- 4. Superfícies que precisam sobreviver ao bloqueio
-- ---------------------------------------------------------------------------
-- A própria org continua legível: sem isso a tela de bloqueio não sabe nem o
-- nome da org, e o fluxo de regularização morre junto com o acesso.
DROP POLICY IF EXISTS "Users can see their organization" ON public.organizations;
CREATE POLICY "Users can see their organization"
  ON public.organizations
  FOR SELECT
  USING (id IN (SELECT public.get_my_member_organization_ids()));

-- A RPC de status da assinatura é justamente o que a tela de bloqueio consulta.
-- Se ela exigisse `assert_org_access()` (agora gated), responderia 'access_denied'
-- e o front cairia no fallback genérico 'expired' — cliente suspenso veria
-- "expirado". Aqui o gate certo é vínculo CRU.
CREATE OR REPLACE FUNCTION public.org_get_subscription_status(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org RECORD;
  v_overdue_since TIMESTAMPTZ;
  v_grace_remaining INTEGER;
BEGIN
  -- Vínculo CRU: a org bloqueada precisa conseguir ler o próprio status.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_master_user()
     AND (
       p_org_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.get_my_member_organization_ids() AS t(org_id)
         WHERE t.org_id = p_org_id
       )
     )
  THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    subscription_status,
    subscription_plan,
    subscription_expires_at,
    billing_override
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'expired',
      'is_valid', false,
      'days_remaining', 0,
      'grace_remaining', 0
    );
  END IF;

  -- Se overdue, calcular dias de graça restantes
  IF v_org.subscription_status = 'overdue' THEN
    SELECT MIN(created_at)
    INTO v_overdue_since
    FROM public.payment_history
    WHERE organization_id = p_org_id
      AND status = 'overdue';

    IF v_overdue_since IS NOT NULL THEN
      v_grace_remaining := GREATEST(7 - EXTRACT(DAY FROM NOW() - v_overdue_since)::INTEGER, 0);
    ELSE
      v_grace_remaining := 7;
    END IF;
  ELSE
    v_grace_remaining := NULL;
  END IF;

  RETURN jsonb_build_object(
    'status',            v_org.subscription_status,
    'plan',              v_org.subscription_plan,
    'expires_at',        v_org.subscription_expires_at,
    'billing_override',  COALESCE(v_org.billing_override, false),
    'is_valid',          v_org.subscription_status IN ('active', 'trial', 'overdue')
                           OR COALESCE(v_org.billing_override, false),
    'days_remaining',    CASE
                           WHEN v_org.subscription_expires_at IS NOT NULL
                             THEN GREATEST(EXTRACT(DAY FROM v_org.subscription_expires_at - NOW())::INTEGER, 0)
                           ELSE NULL
                         END,
    'grace_remaining',   v_grace_remaining,
    'is_overdue',        v_org.subscription_status = 'overdue',
    -- Fonte única: mesmo predicado que as policies usam.
    'is_blocked',        public.org_access_blocked(p_org_id)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE preserva ACL das funções que já existiam; as duas novas
-- nascem com EXECUTE para PUBLIC e precisam ser fechadas explicitamente.
-- (DROP+CREATE resetaria tudo para PUBLIC — por isso nada aqui é dropado.)
REVOKE ALL ON FUNCTION public.org_access_blocked(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_member_organization_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_access_blocked(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_member_organization_ids() TO authenticated, service_role;
