-- Onda 2 fix QA — audit_table_change role lookup
--
-- T25 detectou: trigger lia current_setting('request.jwt.claim.role')
-- (formato antigo PostgREST). Atual PostgREST seta 'request.jwt.claims' como
-- JSON inteiro. Trigger não disparava → audit_log vazio.
--
-- Fix: parse role do JSON 'request.jwt.claims'.

CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_func text;
  v_org uuid;
  v_row_id text;
  v_changes jsonb;
  v_claims_raw text;
  v_claims jsonb;
BEGIN
  -- Captura role: tenta formato novo (JSON claims), depois antigo (claim.role)
  BEGIN
    v_claims_raw := current_setting('request.jwt.claims', true);
    IF v_claims_raw IS NOT NULL AND v_claims_raw <> '' THEN
      v_claims := v_claims_raw::jsonb;
      v_role := v_claims->>'role';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  IF v_role IS NULL THEN
    BEGIN
      v_role := current_setting('request.jwt.claim.role', true);
    EXCEPTION WHEN OTHERS THEN
      v_role := NULL;
    END;
  END IF;

  -- Skip se não é service_role
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Captura nome da edge function (header opcional)
  BEGIN
    v_func := current_setting('request.headers', true)::jsonb->>'x-edge-function';
  EXCEPTION WHEN OTHERS THEN
    v_func := NULL;
  END;

  v_org := COALESCE(
    (to_jsonb(NEW)->>'organization_id')::uuid,
    (to_jsonb(OLD)->>'organization_id')::uuid
  );

  v_row_id := COALESCE(
    (to_jsonb(NEW)->>'id'),
    (to_jsonb(OLD)->>'id')
  );

  IF TG_OP = 'UPDATE' THEN
    v_changes := jsonb_build_object(
      'before', to_jsonb(OLD),
      'after', to_jsonb(NEW)
    );
  ELSE
    v_changes := NULL;
  END IF;

  INSERT INTO public.audit_log (
    table_name, operation, row_id, organization_id,
    actor_role, actor_function, changes
  ) VALUES (
    TG_TABLE_NAME, TG_OP, v_row_id, v_org,
    v_role, v_func, v_changes
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.audit_table_change() IS
  'Onda 2 T2.A.3 (fix QA): captura role via request.jwt.claims (JSON) com fallback request.jwt.claim.role.';
