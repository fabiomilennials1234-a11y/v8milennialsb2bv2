-- 20270826000010_master_set_org_suspension.sql
--
-- Suspender uma org passa a ser uma operação atômica e auditada — e passa a
-- LIMPAR o billing_override.
--
-- O motivo: `is_blocked` (e agora `org_access_blocked()`) é
-- `status bloqueado AND NOT billing_override`. O botão "Suspender" do Master
-- escrevia só `subscription_status`, deixando o override de pé. Em prod isso
-- tornava a suspensão um no-op silencioso: as 5 orgs hoje `suspended` têm
-- override ligado, e 90 das 107 orgs também têm — suspender qualquer uma delas
-- não bloqueava nada, e a tela do Master mostrava "Suspensa" mesmo assim.
--
-- Reativar NÃO devolve o override. Override é uma concessão comercial
-- deliberada; se precisa voltar, o master usa "Liberar Plano" e o motivo fica
-- registrado de novo.

CREATE OR REPLACE FUNCTION public.master_set_org_suspension(
  _org_id  uuid,
  _suspend boolean,
  _reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_master_id uuid;
  v_before    RECORD;
  v_after     RECORD;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem executar esta acao';
  END IF;

  IF _suspend AND COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Motivo obrigatorio para suspender uma organizacao';
  END IF;

  SELECT id, name, subscription_status, billing_override, billing_override_reason
    INTO v_before
    FROM public.organizations
   WHERE id = _org_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizacao % nao encontrada', _org_id;
  END IF;

  IF _suspend THEN
    UPDATE public.organizations SET
      subscription_status     = 'suspended',
      -- sem isto a suspensão não bloqueia nada
      billing_override        = false,
      billing_override_reason = NULL,
      billing_override_by     = NULL,
      billing_override_at     = NULL,
      updated_at              = NOW()
    WHERE id = _org_id;
  ELSE
    UPDATE public.organizations SET
      subscription_status = 'active',
      updated_at          = NOW()
    WHERE id = _org_id;
  END IF;

  SELECT subscription_status, billing_override
    INTO v_after
    FROM public.organizations
   WHERE id = _org_id;

  SELECT id INTO v_master_id FROM public.master_users WHERE user_id = auth.uid();

  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  VALUES (
    v_master_id,
    auth.uid(),
    CASE WHEN _suspend THEN 'ORG_SUSPEND' ELSE 'ORG_REACTIVATE' END,
    'organization',
    _org_id,
    jsonb_build_object(
      'reason',                   _reason,
      'org_name',                 v_before.name,
      'status_before',            v_before.subscription_status,
      'status_after',             v_after.subscription_status,
      'billing_override_before',  v_before.billing_override,
      'billing_override_after',   v_after.billing_override,
      -- trilha do override revogado: a coluna some, o motivo fica aqui
      'billing_override_reason_revoked',
        CASE WHEN _suspend AND COALESCE(v_before.billing_override, false)
             THEN v_before.billing_override_reason END
    )
  );

  RETURN jsonb_build_object(
    'org_id',                  _org_id,
    'status',                  v_after.subscription_status,
    'billing_override',        v_after.billing_override,
    'override_revogado',       _suspend AND COALESCE(v_before.billing_override, false),
    'acesso_bloqueado',        public.org_access_blocked(_org_id)
  );
END;
$function$;

COMMENT ON FUNCTION public.master_set_org_suspension(uuid, boolean, text) IS
  'Suspende/reativa org. Suspender limpa billing_override (senão a suspensão não bloqueia). Audita em master_audit_logs. Master-only.';

REVOKE ALL ON FUNCTION public.master_set_org_suspension(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_set_org_suspension(uuid, boolean, text) TO authenticated, service_role;
