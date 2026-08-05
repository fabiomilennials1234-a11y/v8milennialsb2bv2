-- Consentimento de voz deixa de barrar a chamada (decisão do CTO, 2026-07-31).
-- ROLLBACK pareado: rollback/20270730000009_voip_consentimento_opcional.sql
--
-- A DECISÃO
-- ---------
-- O ADR-0024 §5 fez o consentimento de voz nascer como trava dura: chamada de
-- saída exigia uma linha em `consent_records` com `source IN ('form','api',
-- 'webhook')`, e o `manual` ficou de fora de propósito — vendedor afirmando
-- consentimento pelo próprio CRM não é consentimento.
--
-- O problema não é a regra, é a ausência de produtor: `fn_voip_consent_record`
-- é service_role-only e não tem UM chamador em todo o repositório; o hook do
-- front grava `source: 'manual'`, que o gate exclui. Produção tem ZERO linhas
-- de `voice_call_whatsapp`. Ou seja: a trava é total na prática — nenhuma
-- ligação de saída é autorizável por caminho de produto, e o operador recebe
-- "Este lead ainda não autorizou receber ligações" para sempre.
--
-- O CTO decidiu assumir todos os leads como consentidos. O gate sai do caminho
-- crítico.
--
-- POR QUE UMA CHAVE, E NÃO UM `DELETE` NA REGRA
-- ---------------------------------------------
-- Apagar o bloco tornaria a volta uma reescrita. A exigência vira coluna por
-- organização, com default `false` — "assume consentido" é o comportamento
-- padrão, e quem precisar da trava (mudança de política do WhatsApp, cliente
-- com exigência própria, mercado regulado) liga para aquela org sem tocar em
-- código. `consent_records` continua existindo e continua sendo escrito por
-- quem quiser; só deixou de ser condição de partida.
--
-- O RISCO QUE FICA REGISTRADO
-- ---------------------------
-- Ligar para quem não pediu é vetor de denúncia, e denúncia é vetor de ban do
-- número. Isso não é hipótese neste projeto — há histórico de investigação de
-- ban por padrão de envio. A diferença é que agora a decisão está escrita, com
-- data e dono, em vez de embutida numa trava que ninguém sabia por que existia.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS require_voice_consent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.require_voice_consent IS
  'Quando true, chamada de VOZ de saída exige consentimento vivo em '
  'consent_records (voice_call_whatsapp, source form/api/webhook). Default '
  'false por decisão do CTO em 2026-07-31: todo lead é assumido consentido. '
  'Ligar para quem não pediu é vetor de ban — religar isto é a trava, e ela '
  'continua inteira em fn_voip_call_reserve.';

-- ===========================================================================
-- fn_voip_call_reserve — o gate de consentimento passa a ser condicional
-- ===========================================================================
--
-- Corpo copiado de 20270730000008 (a definição vigente). ÚNICA mudança: o
-- bloco de consentimento passa a rodar só quando a organização o exige.
--
-- CREATE OR REPLACE, nunca DROP + CREATE: dropar devolve EXECUTE a PUBLIC e
-- anon.

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
  c_max_org_live     constant integer  := 100;
  c_max_per_minute   constant integer  := 600;
  c_max_per_peer_day constant integer  := 1000;
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
  v_tc_call_id text;
  v_jti       uuid := gen_random_uuid();
  v_exige_consentimento boolean;
BEGIN
  IF p_direction NOT IN ('inbound','outbound') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_direction');
  END IF;

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

  -- Outbound continua exigindo LEAD: sem ele não há de quem derivar o número,
  -- e discar para telefone digitado à mão é outra coisa, com outro risco.
  -- O CONSENTIMENTO é que virou condicional.
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

    -- COALESCE porque uma org sem linha (ou uma linha antiga) não pode virar
    -- NULL e cair no ramo errado: ausência resolve para "não exige", que é o
    -- default declarado na coluna.
    SELECT COALESCE(o.require_voice_consent, false) INTO v_exige_consentimento
      FROM public.organizations o
     WHERE o.id = p_organization_id;

    IF COALESCE(v_exige_consentimento, false) THEN
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
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('voip:' || p_organization_id::text));

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
         AND tc_call_id IS NOT NULL
      RETURNING id, tc_call_id INTO v_call_id, v_tc_call_id;

      IF v_call_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'call_not_answerable');
      END IF;
    ELSE
      v_tc_call_id := upper(replace(gen_random_uuid()::text, '-', ''));

      INSERT INTO public.voip_calls (
        organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
        peer_phone, direction, status, token_jti, consent_record_id
      ) VALUES (
        p_organization_id, p_tc_session_id, v_tc_call_id, p_lead_id, p_operator_user_id,
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
    'tc_call_id', v_tc_call_id,
    'token_jti', v_jti,
    'expires_in_ms', 12000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;
