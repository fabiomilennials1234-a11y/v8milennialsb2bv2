-- Sync organizations.plan_id ↔ subscription_plan + auto-provisioning de org_quotas.
--
-- Bug histórico: orgs criadas via paths legacy setavam só `subscription_plan`
-- (string slug, ex: 'torque-v8') e deixavam `plan_id` NULL. Resultado:
-- `org_quotas.plan_base` era provisionado como 0 e enforce_whatsapp_instance_limit
-- bloqueava criação de instâncias com "Uso: 0/0".
--
-- Backfill executado via REST em 2026-04-28 (45 orgs corrigidas).
-- Esta migration cria o mecanismo preventivo:
-- 1. Função sync_org_plan_quotas: resolve plan_id por subscription_plan name e
--    sincroniza org_quotas.plan_base com subscription_plans.limits.
-- 2. Trigger AFTER INSERT/UPDATE em organizations chama a função.

CREATE OR REPLACE FUNCTION public.sync_org_plan_quotas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
  v_limits JSONB;
  v_resource TEXT;
  v_limit_key TEXT;
  v_value INTEGER;
BEGIN
  -- Resolve plan_id se vazio mas subscription_plan presente.
  IF NEW.plan_id IS NULL AND NEW.subscription_plan IS NOT NULL THEN
    SELECT id INTO v_plan_id
    FROM public.subscription_plans
    WHERE name = NEW.subscription_plan
    LIMIT 1;

    IF v_plan_id IS NOT NULL THEN
      -- Atualiza plan_id sem disparar recursão (UPDATE direto via service_role bypassa)
      UPDATE public.organizations SET plan_id = v_plan_id WHERE id = NEW.id;
      NEW.plan_id := v_plan_id;
    END IF;
  END IF;

  -- Sincroniza org_quotas.plan_base usando subscription_plans.limits.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT limits INTO v_limits
    FROM public.subscription_plans
    WHERE id = NEW.plan_id;

    IF v_limits IS NOT NULL THEN
      -- Mapeia cada resource (max_whatsapp_instances, max_copilot_agents, max_users)
      FOR v_resource, v_limit_key IN
        SELECT 'max_whatsapp_instances', 'max_whatsapp_instances'
        UNION ALL SELECT 'max_copilot_agents', 'max_copilot_agents'
        UNION ALL SELECT 'max_users', 'max_users'
      LOOP
        v_value := COALESCE((v_limits->>v_limit_key)::INTEGER, 0);

        INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
        VALUES (NEW.id, v_resource, v_value)
        ON CONFLICT (organization_id, resource_key) DO UPDATE
        SET plan_base = EXCLUDED.plan_base,
            updated_at = NOW();
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_org_plan_quotas IS
  'Resolve plan_id via subscription_plan name + provisiona/atualiza org_quotas.plan_base. '
  'Trigger AFTER INSERT/UPDATE em organizations. Backfill manual feito 2026-04-28 (45 orgs).';

DROP TRIGGER IF EXISTS trg_sync_org_plan_quotas ON public.organizations;

CREATE TRIGGER trg_sync_org_plan_quotas
  AFTER INSERT OR UPDATE OF subscription_plan, plan_id ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_org_plan_quotas();

-- Re-roda sync em todas orgs ativas pra garantir consistência pós-deploy.
DO $outer$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.organizations WHERE plan_id IS NOT NULL LOOP
    UPDATE public.organizations
    SET updated_at = updated_at
    WHERE id = r.id;
  END LOOP;
END
$outer$;
