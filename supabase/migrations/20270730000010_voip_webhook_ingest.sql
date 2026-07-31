-- 20270730000010_voip_webhook_ingest.sql
--
-- TorqueCalls S11 — a aplicação do evento assinado que a VPS manda ao CRM.
-- ROLLBACK pareado: rollback/20270730000010_voip_webhook_ingest.sql
--
-- O QUE ENTRA AQUI
-- ---------------
-- A VPS passa a assinar (Ed25519, envelope JWS com `bh` amarrando o corpo) e a
-- entregar três eventos: `auth-state`, `call-status` e `call-ended`. A borda HTTP
-- (T7 verifica a assinatura, T8 é o endpoint) NÃO decide nada de estado — ela
-- entrega o par ordenador `(epoch, seq)`, o `jti` do envelope, o instante da
-- assinatura e o corpo cru para ESTA função.
--
-- POR QUE UMA FUNÇÃO SÓ, E NÃO UMA SEQUÊNCIA DE UPDATEs NA EDGE FUNCTION
-- ---------------------------------------------------------------------
-- Anti-replay, ordem, transição de sessão e escrita no ledger de chamada têm que
-- valer OU NENHUM valer. Espalhados em chamadas separadas do PostgREST, uma
-- entrega interrompida no meio deixa o jti reservado sem o estado aplicado — e a
-- retentativa devolve `replay` sobre um estado que nunca chegou. Numa transação,
-- a transição vira invariante de armazenamento em vez de sequência de UPDATEs.
--
-- `event_jti`, NÃO `jti`
-- ----------------------
-- `voip_calls.token_jti` já existe e é o jti do sentido CRM→VPS (o token de
-- chamada que o CRM cunha). Este é o do sentido VPS→CRM, com par de chaves
-- DIFERENTE. Reaproveitar o nome transformaria o próximo incidente em caça ao
-- fantasma.
--
-- A CORRIDA COM O VARREDOR — a razão de existir a ressurreição
-- ------------------------------------------------------------
-- `voip-sweep-stuck-calls` (20270730000007) fecha `ringing` parado há mais de 2
-- minutos com `end_reason = 'no_terminal_event'`. Medido em prod hoje: 4 das 7
-- chamadas registradas foram fechadas por ele. Um `connected` entregue depois
-- disso encontra a linha já `ended`.
--
-- Regra: evento de vida ressuscita linha fechada SOMENTE por
-- `no_terminal_event`, nunca por `user_ended`/`rejected`/`declined`. Quem
-- desligou decidiu; o varredor só chutou. E só ressuscita se o operador não
-- tiver outra chamada viva — `idx_voip_calls_one_live_per_operator` é UNIQUE
-- parcial e a escrita estouraria.
--
-- SÓ `connected` RESSUSCITA, `ringing` NÃO
-- ----------------------------------------
-- O varredor recolhe `ringing` justamente porque tocar por 2 minutos já é
-- anormal. Um `ringing` atrasado rearmaria a mesma armadilha sem provar que a
-- chamada está viva. `connected` é a única afirmação inequívoca de vida.

-- ===========================================================================
-- 1. voip_webhook_events — a reserva do jti (anti-replay)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.voip_webhook_events (
  event_jti       uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tc_session_id   text NOT NULL,
  seq_epoch       bigint NOT NULL,
  seq             bigint NOT NULL,
  signed_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  CONSTRAINT voip_webhook_events_seq_pos CHECK (seq > 0 AND seq_epoch > 0)
);

CREATE INDEX IF NOT EXISTS idx_voip_webhook_events_expires_at
  ON public.voip_webhook_events(expires_at);

COMMENT ON TABLE public.voip_webhook_events IS
  'Reserva de jti dos eventos assinados que a VPS entrega ao CRM (sentido '
  'VPS→CRM). PK no jti fecha replay: a segunda entrega do mesmo envelope perde a '
  'corrida do INSERT e é descartada sem tocar em estado. Linha efêmera — '
  'voip-webhook-events-cleanup apaga o que passou de expires_at.';

COMMENT ON COLUMN public.voip_webhook_events.event_jti IS
  'jti do envelope VPS→CRM. NÃO confundir com voip_calls.token_jti, que é o jti '
  'do token de chamada CRM→VPS, assinado com OUTRO par de chaves.';

COMMENT ON COLUMN public.voip_webhook_events.expires_at IS
  'Janela de dedup: now() + 60 min. Tem que ser >= TTL do envelope (300 s, '
  'webhookTTL na VPS) + skew tolerado. Está folgada de propósito — encurtar sem '
  'olhar o TTL junto reabre a janela de replay.';

ALTER TABLE public.voip_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voip_webhook_events_select_org" ON public.voip_webhook_events;
CREATE POLICY "voip_webhook_events_select_org" ON public.voip_webhook_events
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "master_select_all_voip_webhook_events" ON public.voip_webhook_events;
CREATE POLICY "master_select_all_voip_webhook_events" ON public.voip_webhook_events
  FOR SELECT TO authenticated USING ((SELECT is_master_user()));

-- REVOKE de PUBLIC **e** de anon, separadamente: o pg_default_acl do schema
-- public concede anon em toda tabela nova, e revogar de PUBLIC não alcança grant
-- direto. Lição de 20270728000002_revoke_anon_meta_conversations.sql.
REVOKE ALL ON public.voip_webhook_events FROM PUBLIC;
REVOKE ALL ON public.voip_webhook_events FROM anon;

-- E de `authenticated` também, ANTES do GRANT SELECT. O mesmo pg_default_acl
-- concede `arwdDxtm` a authenticated em toda tabela nova de `public` — inclusive
-- `D`, que é TRUNCATE. As policies acima só cobrem SELECT, então INSERT/UPDATE/
-- DELETE já morrem na RLS; **TRUNCATE não passa por RLS nenhuma**. Nesta tabela
-- especificamente isso é a janela de anti-replay inteira, de todos os tenants,
-- apagável de fora. Medido em 2026-07-31: voip_sessions, voip_calls,
-- voip_call_usage e send_dedup_log carregam o mesmo grant herdado — condição
-- pré-existente do projeto, não deste arquivo, e que merece varredura própria.
REVOKE ALL ON public.voip_webhook_events FROM authenticated;
GRANT SELECT ON public.voip_webhook_events TO authenticated;
GRANT ALL    ON public.voip_webhook_events TO service_role;

-- ===========================================================================
-- 2. Marca d'água de ordem, por sessão
-- ===========================================================================
--
-- `epoch` sobe a cada restart da VPS; `seq` é monotônico dentro do epoch. Por
-- isso EPOCH MAIOR COM SEQ MENOR É ACEITO — é exatamente o caso do restart, e é
-- o ponto inteiro de existir epoch. Comparar só `seq` faria o CRM descartar
-- todos os eventos após um restart até a VPS reemitir mais de `last_seq` eventos.

ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.voip_sessions ADD COLUMN IF NOT EXISTS last_seq       bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.voip_sessions.last_seq_epoch IS
  'Epoch do último evento VPS→CRM aplicado nesta sessão. Sobe a cada restart da '
  'VPS. Ordem = (last_seq_epoch, last_seq) lexicográfico.';

COMMENT ON COLUMN public.voip_sessions.last_seq IS
  'Seq do último evento VPS→CRM aplicado nesta sessão, dentro do epoch corrente.';

-- ===========================================================================
-- 3. fn_voip_apply_vps_event — a aplicação
-- ===========================================================================
--
-- CONTRATO DE SAÍDA: jsonb { ok, code, detail? }.
--
--   code                 | significado                              | T8 responde
--   ---------------------|------------------------------------------|-----------
--   applied              | estado aplicado (ou nada a fazer)        | 200
--   replay               | jti já visto                             | 200
--   out_of_order         | superado por evento mais novo            | 200
--   session_not_found    | sessão sumiu daqui                       | 202
--   session_inert        | sessão em quarentena                     | 202
--   transition_refused   | o evento não cabe no estado atual        | 409
--
-- `ok` significa "consumido, NÃO retente" — por isso é true até em
-- `session_not_found`: a VPS retentar por sessão que não existe aqui é ruído
-- eterno. `ok=false` só em `transition_refused`, que é a única saída que merece
-- olho humano.
--
-- `detail` é diagnóstico, NÃO faz parte do contrato de roteamento. T8 decide
-- pelo `code`; `detail` vai para runtime_logs.

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
  -- >= TTL do envelope (300 s) + skew. Ver COMMENT em expires_at.
  c_dedup_window constant interval := interval '60 minutes';

  -- Conjunto FECHADO, espelho do Go. Não é decoração: `end_reason` não tem CHECK
  -- na tabela, e sem esta lista a VPS escreveria `no_terminal_event` no ledger —
  -- o motivo PRÓPRIO do varredor. Isso corromperia a métrica que mede o atraso
  -- do webhook E daria à VPS uma alavanca para ressuscitar linha à vontade.
  c_end_reasons  constant text[] := ARRAY[
    'user_ended','declined','timeout','busy','cancelled','failed','do_not_disturb','unknown'
  ];

  -- Carimbo vindo da VPS só é aceito dentro desta janela em torno do relógio do
  -- CRM. Relógio de terceiro escrevendo direto no ledger é como nasce duração de
  -- chamada negativa.
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
BEGIN
  IF p_event_jti IS NULL OR p_sid IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'malformed_envelope');
  END IF;

  -- O CHECK da tabela recusaria isto com exceção, e exceção vira 500 no
  -- endpoint. Um envelope malformado não é falha do CRM.
  IF COALESCE(p_epoch, 0) <= 0 OR COALESCE(p_seq, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'invalid_sequence');
  END IF;

  v_type := p_payload->>'type';

  -- FOR UPDATE serializa os eventos DESTA sessão. Sem ele, duas entregas
  -- concorrentes leem a mesma marca d'água, ambas passam no teste de ordem e
  -- ambas aplicam — a ordem viraria decoração sob a única condição em que ela
  -- importa. A trava é sempre tomada na mesma ordem (sessão, depois jti, depois
  -- chamada), então não há ciclo de deadlock.
  SELECT * INTO v_session
    FROM public.voip_sessions
   WHERE tc_session_id = p_sid
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Sem reserva de jti de propósito: a sessão pode nascer aqui depois, e nesse
    -- caso a retentativa DEVE poder aplicar.
    RETURN jsonb_build_object('ok', true, 'code', 'session_not_found');
  END IF;

  IF v_session.status = 'quarantined' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'session_inert');
  END IF;

  -- Primeira escrita da transação. Perder a corrida aqui é a definição de replay.
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

  -- Epoch maior com seq menor É ACEITO. Ver seção 2.
  IF NOT (p_epoch > v_session.last_seq_epoch
          OR (p_epoch = v_session.last_seq_epoch AND p_seq > v_session.last_seq)) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'out_of_order');
  END IF;

  UPDATE public.voip_sessions
     SET last_seq_epoch = p_epoch,
         last_seq       = p_seq,
         updated_at     = now()
   WHERE id = v_session.id;

  -- =========================================================================
  -- auth-state
  -- =========================================================================
  -- `state` é a autoridade; `paired` viaja junto no payload mas é derivado dele
  -- e não decide nada aqui — dois campos decidindo o mesmo estado é como se
  -- inventa um estado que nenhum dos dois descreve.
  IF v_type = 'auth-state' THEN
    v_state := p_payload->>'state';

    v_next := CASE v_session.status
      WHEN 'pending' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing' WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed' ELSE NULL END
      WHEN 'pairing' THEN CASE v_state
                            WHEN 'qr' THEN 'pairing' WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed' ELSE NULL END
      -- `open` + `qr` é recusa: sessão viva não volta para a tela de pareamento
      -- por um evento atrasado. Quem desloga emite `logged_out`.
      WHEN 'open'    THEN CASE v_state
                            WHEN 'qr' THEN NULL      WHEN 'open' THEN 'open'
                            WHEN 'logged_out' THEN 'closed' ELSE NULL END
      -- `closed` + `open` é recusa: reabrir exige parear de novo, e o pareamento
      -- passa por `qr`.
      WHEN 'closed'  THEN CASE v_state
                            WHEN 'qr' THEN 'pairing' WHEN 'open' THEN NULL
                            WHEN 'logged_out' THEN 'closed' ELSE NULL END
      ELSE NULL
    END;

    IF v_next IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'transition_refused',
        'detail', CASE WHEN v_state IN ('qr','open','logged_out')
                       THEN 'state_transition_refused' ELSE 'unknown_state' END,
        'from', v_session.status, 'to', v_state);
    END IF;

    IF v_next <> v_session.status THEN
      UPDATE public.voip_sessions
         SET status = v_next, updated_at = now()
       WHERE id = v_session.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'code', 'applied',
                              'detail', 'auth_state', 'session_status', v_next);
  END IF;

  -- =========================================================================
  -- Localização da linha de chamada — comum a call-status e call-ended
  -- =========================================================================
  IF v_type IN ('call-status', 'call-ended') THEN
    v_tc_call := NULLIF(p_payload->>'id', '');

    IF v_tc_call IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                'detail', 'missing_call_id');
    END IF;

    -- organization_id redundante com a FK de tc_session_id; explícito porque é
    -- barato e porque a org NUNCA sai do corpo da requisição.
    SELECT * INTO v_call
      FROM public.voip_calls
     WHERE tc_session_id   = p_sid
       AND tc_call_id      = v_tc_call
       AND organization_id = v_session.organization_id
     FOR UPDATE;

    IF NOT FOUND THEN
      -- Caso REAL, não defeito: chamada de entrada existe na VPS antes de o CRM
      -- registrar a linha (quem registra é torquecalls-signal, no atender).
      -- Retentar não criaria a linha, então o evento é consumido — mas fica
      -- visível, porque volume disso é sinal de que falta registrar o inbound.
      INSERT INTO public.runtime_logs
        (organization_id, module, action, status, payload_snapshot)
      VALUES (v_session.organization_id, 'voip', 'webhook_chamada_desconhecida', 'skipped',
              jsonb_build_object('tc_session_id', p_sid, 'tc_call_id', v_tc_call,
                                 'type', v_type));
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'call_not_found');
    END IF;
  END IF;

  -- =========================================================================
  -- call-status
  -- =========================================================================
  IF v_type = 'call-status' THEN
    v_status := p_payload->>'status';

    -- `starting` não tem correspondente em voip_calls.status (o CHECK da tabela
    -- é authorized/ringing/connected/ended/expired) e a linha já nasce
    -- `authorized`. Consumir sem escrever é a leitura honesta.
    IF v_status = 'starting' THEN
      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'noop_starting');
    END IF;

    IF v_status = 'ringing' THEN
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      v_ts := CASE
        WHEN jsonb_typeof(p_payload->'startedAt') = 'number'
         AND to_timestamp((p_payload->>'startedAt')::numeric / 1000.0)
             BETWEEN now() - c_ts_past AND now() + c_ts_future
        THEN to_timestamp((p_payload->>'startedAt')::numeric / 1000.0)
        ELSE now()
      END;

      -- A fase só anda para frente. Um `ringing` atrasado depois do `connected`
      -- rebaixaria o status e o varredor voltaria a mirar a linha (2 min contra
      -- as 2 h do ramo `connected`).
      IF v_call.status = 'connected' THEN
        UPDATE public.voip_calls
           SET ringing_at = COALESCE(ringing_at, v_ts), updated_at = now()
         WHERE id = v_call.id;
        RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                  'detail', 'noop_already_connected');
      END IF;

      UPDATE public.voip_calls
         SET status     = 'ringing',
             ringing_at = COALESCE(ringing_at, v_ts),
             updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ringing');
    END IF;

    IF v_status = 'connected' THEN
      -- Ressurreição. Só do chute do varredor, e só com o operador livre.
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
          -- ended_at também volta a NULL: linha viva com carimbo de fim é uma
          -- mentira que a próxima auditoria acredita.
          UPDATE public.voip_calls
             SET status       = 'connected',
                 connected_at = COALESCE(connected_at, now()),
                 ended_at     = NULL,
                 end_reason   = NULL,
                 updated_at   = now()
           WHERE id = v_call.id;
        EXCEPTION WHEN unique_violation THEN
          -- idx_voip_calls_one_live_per_operator. O EXISTS acima é a checagem
          -- barata; o índice é a invariante. Sob corrida, quem perde recusa.
          RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                    'detail', 'operator_busy');
        END;

        -- Ressurreição SEMPRE deixa rastro: ela significa que a entrega do
        -- webhook está mais lenta que os 2 minutos do varredor.
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
        -- user_ended, rejected, declined, reservation_expired: alguém decidiu.
        RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                                  'detail', 'call_already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status       = 'connected',
             connected_at = COALESCE(connected_at, now()),
             updated_at   = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'connected');
    END IF;

    IF v_status = 'ended' THEN
      -- Hoje o Go emite o fim por `call-ended`, que carrega a causa. Este ramo
      -- existe para não descartar em silêncio um `call-status` terminal — e por
      -- isso NÃO sobrescreve linha já terminal: trocar `no_terminal_event` por
      -- `unknown` seria perder informação para ganhar nenhuma.
      IF v_call.status IN ('ended','expired') THEN
        RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'already_terminal');
      END IF;

      UPDATE public.voip_calls
         SET status     = 'ended',
             ended_at   = COALESCE(ended_at, now()),
             end_reason = 'unknown',
             updated_at = now()
       WHERE id = v_call.id;

      RETURN jsonb_build_object('ok', true, 'code', 'applied', 'detail', 'ended_via_status');
    END IF;

    RETURN jsonb_build_object('ok', false, 'code', 'transition_refused',
                              'detail', 'unknown_status', 'status', v_status);
  END IF;

  -- =========================================================================
  -- call-ended
  -- =========================================================================
  IF v_type = 'call-ended' THEN
    v_reason := COALESCE(NULLIF(p_payload->>'reason', ''), 'unknown');
    IF NOT (v_reason = ANY (c_end_reasons)) THEN
      v_reason := 'unknown';
    END IF;

    v_ts := CASE
      WHEN jsonb_typeof(p_payload->'endedAt') = 'number'
       AND to_timestamp((p_payload->>'endedAt')::numeric / 1000.0)
           BETWEEN now() - c_ts_past AND now() + c_ts_future
      THEN to_timestamp((p_payload->>'endedAt')::numeric / 1000.0)
      ELSE now()
    END;

    IF v_call.status NOT IN ('ended','expired') THEN
      UPDATE public.voip_calls
         SET status     = 'ended',
             ended_at   = COALESCE(ended_at, v_ts),
             end_reason = v_reason,
             updated_at = now()
       WHERE id = v_call.id;
      RETURN jsonb_build_object('ok', true, 'code', 'applied',
                                'detail', 'ended', 'end_reason', v_reason);
    END IF;

    -- Linha já fechada pelo varredor: a VPS traz a causa VERDADEIRA, e ela
    -- substitui o chute. Este é o único caso em que um motivo terminal é
    -- reescrito.
    IF v_call.end_reason = 'no_terminal_event' THEN
      UPDATE public.voip_calls
         SET end_reason = v_reason,
             ended_at   = v_ts,
             updated_at = now()
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

COMMENT ON FUNCTION public.fn_voip_apply_vps_event(uuid, text, bigint, bigint, timestamptz, jsonb) IS
  'Aplica UM evento assinado da VPS: anti-replay pelo jti, ordem por '
  '(epoch, seq), transição de sessão e escrita no ledger de chamada — tudo numa '
  'transação. A organização sai de voip_sessions pelo tc_session_id, NUNCA do '
  'corpo. Devolve {ok, code, detail?}; ok=false só em transition_refused. '
  'service_role apenas — chamada por torquecalls-webhook.';

-- ===========================================================================
-- 4. Limpeza da tabela de reserva
-- ===========================================================================
--
-- Idempotente (unschedule antes de schedule) para sobreviver a `db reset`, que
-- reaplica migrations num banco onde o job pode já existir. Mesmo padrão da
-- seção 7 da fundação e do voip-sweep-stuck-calls.
--
-- O `- interval '1 minute'` de folga é deliberado: apagar exatamente em
-- expires_at deixaria uma janela em que a linha some no mesmo instante em que um
-- retardatário ainda poderia chegar.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-webhook-events-cleanup') THEN
    PERFORM cron.unschedule('voip-webhook-events-cleanup');
  END IF;
  PERFORM cron.schedule('voip-webhook-events-cleanup', '*/5 * * * *',
    $clean$DELETE FROM public.voip_webhook_events WHERE expires_at < now() - interval '1 minute'$clean$);
END
$cron$;
