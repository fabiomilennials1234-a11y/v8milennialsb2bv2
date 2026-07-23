-- Onda 2 — Visibility schema (system_alerts + audit_log)
--
-- Consolida T2.A.1 + T2.A.2 + T2.A.3 + T2.A.4
--
-- Objetivo: master admin enxerga health em 1 tela; org admin vê erros de
-- workflow em UI; mutações via service_role auditadas (compliance + debug).

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.A.1 — system_alerts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  category text NOT NULL,
  source_type text,
  source_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved
  ON public.system_alerts (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_alerts_org
  ON public.system_alerts (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_alerts_category
  ON public.system_alerts (category, created_at DESC);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.system_alerts;
CREATE POLICY "service_role_all" ON public.system_alerts
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "org_select_alerts" ON public.system_alerts;
CREATE POLICY "org_select_alerts" ON public.system_alerts
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "admin_resolve_alerts" ON public.system_alerts;
CREATE POLICY "admin_resolve_alerts" ON public.system_alerts
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

COMMENT ON TABLE public.system_alerts IS
  'Onda 2: alerts de sistema (webhook circuit breaker, dead-letter pattern, etc).';

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.A.2 — audit_log
-- ─────────────────────────────────────────────────────────────────────────────
-- Sem pg_partman em dev — sem particionamento por mês ainda. Cleanup job
-- manual (criar quando audit_log >10M rows). Índices cobrem range queries.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id text NOT NULL,
  organization_id uuid,
  actor_role text NOT NULL,
  actor_function text,
  changes jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_time
  ON public.audit_log (table_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_time
  ON public.audit_log (organization_id, occurred_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_row_time
  ON public.audit_log (table_name, row_id, occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_audit" ON public.audit_log;
CREATE POLICY "service_role_all_audit" ON public.audit_log
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "master_select_audit" ON public.audit_log;
CREATE POLICY "master_select_audit" ON public.audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.master_users WHERE user_id = auth.uid()
    )
    OR organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

COMMENT ON TABLE public.audit_log IS
  'Onda 2: trilha de auditoria de mutações via service_role nas tabelas críticas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.A.3 — função genérica audit_table_change
-- ─────────────────────────────────────────────────────────────────────────────
-- Captura apenas mutações via role=service_role (writes de edge functions).
-- Mutações via authenticated (frontend direto) NÃO são auditadas — RLS já
-- restringe + acesso é por usuário autenticado. Foco aqui é detectar:
--   - Edge function buggy escrevendo dado errado
--   - Cross-tenant leak (org_id divergente entre before/after)
--   - Backfill manual via service_role

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
BEGIN
  -- Captura role do request (set por PostgREST)
  BEGIN
    v_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  -- Skip se não é service_role
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Captura nome da edge function (header opcional injetado pelo wrapper _shared)
  BEGIN
    v_func := current_setting('request.headers.x-edge-function', true);
  EXCEPTION WHEN OTHERS THEN
    v_func := NULL;
  END;

  v_org := COALESCE(
    (NEW->>'organization_id')::uuid,
    (OLD->>'organization_id')::uuid
  );

  -- row_id como text (suporta uuid, bigint, etc)
  v_row_id := COALESCE(
    (to_jsonb(NEW)->>'id'),
    (to_jsonb(OLD)->>'id')
  );

  -- changes apenas em UPDATE (diff completo before/after); INSERT/DELETE
  -- ficam null pra economizar storage (NEW/OLD recuperáveis via row_id+time)
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
  -- Audit nunca quebra a operação principal. Falha silent.
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.audit_table_change() IS
  'Onda 2 T2.A.3: trigger genérica de auditoria. Captura mutações via service_role.';

-- ─────────────────────────────────────────────────────────────────────────────
-- T2.A.4 — aplicar trigger nas 4 tabelas críticas
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS audit_leads ON public.leads;
CREATE TRIGGER audit_leads
  AFTER INSERT OR UPDATE OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

DROP TRIGGER IF EXISTS audit_conversations ON public.conversations;
CREATE TRIGGER audit_conversations
  AFTER INSERT OR UPDATE OR DELETE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

DROP TRIGGER IF EXISTS audit_pending_ai_actions ON public.pending_ai_actions;
CREATE TRIGGER audit_pending_ai_actions
  AFTER INSERT OR UPDATE OR DELETE ON public.pending_ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

DROP TRIGGER IF EXISTS audit_workflow_executions ON public.workflow_executions;
CREATE TRIGGER audit_workflow_executions
  AFTER INSERT OR UPDATE OR DELETE ON public.workflow_executions
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
