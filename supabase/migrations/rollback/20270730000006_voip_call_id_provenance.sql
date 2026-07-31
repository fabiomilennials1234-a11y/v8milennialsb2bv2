-- Rollback de 20270730000006_voip_call_id_provenance.sql
--
-- Desfaz a cunhagem do id de rede: fn_voip_call_reserve volta a não escrever
-- tc_call_id e a não devolvê-lo no jsonb. Cópia literal do corpo vigente em
-- 20270730000003_voip_sem_teto_de_volume.sql:55-293 (a versão "sem teto de
-- volume" do CTO) — NÃO da fundação (20270730000000), que reintroduziria em
-- silêncio os tetos de volume que o CTO removeu em 2026-07-30.
--
-- CREATE OR REPLACE preserva o ACL. DROP + CREATE devolveria EXECUTE a PUBLIC.

CREATE OR REPLACE FUNCTION public.fn_voip_call_reserve(
  p_organization_id uuid,
  p_operator_user_id uuid,
  p_tc_session_id text,
  p_peer_phone text,
  p_lead_id uuid DEFAULT NULL::uuid,
  p_direction text DEFAULT 'outbound'::text,
  p_consent_record_id uuid DEFAULT NULL::uuid,
  p_existing_call_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_reservation_ttl  constant interval := interval '12 seconds';

  -- Disjuntores, não tetos de produto. Nenhum destes é alcançável por uma
  -- pessoa operando o CRM; se algum disparar, o que está do outro lado é um
  -- laço de código, e o erro devolvido é o sinal de alarme.
  c_max_org_live     constant integer  := 100;
  c_max_per_minute   constant integer  := 600;
  c_max_per_peer_day constant integer  := 1000;

  -- Zero desliga o backoff: `ended_at > now() - interval '0 seconds'` nunca é
  -- verdade para uma chamada que já terminou.
  c_peer_backoff     constant interval := interval '0 seconds';

  v_session   public.voip_sessions%ROWTYPE;
  v_enabled   boolean;
  v_cap       integer;
  v_instance  uuid;
  v_peer      text;
  v_used      integer;
  v_live      integer;
  v_recent    integer;
  v_peer_day  integer;
  v_today     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_day_start timestamptz := (v_today::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_call_id   uuid;
  v_jti       uuid := gen_random_uuid();
BEGIN
  IF p_direction NOT IN ('inbound','outbound') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_direction');
  END IF;

  -- `[^0-9]` no lugar do `\D` que estava aqui antes. É a mesma classe de
  -- caracteres, escrita sem barra invertida — que atravessa transporte JSON e
  -- ferramenta de migration sem chance de ser reinterpretada pelo caminho.
  -- Conferido em produção: '+55 (48) 99100-5289' -> '5548991005289'.
  v_peer := regexp_replace(COALESCE(p_peer_phone, ''), '[^0-9]', '', 'g');
  IF length(v_peer) < 8 OR length(v_peer) > 15 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_peer');
  END IF;

  SELECT * INTO v_session
    FROM public.voip_sessions
   WHERE tc_session_id = p_tc_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_found');
  END IF;
  IF v_session.organization_id <> p_organization_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_org_mismatch');
  END IF;
  IF v_session.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_open');
  END IF;

  v_instance := v_session.whatsapp_instance_id;

  SELECT wi.voice_calls_enabled, wi.daily_call_cap
    INTO v_enabled, v_cap
    FROM public.whatsapp_instances wi
   WHERE wi.id = v_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'instance_not_found');
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'voice_calls_disabled');
  END IF;

  -- Outbound exige lead e consentimento de voz vivo. Inbound não: quem ligou
  -- foi o outro lado. Esta é a trava que soltar o volume NÃO afrouxa.
  IF p_direction = 'outbound' THEN
    IF p_lead_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lead_required');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = p_lead_id AND l.organization_id = p_organization_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lead_org_mismatch');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.consent_records c
       WHERE c.organization_id = p_organization_id
         AND c.lead_id = p_lead_id
         AND c.consent_type = 'voice_call_whatsapp'
         AND c.granted = true
         AND c.revoked_at IS NULL
         AND c.source IN ('form','api','webhook')
         AND (p_consent_record_id IS NULL OR c.id = p_consent_record_id)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'consent_missing');
    END IF;
  END IF;

  -- Serializa as reservas da org. Reserva é evento raro; o custo do lock é
  -- irrelevante perto de contar cota errado sob concorrência.
  PERFORM pg_advisory_xact_lock(hashtext('voip:' || p_organization_id::text));

  -- Auto-cura: reserva vencida devolve cota na hora, sem esperar o reaper de
  -- 1 minuto. O reaper existe para higiene de status, não como caminho crítico.
  UPDATE public.voip_calls
     SET status = 'expired',
         end_reason = 'reservation_expired',
         ended_at = now(),
         updated_at = now()
   WHERE organization_id = p_organization_id
     AND status = 'authorized'
     AND authorized_at < now() - c_reservation_ttl;

  SELECT COALESCE(u.calls_authorized, 0) INTO v_used
    FROM public.voip_call_usage u
   WHERE u.organization_id = p_organization_id
     AND u.whatsapp_instance_id = v_instance
     AND u.usage_date = v_today;

  -- O teto diário virou opcional. Sem cap definido não há o que comparar, e a
  -- contagem em `voip_call_usage` segue sendo escrita — o número continua
  -- disponível para relatório, só deixou de barrar.
  IF v_cap IS NOT NULL AND COALESCE(v_used, 0) >= v_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'daily_cap_reached');
  END IF;

  SELECT count(*) INTO v_live
    FROM public.voip_calls c
   WHERE c.organization_id = p_organization_id
     AND c.status IN ('authorized','ringing','connected')
     AND (p_existing_call_id IS NULL OR c.id <> p_existing_call_id);

  IF v_live >= c_max_org_live THEN
    RETURN jsonb_build_object('ok', false, 'code', 'org_concurrency_reached',
                              'retry_after_ms', 5000);
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.voip_calls c
   WHERE c.organization_id = p_organization_id
     AND c.authorized_at > now() - interval '1 minute';

  IF v_recent >= c_max_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
                              'retry_after_ms', 10000);
  END IF;

  IF p_direction = 'outbound' THEN
    SELECT count(*) INTO v_peer_day
      FROM public.voip_calls c
     WHERE c.organization_id = p_organization_id
       AND c.peer_phone = v_peer
       AND c.direction = 'outbound'
       AND c.authorized_at >= v_day_start;

    IF v_peer_day >= c_max_per_peer_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'peer_daily_cap_reached');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.voip_calls c
       WHERE c.organization_id = p_organization_id
         AND c.peer_phone = v_peer
         AND c.direction = 'outbound'
         AND c.connected_at IS NULL
         AND c.ended_at IS NOT NULL
         AND c.ended_at > now() - c_peer_backoff
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'peer_backoff',
                                'retry_after_ms', 60000);
    END IF;
  END IF;

  BEGIN
    IF p_existing_call_id IS NOT NULL THEN
      -- Inbound sendo atendido: a linha já nasceu no ringing, sem operador.
      UPDATE public.voip_calls
         SET operator_user_id = p_operator_user_id,
             lead_id = COALESCE(p_lead_id, lead_id),
             token_jti = v_jti,
             consent_record_id = COALESCE(p_consent_record_id, consent_record_id),
             authorized_at = now(),
             updated_at = now()
       WHERE id = p_existing_call_id
         AND organization_id = p_organization_id
         AND status IN ('ringing','authorized')
      RETURNING id INTO v_call_id;

      IF v_call_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'call_not_answerable');
      END IF;
    ELSE
      INSERT INTO public.voip_calls (
        organization_id, tc_session_id, lead_id, operator_user_id,
        peer_phone, direction, status, token_jti, consent_record_id
      ) VALUES (
        p_organization_id, p_tc_session_id, p_lead_id, p_operator_user_id,
        v_peer, p_direction, 'authorized', v_jti, p_consent_record_id
      )
      RETURNING id INTO v_call_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'operator_busy');
  END;

  INSERT INTO public.voip_call_usage AS u (
    organization_id, whatsapp_instance_id, usage_date,
    calls_authorized, last_authorized_at, updated_at
  ) VALUES (
    p_organization_id, v_instance, v_today, 1, now(), now()
  )
  ON CONFLICT (organization_id, whatsapp_instance_id, usage_date) DO UPDATE
    SET calls_authorized   = u.calls_authorized + 1,
        last_authorized_at = now(),
        updated_at         = now();

  RETURN jsonb_build_object(
    'ok', true,
    'call_id', v_call_id,
    'token_jti', v_jti,
    'expires_in_ms', 12000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;
