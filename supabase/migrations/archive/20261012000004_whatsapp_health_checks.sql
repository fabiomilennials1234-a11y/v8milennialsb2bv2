-- whatsapp_health_checks — per-instance drift snapshots written every 5 min.
--
-- Compares V8-side inbound count for the last hour against Uazapi's
-- /message/find count for the same window. Severe drift triggers an
-- auto-rebind (via whatsapp-rebind-webhook) and a Sentry alert. Persisted
-- snapshots feed the /admin/whatsapp-health dashboard.

CREATE TABLE IF NOT EXISTS public.whatsapp_health_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id       uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  v8_inbound_1h     integer NOT NULL,
  uazapi_inbound_1h integer,                  -- NULL when Uazapi probe failed
  drift_ratio       numeric,                  -- v8_inbound_1h / max(uazapi_inbound_1h, 1)
  status            text NOT NULL CHECK (status IN ('healthy','warning','critical','rebind_triggered','probe_failed','error')),
  action_taken      text,
  notes             text
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_health_checks_instance_time
  ON public.whatsapp_health_checks (instance_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_health_checks_status
  ON public.whatsapp_health_checks (status, checked_at DESC)
  WHERE status IN ('warning', 'critical', 'rebind_triggered');

ALTER TABLE public.whatsapp_health_checks ENABLE ROW LEVEL SECURITY;

-- Read access for master users + org admins of the affected org.
CREATE POLICY whatsapp_health_checks_read
  ON public.whatsapp_health_checks
  FOR SELECT
  TO authenticated
  USING (
    public.is_master_user()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.role = 'admin'
        AND tm.organization_id = whatsapp_health_checks.organization_id
    )
  );

COMMENT ON TABLE public.whatsapp_health_checks IS
  'Per-instance drift snapshots written every 5 minutes by '
  'whatsapp-health-monitor. Critical drift auto-triggers webhook rebind.';
