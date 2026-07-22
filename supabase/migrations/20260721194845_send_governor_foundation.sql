-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260721194845  name: send_governor_foundation
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- Send Governor — Foundation (PR-0, SHADOW mode) [anti-ban WhatsApp]
-- ADDITIVE, non-destructive. Substrate + pure decision logic; NO enforcement.
-- Every org defaults to send_governor_mode='off' (governor inert).

-- 1. Per-number reputation state machine
CREATE TABLE IF NOT EXISTS public.whatsapp_instance_reputation (
  instance_id          uuid PRIMARY KEY
                         REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL
                         REFERENCES public.organizations(id) ON DELETE CASCADE,
  state                text NOT NULL DEFAULT 'healthy'
                         CHECK (state IN ('healthy', 'warming', 'quarantined')),
  quarantine_until     timestamptz,
  last_ban_signal_at   timestamptz,
  ban_signal_count_24h integer NOT NULL DEFAULT 0 CHECK (ban_signal_count_24h >= 0),
  warmup_started_at    timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_instance_reputation IS
  'Per-number reputation state machine for the Send Governor (anti-ban). state healthy/warming/quarantined. quarantined + unexpired quarantine_until blocks automation/mass sends (P3 disjuntor); manual is always exempt. Written exclusively by SECURITY DEFINER RPCs (record_ban_signal / set_instance_reputation) via service_role. Read fail-open by the governor.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_reputation_org
  ON public.whatsapp_instance_reputation (organization_id);

ALTER TABLE public.whatsapp_instance_reputation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_select" ON public.whatsapp_instance_reputation;
CREATE POLICY "tenant_isolation_select" ON public.whatsapp_instance_reputation
  FOR SELECT USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  );

GRANT SELECT ON public.whatsapp_instance_reputation TO authenticated;
GRANT ALL    ON public.whatsapp_instance_reputation TO service_role;
REVOKE ALL   ON public.whatsapp_instance_reputation FROM anon;

-- 2. Per-number-per-day automation send ledger (mirrors blast_instance_daily_usage)
CREATE TABLE IF NOT EXISTS public.automation_instance_daily_usage (
  instance_id uuid    NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  usage_date  date    NOT NULL,
  sent        integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, usage_date)
);

COMMENT ON TABLE public.automation_instance_daily_usage IS
  'Per-number-per-day ledger of AUTOMATION sends from each WhatsApp number (Send Governor P1/P2). usage_date = America/Sao_Paulo calendar date. Incremented atomically by increment_automation_daily_usage() AFTER a real successful send. Mirrors blast_instance_daily_usage; distinct ledger so mass and automation counts never collide.';

ALTER TABLE public.automation_instance_daily_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_select" ON public.automation_instance_daily_usage;
CREATE POLICY "tenant_isolation_select" ON public.automation_instance_daily_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_instances wi
      WHERE wi.id = automation_instance_daily_usage.instance_id
        AND wi.organization_id IN (SELECT public.get_my_organization_ids())
    )
    OR public.is_master_user(auth.uid())
  );

GRANT SELECT ON public.automation_instance_daily_usage TO authenticated;
GRANT ALL    ON public.automation_instance_daily_usage TO service_role;
REVOKE ALL   ON public.automation_instance_daily_usage FROM anon;

-- 3. Per-org Send Governor switches (all default to inert)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_mode text NOT NULL DEFAULT 'off'
    CHECK (send_governor_mode IN ('off', 'shadow', 'enforce'));
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_warmup_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_cold_gate_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.send_governor_mode IS
  'Send Governor mode: off (inert/allow all) | shadow (evaluate + log, never block) | enforce (apply decision). Default off. PR-0 wires shadow only.';
COMMENT ON COLUMN public.organizations.send_governor_warmup_enabled IS
  'When true, the governor tightens the per-number automation cap by a warm-up ramp derived from the number age (P2). Default false.';
COMMENT ON COLUMN public.organizations.send_governor_cold_gate_enabled IS
  'When true, the governor blocks automation to cold contacts (no prior inbound message + no opt-in) under enforce (P4). Default false.';

-- 4a. Atomic UPSERT-increment RPC (per-number automation usage)
CREATE OR REPLACE FUNCTION public.increment_automation_daily_usage(
  p_instance_id uuid,
  p_usage_date  date,
  p_count       integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    SELECT COALESCE(sent, 0) INTO v_total
    FROM public.automation_instance_daily_usage
    WHERE instance_id = p_instance_id AND usage_date = p_usage_date;
    RETURN COALESCE(v_total, 0);
  END IF;

  INSERT INTO public.automation_instance_daily_usage (instance_id, usage_date, sent)
  VALUES (p_instance_id, p_usage_date, p_count)
  ON CONFLICT (instance_id, usage_date)
  DO UPDATE SET
    sent       = public.automation_instance_daily_usage.sent + EXCLUDED.sent,
    updated_at = now()
  RETURNING sent INTO v_total;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.increment_automation_daily_usage(uuid, date, integer) IS
  'Atomically add p_count to a number automation_instance_daily_usage row for p_usage_date. Called by the Send Governor via service_role AFTER a real successful send. Returns the post-increment day total.';

-- 4b. Record a ban signal + advance the reputation state machine
CREATE OR REPLACE FUNCTION public.record_ban_signal(
  p_instance_id uuid,
  p_code        integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id            uuid;
  v_prev_at           timestamptz;
  v_prev_count        integer;
  v_prev_state        text;
  v_prev_qu           timestamptz;
  v_new_count         integer;
  v_should_quarantine boolean;
  v_new_state         text;
  v_quarantine_until  timestamptz;
BEGIN
  SELECT wi.organization_id INTO v_org_id
  FROM public.whatsapp_instances wi
  WHERE wi.id = p_instance_id;
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  SELECT last_ban_signal_at, ban_signal_count_24h, state, quarantine_until
    INTO v_prev_at, v_prev_count, v_prev_state, v_prev_qu
  FROM public.whatsapp_instance_reputation
  WHERE instance_id = p_instance_id;

  IF v_prev_at IS NOT NULL AND v_prev_at > now() - interval '24 hours' THEN
    v_new_count := COALESCE(v_prev_count, 0) + 1;
  ELSE
    v_new_count := 1;
  END IF;

  v_should_quarantine := (p_code = 463) OR (v_new_count >= 3);

  IF v_should_quarantine THEN
    v_new_state := 'quarantined';
    v_quarantine_until := now() + CASE WHEN p_code = 463
                                       THEN interval '24 hours'
                                       ELSE interval '1 hour' END;
  ELSE
    v_new_state := COALESCE(v_prev_state, 'healthy');
    v_quarantine_until := v_prev_qu;
  END IF;

  INSERT INTO public.whatsapp_instance_reputation (
    instance_id, organization_id, state, quarantine_until,
    last_ban_signal_at, ban_signal_count_24h, updated_at
  )
  VALUES (
    p_instance_id, v_org_id, v_new_state, v_quarantine_until,
    now(), v_new_count, now()
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    state                = EXCLUDED.state,
    quarantine_until     = EXCLUDED.quarantine_until,
    last_ban_signal_at   = EXCLUDED.last_ban_signal_at,
    ban_signal_count_24h = EXCLUDED.ban_signal_count_24h,
    organization_id      = EXCLUDED.organization_id,
    updated_at           = now();
END;
$$;

COMMENT ON FUNCTION public.record_ban_signal(uuid, integer) IS
  'Record a ban-ish provider signal (463/429) for a number and advance its reputation. Rolling 24h count; 463 OR 3rd-in-24h -> quarantined (24h for 463, 1h otherwise). service_role only, best-effort. Never un-quarantines.';

-- 4c. Explicit reputation set (recovery / manual / warm-up start)
CREATE OR REPLACE FUNCTION public.set_instance_reputation(
  p_instance_id      uuid,
  p_state            text,
  p_quarantine_until timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF p_state NOT IN ('healthy', 'warming', 'quarantined') THEN
    RAISE EXCEPTION 'invalid reputation state: %', p_state;
  END IF;

  SELECT wi.organization_id INTO v_org_id
  FROM public.whatsapp_instances wi
  WHERE wi.id = p_instance_id;
  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_instance_reputation (
    instance_id, organization_id, state, quarantine_until, warmup_started_at, updated_at
  )
  VALUES (
    p_instance_id, v_org_id, p_state, p_quarantine_until,
    CASE WHEN p_state = 'warming' THEN now() ELSE NULL END, now()
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    state             = EXCLUDED.state,
    quarantine_until  = EXCLUDED.quarantine_until,
    warmup_started_at = CASE
                          WHEN EXCLUDED.state = 'warming'
                               AND public.whatsapp_instance_reputation.warmup_started_at IS NULL
                            THEN now()
                          ELSE public.whatsapp_instance_reputation.warmup_started_at
                        END,
    updated_at        = now();
END;
$$;

COMMENT ON FUNCTION public.set_instance_reputation(uuid, text, timestamptz) IS
  'Upsert a number reputation state (healthy/warming/quarantined) + quarantine_until. Used by recovery jobs / warm-up start. service_role only.';

-- 4d. Grants (REVOKE-FROM-PUBLIC gotcha)
REVOKE ALL ON FUNCTION public.increment_automation_daily_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_automation_daily_usage(uuid, date, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_ban_signal(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ban_signal(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_instance_reputation(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_instance_reputation(uuid, text, timestamptz) TO service_role;
