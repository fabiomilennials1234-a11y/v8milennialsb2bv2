-- ROLLBACK de 20270826000000_org_suspensa_corta_acesso.sql
--
-- Devolve os helpers ao comportamento anterior (acesso ignora status da
-- assinatura). NÃO derruba org_access_blocked() nem
-- get_my_member_organization_ids(): a policy de organizations e a RPC de
-- status passam a apontar de volta para o comportamento antigo, e as duas
-- funções ficam órfãs — inofensivas. Dropá-las exigiria recriar grants.

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_team_admin_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_team_member_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT id FROM public.team_members WHERE user_id = auth.uid() AND is_active = true;
$function$;

DROP POLICY IF EXISTS "Users can see their organization" ON public.organizations;
CREATE POLICY "Users can see their organization"
  ON public.organizations
  FOR SELECT
  USING (id IN (SELECT public.get_my_organization_ids()));

-- org_get_subscription_status volta a usar assert_org_access e o is_blocked inline.
CREATE OR REPLACE FUNCTION public.org_get_subscription_status(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org RECORD;
  v_overdue_since TIMESTAMPTZ;
  v_grace_remaining INTEGER;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT subscription_status, subscription_plan, subscription_expires_at, billing_override
  INTO v_org FROM public.organizations WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','expired','is_valid',false,'days_remaining',0,'grace_remaining',0);
  END IF;

  IF v_org.subscription_status = 'overdue' THEN
    SELECT MIN(created_at) INTO v_overdue_since
    FROM public.payment_history WHERE organization_id = p_org_id AND status = 'overdue';
    IF v_overdue_since IS NOT NULL THEN
      v_grace_remaining := GREATEST(7 - EXTRACT(DAY FROM NOW() - v_overdue_since)::INTEGER, 0);
    ELSE
      v_grace_remaining := 7;
    END IF;
  ELSE
    v_grace_remaining := NULL;
  END IF;

  RETURN jsonb_build_object(
    'status', v_org.subscription_status,
    'plan', v_org.subscription_plan,
    'expires_at', v_org.subscription_expires_at,
    'billing_override', COALESCE(v_org.billing_override, false),
    'is_valid', v_org.subscription_status IN ('active','trial','overdue') OR COALESCE(v_org.billing_override, false),
    'days_remaining', CASE WHEN v_org.subscription_expires_at IS NOT NULL
                        THEN GREATEST(EXTRACT(DAY FROM v_org.subscription_expires_at - NOW())::INTEGER, 0)
                        ELSE NULL END,
    'grace_remaining', v_grace_remaining,
    'is_overdue', v_org.subscription_status = 'overdue',
    'is_blocked', v_org.subscription_status IN ('suspended','cancelled','expired')
                    AND NOT COALESCE(v_org.billing_override, false)
  );
END;
$function$;
