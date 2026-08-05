-- ROLLBACK de 20270804000000_voip_recording_failure_reason_projection.sql
--
-- Devolve `fn_voip_project_call_log` e o gatilho de UPDATE às versões de
-- 20270803000000 — isto é, sem a causa da falha na projeção.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, E POR QUÊ
-- -------------------------------------
-- NÃO derruba `call_logs.recording_failure_reason`. `DROP COLUMN` é
-- irreversível sem backup, e a coluna guarda diagnóstico de gravação que não
-- aconteceu — depois deste rollback ela fica inerte (nada a escreve, nada a lê),
-- que é o estado seguro. O bloco no fim derruba, se a decisão for essa e for
-- deliberada.

-- ===========================================================================
-- 1. A projeção volta à versão de 20270803000000
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_voip_project_call_log(p_call_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_call     public.voip_calls%ROWTYPE;
  v_answered boolean;
  v_outcome  text;
  v_duration integer;
  v_log_id   uuid;
BEGIN
  SELECT * INTO v_call FROM public.voip_calls WHERE id = p_call_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_call.status <> 'ended' THEN
    RETURN NULL;
  END IF;

  v_answered := v_call.connected_at IS NOT NULL;

  v_outcome := CASE
    WHEN v_answered THEN 'connected'
    ELSE CASE v_call.end_reason
      WHEN 'timeout'        THEN 'no_answer'
      WHEN 'busy'           THEN 'busy'
      WHEN 'do_not_disturb' THEN 'busy'
      WHEN 'declined'       THEN 'rejected'
      WHEN 'rejected'       THEN 'rejected'
      WHEN 'cancelled'      THEN 'canceled'
      WHEN 'user_ended'     THEN 'canceled'
      ELSE 'failed'
    END
  END;

  v_duration := CASE
    WHEN v_answered AND v_call.ended_at IS NOT NULL
      THEN GREATEST(0, round(extract(epoch FROM v_call.ended_at - v_call.connected_at)))::integer
    ELSE NULL
  END;

  INSERT INTO public.call_logs (
    organization_id, lead_id, user_id, direction, outcome, duration_seconds,
    phone_number, voip_provider, voip_call_id, started_at, ended_at,
    recording_url, recording_status, recording_notice_regime
  ) VALUES (
    v_call.organization_id,
    v_call.lead_id,
    v_call.operator_user_id,
    v_call.direction,
    v_outcome,
    v_duration,
    v_call.peer_phone,
    'torquecalls',
    v_call.id::text,
    COALESCE(v_call.connected_at, v_call.authorized_at),
    v_call.ended_at,
    v_call.recording_path,
    v_call.recording_status,
    v_call.recording_notice_regime
  )
  ON CONFLICT (voip_call_id) WHERE voip_call_id IS NOT NULL
  DO UPDATE SET
    organization_id  = EXCLUDED.organization_id,
    lead_id          = EXCLUDED.lead_id,
    user_id          = EXCLUDED.user_id,
    direction        = EXCLUDED.direction,
    outcome          = EXCLUDED.outcome,
    duration_seconds = EXCLUDED.duration_seconds,
    phone_number     = EXCLUDED.phone_number,
    voip_provider    = EXCLUDED.voip_provider,
    started_at       = EXCLUDED.started_at,
    ended_at         = EXCLUDED.ended_at,
    recording_url           = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
    recording_status        = COALESCE(EXCLUDED.recording_status, call_logs.recording_status),
    recording_notice_regime = COALESCE(EXCLUDED.recording_notice_regime, call_logs.recording_notice_regime)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_project_call_log(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 2. O gatilho volta ao `WHEN` sem a causa
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_voip_calls_project_call_log_upd ON public.voip_calls;
CREATE TRIGGER trg_voip_calls_project_call_log_upd
  AFTER UPDATE ON public.voip_calls
  FOR EACH ROW
  WHEN (
    NEW.status = 'ended'
    AND (
      OLD.status       IS DISTINCT FROM NEW.status
      OR OLD.end_reason   IS DISTINCT FROM NEW.end_reason
      OR OLD.connected_at IS DISTINCT FROM NEW.connected_at
      OR OLD.ended_at     IS DISTINCT FROM NEW.ended_at
      OR OLD.recording_status        IS DISTINCT FROM NEW.recording_status
      OR OLD.recording_path          IS DISTINCT FROM NEW.recording_path
      OR OLD.recording_notice_regime IS DISTINCT FROM NEW.recording_notice_regime
    )
  )
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();

-- ===========================================================================
-- 3. A coluna — só com decisão explícita
-- ===========================================================================
-- ALTER TABLE public.call_logs DROP COLUMN IF EXISTS recording_failure_reason;
