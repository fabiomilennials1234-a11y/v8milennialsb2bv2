-- ROLLBACK de 20270803000000_voip_recording_ingest.sql
--
-- Desfaz a chegada da gravação ao CRM: volta `fn_voip_apply_vps_event` e
-- `fn_voip_project_call_log` às versões de 20270730000010 e 20270801000000,
-- devolve o gatilho ao `WHEN` sem as colunas de gravação, e derruba a policy e
-- as funções novas.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, E POR QUÊ
-- -------------------------------------
-- 1. NÃO apaga os objetos do bucket. Um rollback de schema não pode destruir
--    áudio de conversa com cliente — se a decisão for apagar, ela é deliberada e
--    tem procedimento próprio (o expurgo da S4). O bucket é esvaziado à mão, ou
--    fica.
--
-- 2. NÃO derruba as COLUNAS por padrão. `DROP COLUMN` é irreversível sem backup,
--    e as colunas de gravação carregam o carimbo de regime — a única prova de
--    sob qual política cada gravação nasceu. Elas ficam, inertes: nada as
--    escreve depois deste rollback, e nada as lê.
--
--    O bloco comentado no fim derruba tudo, para o caso de a decisão ser
--    apagar mesmo. Exige autorização explícita, como todo DROP COLUMN neste
--    projeto.
--
-- 3. NÃO remove a linha de `storage.buckets`. Bucket sem objeto é inofensivo;
--    bucket removido com objeto dentro deixa arquivo órfão que nem o expurgo
--    alcança.

-- ===========================================================================
-- 1. A policy e a regra de quem ouve
-- ===========================================================================
DROP POLICY IF EXISTS "call_recordings_select" ON storage.objects;
DROP FUNCTION IF EXISTS public.fn_voip_can_hear_recording(text);

-- ===========================================================================
-- 2. As funções de estado da gravação
-- ===========================================================================
-- Só depois de a RPC do webhook voltar à versão que não as chama — a ordem
-- abaixo garante isso (seção 3 vem antes na execução? não: SQL roda de cima
-- para baixo, e por isso a RPC é restaurada ANTES destes DROPs).

-- ===========================================================================
-- 3. fn_voip_apply_vps_event volta a 20270730000010
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_voip_apply_vps_event(
  p_event_jti uuid,
  p_sid       text,
  p_epoch     bigint,
  p_seq       bigint,
  p_signed_at timestamptz,
  p_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_dedup_window constant interval := interval '60 minutes';
  c_end_reasons  constant text[] := ARRAY[
    'user_ended','declined','timeout','busy','cancelled','failed','do_not_disturb','unknown'
  ];
  c_ts_past      constant interval := interval '24 hours';
  c_ts_future    constant interval := interval '5 minutes';

  v_session public.voip_sessions%ROWTYPE;
  v_call    public.voip_calls%ROWTYPE;
  v_claimed uuid;
  v_type    text;
  v_state   text;
  v_next    text;
  v_status  text;
  v_tc_call text;
  v_reason  text;
  v_ts      timestamptz;
  v_late    boolean;
  v_ms      numeric;
  v_ms_min  numeric;
  v_ms_max  numeric;
BEGIN
  IF p_event_jti IS NULL OR p_sid IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'malformed_envelope');
  END IF;

  IF COALESCE(p_epoch, 0) <= 0 OR COALESCE(p_seq, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'invalid_sequence');
  END IF;

  v_type := p_payload->>'type';

  v_ms_min := extract(epoch from now() - c_ts_past)   * 1000;
  v_ms_max := extract(epoch from now() + c_ts_future) * 1000;

  SELECT * INTO v_session
    FROM public.voip_sessions
   WHERE tc_session_id = p_sid
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'code', 'session_not_found');
  END IF;

  IF v_session.status = 'quarantined' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'session_inert');
  END IF;

  INSERT INTO public.voip_webhook_events (
    event_jti, organization_id, tc_session_id, seq_epoch, seq, signed_at, expires_at
  ) VALUES (
    p_event_jti, v_session.organization_id, p_sid, p_epoch, p_seq,
    COALESCE(p_signed_at, now()), now() + c_dedup_window
  )
  ON CONFLICT (event_jti) DO NOTHING
  RETURNING event_jti INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'replay');
  END IF;

  IF v_type = 'auth-state' THEN
    IF NOT (p_epoch > v_session.last_seq_epoch
            OR (p_epoch = v_session.last_seq_epoch AND p_seq > v_session.last_seq)) THEN
      RETURN jsonb_build_object('ok', true, 'code', 'out_of_order',
                                'detail', 'session_watermark');
    END IF;

    UPDATE public.voip_sessions
       SET last_seq_epoch = p_epoch, last_seq = p_seq, updated_at = now()
     WHERE id = v_session.id;

    v_state := p_payload->>'state';

    v_next := CASE v_session.status
      WHEN 'pending' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pending'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'pairing' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pairing'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'open'    THEN CASE v_state
                            WHEN 'qr' THEN NULL       WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN 'pending'
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      WHEN 'closed'  THEN CASE v_state
                            WHEN 'qr' THEN 'pairing'  WHEN 'open' THEN NULL
                            WHEN 'logged_out' THEN 'closed'
                            WHEN 'connecting' THEN NULL
                            WHEN 'failed'     THEN 'closed'  ELSE NULL END
      ELSE NULL
    END;

    IF v_next IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'transition_refused',
        'detail', CASE WHEN v_state IN ('qr','open','logged_out','connecting','failed')
                       THEN 'state_transition_refused' ELSE 'unknown_state' END,
        'from', v_session.status, 'to', v_state);
    END IF;

    IF v_next <> v_session.status THEN
      UPDATE public.voip_sessions SET status = v_next, updated_at = now()
       WHERE id = v_session.id;

      IF v_state = 'failed' THEN
        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_session.organization_id, 'voip', 'webhook_sessao_falhou', 'error',
                'voip_session', v_session.id,
                jsonb_build_object('tc_session_id', p_sid, 'status_anterior', v_session.status,
                                   'status_novo', v_next,
                                   'motivo', 'ConnectFailure/StreamReplaced na VPS — exige repareamento',
                                   'seq_epoch', p_epoch, 'seq', p_seq));
      ELSIF v_state = 'connecting' THEN
        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_session.organization_id, 'voip', 'webhook_sessao_reconectando', 'success',
                'voip_session', v_session.id,
                jsonb_build_object('tc_session_id', p_sid, 'status_anterior', v_session.status,
                                   'status_novo', v_next,
                                   'motivo', 'Disconnected na VPS — chamada suspensa até voltar open',
                                   'seq_epoch', p_epoch, 'seq', p_seq));
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied',
                              'detail', 'auth_state', 'session_status', v_next);
  END IF;

  IF v_type IN ('call-status', 'call-ended') THEN
    v_tc_call := NULLIF(p_payload->>'id', '');

    IF v_tc_call IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                'detail', 'missing_call_id');
    END IF;

    SELECT * INTO v_call
      FROM public.voip_calls
     WHERE tc_session_id   = p_sid
       AND tc_call_id      = v_tc_call
       AND organization_id = v_session.organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.runtime_logs
        (organization_id, module, action, status, payload_snapshot)
      VALUES (v_session.organization_id, 'voip', 'webhook_chamada_desconhecida', 'skipped',
              jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call, 'type', v_type));
      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'call_not_found');
    END IF;

    v_late := NOT (p_epoch > v_call.last_seq_epoch
                   OR (p_epoch = v_call.last_seq_epoch AND p_seq > v_call.last_seq));

    IF NOT v_late THEN
      UPDATE public.voip_calls
         SET last_seq_epoch = p_epoch, last_seq = p_seq
       WHERE id = v_call.id;
    END IF;
  END IF;

  IF v_late THEN
    IF v_type = 'call-status' THEN
      v_status := p_payload->>'status';

      IF v_status = 'connected' AND v_call.connected_at IS NULL THEN
        UPDATE public.voip_calls
           SET connected_at = LEAST(now(), v_call.ended_at), updated_at = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'connected_at',
                                   'motivo', 'connected entregue DEPOIS de evento com seq maior',
                                   'status_da_linha', v_call.status,
                                   'seq_epoch', p_epoch, 'seq', p_seq,
                                   'marca_epoch', v_call.last_seq_epoch,
                                   'marca_seq', v_call.last_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'late_connected_at');
      END IF;

      IF v_status = 'ringing' AND v_call.ringing_at IS NULL THEN
        v_ms := CASE WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
                     THEN (p_payload->>'startedAt')::numeric ELSE NULL END;
        v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                     THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

        UPDATE public.voip_calls
           SET ringing_at = LEAST(v_ts, v_call.connected_at, v_call.ended_at), updated_at = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'ringing_at',
                                   'status_da_linha', v_call.status,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'late_ringing_at');
      END IF;
    END IF;

    IF v_type = 'call-ended' THEN
      v_reason := COALESCE(NULLIF(p_payload->>'reason', ''), 'unknown');
      IF NOT (v_reason = ANY (c_end_reasons)) THEN
        v_reason := 'unknown';
      END IF;

      v_ms := CASE WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
                   THEN (p_payload->>'endedAt')::numeric ELSE NULL END;
      v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                   THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

      IF v_call.ended_at IS NULL
         OR v_call.end_reason IS NULL
         OR v_call.end_reason IN ('unknown', 'no_terminal_event') THEN
        UPDATE public.voip_calls
           SET ended_at   = COALESCE(v_call.ended_at, GREATEST(v_ts, v_call.connected_at)),
               end_reason = CASE WHEN v_call.end_reason IS NULL
                                   OR v_call.end_reason IN ('unknown', 'no_terminal_event')
                                 THEN v_reason ELSE v_call.end_reason END,
               updated_at = now()
         WHERE id = v_call.id;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_carimbo_tardio', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'carimbo', 'end_reason',
                                   'motivo_anterior', v_call.end_reason,
                                   'motivo_novo', v_reason,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'late_end_stamp', 'end_reason', v_reason);
      END IF;
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'out_of_order', 'detail', 'call_watermark');
  END IF;

  IF v_type = 'call-status' THEN
    v_status := p_payload->>'status';

    IF v_status = 'starting' THEN
      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'noop_starting');
    END IF;

    IF v_status = 'ringing' THEN
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      v_ms := CASE WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
                   THEN (p_payload->>'startedAt')::numeric ELSE NULL END;
      v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                   THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

      IF v_call.status = 'connected' THEN
        UPDATE public.voip_calls
           SET ringing_at = COALESCE(ringing_at, v_ts), updated_at = now()
         WHERE id = v_call.id;
        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'noop_already_connected');
      END IF;

      UPDATE public.voip_calls
         SET status = 'ringing', ringing_at = COALESCE(ringing_at, v_ts), updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ringing');
    END IF;

    IF v_status = 'connected' THEN
      IF v_call.status = 'ended' AND v_call.end_reason = 'no_terminal_event' THEN
        IF v_call.operator_user_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.voip_calls c2
           WHERE c2.operator_user_id = v_call.operator_user_id
             AND c2.id <> v_call.id
             AND c2.status IN ('authorized','ringing','connected')
        ) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                    'detail', 'operator_busy');
        END IF;

        BEGIN
          UPDATE public.voip_calls
             SET status = 'connected', connected_at = COALESCE(connected_at, now()),
                 ended_at = NULL, end_reason = NULL, updated_at = now()
           WHERE id = v_call.id;
        EXCEPTION WHEN unique_violation THEN
          RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                    'detail', 'operator_busy');
        END;

        INSERT INTO public.runtime_logs
          (organization_id, module, action, status, entity_type, entity_id, payload_snapshot)
        VALUES (v_call.organization_id, 'voip', 'webhook_chamada_ressuscitada', 'success',
                'voip_call', v_call.id,
                jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                   'ended_at_anterior', v_call.ended_at,
                                   'end_reason_anterior', v_call.end_reason,
                                   'seq_epoch', p_epoch, 'seq', p_seq));

        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'resurrected');
      END IF;

      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status = 'connected', connected_at = COALESCE(connected_at, now()), updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'connected');
    END IF;

    IF v_status = 'ended' THEN
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status = 'ended', ended_at = COALESCE(ended_at, now()),
             end_reason = 'unknown', updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ended_via_status');
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'unknown_status', 'status', v_status);
  END IF;

  IF v_type = 'call-ended' THEN
    v_reason := COALESCE(NULLIF(p_payload->>'reason', ''), 'unknown');
    IF NOT (v_reason = ANY (c_end_reasons)) THEN
      v_reason := 'unknown';
    END IF;

    v_ms := CASE WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
                 THEN (p_payload->>'endedAt')::numeric ELSE NULL END;
    v_ts := CASE WHEN v_ms IS NOT NULL AND v_ms BETWEEN v_ms_min AND v_ms_max
                 THEN to_timestamp(v_ms / 1000.0) ELSE now() END;

    IF v_call.status NOT IN ('ended','expired') THEN
      UPDATE public.voip_calls
         SET status = 'ended',
             ended_at = COALESCE(ended_at, GREATEST(v_ts, v_call.connected_at)),
             end_reason = v_reason, updated_at = now()
       WHERE id = v_call.id;
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'ended', 'end_reason', v_reason);
    END IF;

    IF v_call.end_reason = 'no_terminal_event' THEN
      UPDATE public.voip_calls
         SET end_reason = v_reason,
             ended_at = GREATEST(v_ts, v_call.connected_at), updated_at = now()
       WHERE id = v_call.id;
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'sweeper_reason_corrected', 'end_reason', v_reason);
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'already_terminal');
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                            'detail', 'unknown_type', 'type', v_type);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) TO service_role;

-- ===========================================================================
-- 4. fn_voip_project_call_log volta a 20270801000000
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
    phone_number, voip_provider, voip_call_id, started_at, ended_at
  ) VALUES (
    v_call.organization_id, v_call.lead_id, v_call.operator_user_id,
    v_call.direction, v_outcome, v_duration, v_call.peer_phone,
    'torquecalls', v_call.id::text,
    COALESCE(v_call.connected_at, v_call.authorized_at), v_call.ended_at
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
    ended_at         = EXCLUDED.ended_at
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_project_call_log(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

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
    )
  )
  EXECUTE FUNCTION public.fn_voip_calls_project_call_log();

-- ===========================================================================
-- 5. As funções de estado da gravação, agora sem chamador
-- ===========================================================================
DROP FUNCTION IF EXISTS public.fn_voip_recording_announced(uuid, bigint, integer);
DROP FUNCTION IF EXISTS public.fn_voip_recording_failed(uuid, text);
DROP FUNCTION IF EXISTS public.fn_voip_recording_stored(uuid, text, bigint);

-- ===========================================================================
-- 6. AS COLUNAS — só com autorização explícita
-- ===========================================================================
-- DROP COLUMN é irreversível sem backup, e `recording_notice_regime` é a única
-- prova de sob qual política cada gravação nasceu. Descomente com intenção.
--
-- ALTER TABLE public.voip_calls
--   DROP CONSTRAINT IF EXISTS voip_calls_recording_status_chk,
--   DROP CONSTRAINT IF EXISTS voip_calls_recording_regime_chk,
--   DROP COLUMN IF EXISTS recording_status,
--   DROP COLUMN IF EXISTS recording_path,
--   DROP COLUMN IF EXISTS recording_bytes,
--   DROP COLUMN IF EXISTS recording_duration_ms,
--   DROP COLUMN IF EXISTS recording_failure_reason,
--   DROP COLUMN IF EXISTS recording_notice_regime,
--   DROP COLUMN IF EXISTS recording_stored_at;
--
-- ALTER TABLE public.call_logs
--   DROP CONSTRAINT IF EXISTS call_logs_recording_status_chk,
--   DROP COLUMN IF EXISTS recording_status,
--   DROP COLUMN IF EXISTS recording_notice_regime;
