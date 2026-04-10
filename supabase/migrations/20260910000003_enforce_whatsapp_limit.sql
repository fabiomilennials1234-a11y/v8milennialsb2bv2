-- ============================================================
-- Migration: WhatsApp instance limit enforcement trigger
-- Feature: org-quota-enforcement
-- Traces: REQ-Q07
-- Depends on: 20260910000002_quota_resolution_rpcs
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_whatsapp_instance_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota JSONB;
BEGIN
  -- Lock org row to serialize concurrent inserts
  PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;

  -- Resolve quota (includes current usage count)
  v_quota := public.org_resolve_quota(NEW.organization_id, 'max_whatsapp_instances');

  -- Enforce: block if not unlimited AND at or over limit
  IF NOT (v_quota->>'is_unlimited')::BOOLEAN
     AND NOT (v_quota->>'can_add')::BOOLEAN
  THEN
    RAISE EXCEPTION 'Limite de instâncias WhatsApp atingido. Uso: %/%. Contrate mais ou contate o administrador.',
      (v_quota->>'current_usage')::INTEGER,
      (v_quota->>'effective_limit')::INTEGER
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to whatsapp_instances table
DROP TRIGGER IF EXISTS trg_enforce_whatsapp_instance_limit ON public.whatsapp_instances;

CREATE TRIGGER trg_enforce_whatsapp_instance_limit
  BEFORE INSERT ON public.whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_whatsapp_instance_limit();
