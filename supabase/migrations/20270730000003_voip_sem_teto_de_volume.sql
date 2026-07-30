-- Chamada de voz sem teto de volume — decisão do CTO em 2026-07-30.
--
-- O pedido foi explícito: o cliente deve poder fazer quantas ligações quiser.
-- As quatro travas de volume que existiam saem; o que fica no lugar são
-- DISJUNTORES, com valores que nenhuma operação humana alcança. A distinção
-- importa e está registrada aqui de propósito: um teto de produto diz "você não
-- pode"; um disjuntor diz "isto não é mais um humano ligando, é código em
-- laço". Este projeto já queimou uma conta com um laço de envio, e a diferença
-- entre os dois é o que evita repetir.
--
-- O que NÃO muda, e é o que de fato segura o risco de banimento: `outbound`
-- continua exigindo consentimento de voz vivo em `consent_records`
-- (`consent_missing`). Sem opt-in não há ligação, com ou sem teto.
--
-- Antes / depois:
--
--   daily_call_cap        40      -> NULL (ilimitado)
--   c_max_org_live         2      -> 100   (o teto real vira o do binário: 8)
--   c_max_per_minute       6      -> 600   (disjuntor de laço)
--   c_max_per_peer_day     3      -> 1000  (disjuntor de laço)
--   c_peer_backoff        15 min  -> 0     (desligado)
--
-- Estado no momento da mudança: 137 instâncias, todas com cap 40 e NENHUMA com
-- `voice_calls_enabled`. Nada em voo, então a troca é inerte na prática.
--
-- CREATE OR REPLACE, não DROP + CREATE: `DROP` devolveria o EXECUTE para PUBLIC
-- e para `anon`. Os grants atuais são só `postgres` e `service_role`, e é assim
-- que têm de continuar.
--
-- Idempotente de ponta a ponta: pode ser reaplicada sem efeito colateral.

-- 1) O teto diário passa a ser opcional -------------------------------------
-- NULL significa "sem teto". Foi escolhido em vez de 0 porque a comparação da
-- função é `v_used >= v_cap`: com 0, a primeira ligação já bateria no teto e o
-- valor que parece "liberar" na verdade bloqueia tudo. NULL não tem essa
-- ambiguidade.
ALTER TABLE public.whatsapp_instances
  ALTER COLUMN daily_call_cap DROP NOT NULL;

ALTER TABLE public.whatsapp_instances
  ALTER COLUMN daily_call_cap SET DEFAULT NULL;

UPDATE public.whatsapp_instances
   SET daily_call_cap = NULL
 WHERE daily_call_cap IS NOT NULL;

-- O CHECK continua valendo para quem escolher um teto: só rejeita negativo, e
-- CHECK não reprova NULL.
COMMENT ON COLUMN public.whatsapp_instances.daily_call_cap IS
  'Teto de ligações por dia para este número. NULL = sem teto, que é o padrão '
  'desde 2026-07-30. Um número aqui volta a limitar o volume diário; 0 não '
  'libera nada, bloqueia tudo.';

-- 2) A reserva perde os tetos de volume e ganha disjuntores ------------------
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

-- 3) Os grants não mudam, mas são reafirmados aqui para que qualquer desvio
--    apareça na próxima leitura desta migration em vez de passar despercebido.
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;
