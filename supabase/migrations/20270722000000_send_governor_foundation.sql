-- ============================================================================
-- Send Governor — Foundation (PR-0, SHADOW mode)   [anti-ban WhatsApp]
-- ============================================================================
-- ADDITIVE, non-destructive. Lays the DB substrate for a single, mandatory
-- choke point on WhatsApp sends (the "Send Governor"). PR-0 ships the substrate
-- + pure decision logic ONLY — NO enforcement is wired. Every org defaults to
-- send_governor_mode='off' (governor inert). The three modes:
--   'off'     → governor never consulted / always allow.
--   'shadow'  → evaluate + log the would-be decision, but NEVER block/defer.
--   'enforce' → apply the decision (future PR; no call-site enforces yet).
--
-- What this migration adds (nothing dropped/rewritten — a prod apply cannot
-- regress any live path):
--   1. whatsapp_instance_reputation  — per-number reputation state machine
--      (healthy / warming / quarantined) fed by 463/429 ban signals.
--   2. automation_instance_daily_usage — per-number-per-day automation send
--      ledger (mirrors blast_instance_daily_usage; the per-number cap P1/P2).
--   3. organizations.send_governor_mode / _warmup_enabled / _cold_gate_enabled
--      — per-org switches (all default OFF/false).
--   4. RPCs (SECURITY DEFINER): increment_automation_daily_usage,
--      record_ban_signal, set_instance_reputation.
--
-- Day boundary: America/Sao_Paulo calendar date (usage_date partition key),
-- identical to blast_daily_usage / blast_instance_daily_usage — the edge
-- function computes the BRT date and passes it in.
--
-- RLS: org scope via public.get_my_organization_ids() (SECURITY DEFINER helper,
-- CLAUDE.md-mandated — avoids the inline team_members RLS-recursion hazard under
-- Realtime). automation_instance_daily_usage has no organization_id of its own
-- (a number belongs to exactly one org via whatsapp_instances) → its policy
-- joins through the parent instance, exactly like blast_instance_daily_usage.
--
-- GRANTS gotcha (project-wide): REVOKE EXECUTE ... FROM anon is a NO-OP — anon
-- inherits EXECUTE via the implicit GRANT TO PUBLIC. Always REVOKE FROM PUBLIC
-- (keeps authenticated + service_role, which hold explicit grants). Verify with
-- has_function_privilege after apply.
--
-- APLICAR dev → prod só com aval explícito do CTO. Não aplicado por esta slice.
-- ============================================================================

-- ── 1. Per-number reputation state machine ──────────────────────────────────
-- One row per WhatsApp number. `state` is the disjuntor input consumed by the
-- governor core (P3): a 'quarantined' number with an unexpired quarantine_until
-- blocks automation/mass (never manual). Fed by record_ban_signal() below.
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
  'Per-number reputation state machine for the Send Governor (anti-ban). '
  'state healthy→warming→quarantined. quarantined + unexpired quarantine_until '
  'blocks automation/mass sends (P3 disjuntor); manual is always exempt. '
  'Written exclusively by SECURITY DEFINER RPCs (record_ban_signal / '
  'set_instance_reputation) via service_role. Read fail-open by the governor.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_reputation_org
  ON public.whatsapp_instance_reputation (organization_id);

ALTER TABLE public.whatsapp_instance_reputation ENABLE ROW LEVEL SECURITY;

-- Tenant read (UI headroom / diagnostics). Reputation carries organization_id
-- directly, so scope is a plain membership check (master sees all). Writes go
-- exclusively through the RPCs (service_role) — clients get NO write grant.
CREATE POLICY "tenant_isolation_select" ON public.whatsapp_instance_reputation
  FOR SELECT USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user()
  );

GRANT SELECT ON public.whatsapp_instance_reputation TO authenticated;
GRANT ALL    ON public.whatsapp_instance_reputation TO service_role;
REVOKE ALL   ON public.whatsapp_instance_reputation FROM anon;

-- ── 2. Per-number-per-day automation send ledger ────────────────────────────
-- Mirrors blast_instance_daily_usage exactly, but counts AUTOMATION sends
-- (copilot turn / follow-up / workflow / pipe / campaign) rather than blasts.
-- The per-number cap (P1) and warm-up ramp (P2) read `sent` for today's row.
CREATE TABLE IF NOT EXISTS public.automation_instance_daily_usage (
  instance_id uuid    NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  usage_date  date    NOT NULL,
  sent        integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, usage_date)
);

COMMENT ON TABLE public.automation_instance_daily_usage IS
  'Per-number-per-day ledger of AUTOMATION sends from each WhatsApp number '
  '(Send Governor P1/P2). usage_date = America/Sao_Paulo calendar date. '
  'Incremented atomically by increment_automation_daily_usage() AFTER a real '
  'successful send (never on a blocked/deferred attempt). Mirrors '
  'blast_instance_daily_usage; distinct ledger so mass and automation counts '
  'never collide.';

-- Composite PK (instance_id, usage_date) already indexes the only query shape
-- (point lookup of today's row per number); no extra index needed.

ALTER TABLE public.automation_instance_daily_usage ENABLE ROW LEVEL SECURITY;

-- Tenant read scoped through the parent instance (no own organization_id),
-- identical to blast_instance_daily_usage. Writes via the RPC (service_role).
CREATE POLICY "tenant_isolation_select" ON public.automation_instance_daily_usage
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_instances wi
      WHERE wi.id = automation_instance_daily_usage.instance_id
        AND wi.organization_id IN (SELECT public.get_my_organization_ids())
    )
    OR public.is_master_user()
  );

GRANT SELECT ON public.automation_instance_daily_usage TO authenticated;
GRANT ALL    ON public.automation_instance_daily_usage TO service_role;
REVOKE ALL   ON public.automation_instance_daily_usage FROM anon;

-- ── 3. Per-org Send Governor switches ───────────────────────────────────────
-- All default to the inert state: mode 'off', warm-up + cold-gate disabled.
-- Additive with defaults, so existing rows keep the governor completely off.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_mode text NOT NULL DEFAULT 'off'
    CHECK (send_governor_mode IN ('off', 'shadow', 'enforce'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_warmup_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS send_governor_cold_gate_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.send_governor_mode IS
  'Send Governor mode: off (inert/allow all) | shadow (evaluate + log, never '
  'block) | enforce (apply decision). Default off. PR-0 wires shadow only.';
COMMENT ON COLUMN public.organizations.send_governor_warmup_enabled IS
  'When true, the governor tightens the per-number automation cap by a warm-up '
  'ramp derived from the number age (P2). Default false.';
COMMENT ON COLUMN public.organizations.send_governor_cold_gate_enabled IS
  'When true, the governor blocks automation to cold contacts (no prior inbound '
  'message + no opt-in) under enforce (P4). Default false.';

-- ── 4a. Atomic UPSERT-increment RPC (per-number automation usage) ───────────
-- Mirrors increment_instance_daily_usage exactly. SECURITY DEFINER so the sole
-- server caller (service_role, AFTER a successful send) atomically
-- inserts-or-increments the day's row regardless of RLS. search_path = '' with
-- fully-qualified names (no extension functions needed here → the empty
-- search_path is both safe and the strictest choice).
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
  -- Non-positive increments are a no-op; return the current value (or 0).
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
  'Atomically add p_count to a number''s automation_instance_daily_usage row '
  'for p_usage_date (INSERT ... ON CONFLICT DO UPDATE sent += excluded). Called '
  'by the Send Governor via service_role AFTER a real successful send — never on '
  'a blocked/deferred attempt. Returns the post-increment day total.';

-- ── 4b. Record a ban signal + advance the reputation state machine ──────────
-- Called (best-effort, fire-and-forget) when the provider returns a ban-ish
-- status. Rolling 24h counter; a 463 (Meta/WhatsApp temporary restriction) OR
-- the 3rd signal within 24h quarantines the number. Quarantine window: 24h for
-- 463, 1h otherwise. Never un-quarantines (recovery is a separate concern —
-- set_instance_reputation / expiry checked at read time by the governor).
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
  -- Resolve owning org (reputation.organization_id is NOT NULL). If the
  -- instance vanished, no-op — telemetry must never error the caller.
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

  -- Rolling 24h counter: increment inside the window, else reset to 1.
  IF v_prev_at IS NOT NULL AND v_prev_at > now() - interval '24 hours' THEN
    v_new_count := COALESCE(v_prev_count, 0) + 1;
  ELSE
    v_new_count := 1;
  END IF;

  -- Disjuntor: a 463 quarantines immediately; so does the 3rd signal in 24h.
  v_should_quarantine := (p_code = 463) OR (v_new_count >= 3);

  IF v_should_quarantine THEN
    v_new_state := 'quarantined';
    v_quarantine_until := now() + CASE WHEN p_code = 463
                                       THEN interval '24 hours'
                                       ELSE interval '1 hour' END;
  ELSE
    -- Preserve any existing state (e.g. 'warming'); default healthy on insert.
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
  'Record a ban-ish provider signal (463/429/…) for a number and advance its '
  'reputation. Rolling 24h count; 463 OR 3rd-in-24h → quarantined (24h for 463, '
  '1h otherwise). service_role only, best-effort. Never un-quarantines.';

-- ── 4c. Explicit reputation set (recovery / manual / warm-up start) ─────────
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
    -- Stamp warmup_started_at only on the first transition INTO 'warming';
    -- otherwise preserve whatever was there.
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
  'Upsert a number''s reputation state (healthy/warming/quarantined) + '
  'quarantine_until. Used by recovery jobs / warm-up start. service_role only.';

-- ── 4d. Grants (the REVOKE-FROM-PUBLIC gotcha) ──────────────────────────────
-- REVOKE FROM anon alone is a NO-OP (anon inherits via GRANT TO PUBLIC). Revoke
-- from PUBLIC so anon loses the implicit grant while authenticated +
-- service_role keep their explicit ones; then grant EXECUTE to service_role
-- only (these are server-side ledger/telemetry writers, never client-callable).
REVOKE ALL ON FUNCTION public.increment_automation_daily_usage(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_automation_daily_usage(uuid, date, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_ban_signal(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ban_signal(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_instance_reputation(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_instance_reputation(uuid, text, timestamptz) TO service_role;
