-- F5a (RAM/pool PostgREST): o webhook Uazapi gastava 3–4 idas ao PostgREST por
-- mensagem (register_workflow_button_ingress → upsert whatsapp_messages →
-- select id → receive_workflow_button_reply) e 1–2 por recibo (update status →
-- lookup de fallback). Cada ida ocupa um backend do pool (~60 MB) pelo tempo
-- de ida-e-volta. Estas duas funções fazem o mesmo trabalho em UMA chamada.
--
-- Comportamento idêntico ao caminho antigo, inclusive nas falhas:
--   * a admissão do botão (passo 1) sobrevive a qualquer falha posterior — o
--     upsert, o eco de status e o receive rodam em sub-blocos com EXCEPTION
--     (savepoint), exatamente como eram transações separadas antes;
--   * colunas não enviadas recebem DEFAULT (INSERT só com as chaves presentes,
--     igual ao PostgREST), chave desconhecida falha como o PGRST204 falhava;
--   * a org vem SEMPRE de whatsapp_instances.id; organization_id/instance_id
--     do p_message são sobrescritos.
--
-- Timeout (57014) dentro do upsert/eco/receive também vira status (DLQ/5xx na
-- edge) preservando a admissão; timeout no próprio register aborta tudo (= falha
-- do register antes).
--
-- Erros (nunca 40001: PostgREST reexecuta 40001 sem fim):
--   PT404 uazapi_instance_not_found  — instância inexistente
--   PT409 uazapi_ingest_conflict     — serialização/deadlock convertidos
--   PT400 uazapi_receipt_invalid     — status/predecessores fora do domínio
--
-- Ligado por org via env UAZAPI_INGEST_RPC_ORGS na edge (vazio = caminho antigo).
-- Rollback: supabase/migrations/rollback/20271201000000_uazapi_ingest_rpc.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_uazapi_message(
  p_instance_id uuid,
  p_payload jsonb,
  p_message jsonb,
  p_source text DEFAULT 'webhook',
  p_echo_prior_statuses text[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Chaves do NormalizedMessage (supabase/functions/whatsapp-webhook/handler.ts).
  c_allowed constant text[] := ARRAY[
    'organization_id','instance_id','message_id','remote_jid','phone_number','direction',
    'message_type','content','condition_text','condition_text_source','media_url','push_name',
    'status','timestamp','raw_payload','is_group','sent_by_team_member_id','received_via'];
  v_org uuid;
  v_msg jsonb;
  v_message_id text;
  v_direction text;
  v_is_group boolean;
  v_cols text;
  v_unknown text;
  v_row_id uuid;
  v_inserted boolean := false;
  v_echo_updated boolean := false;
  v_received jsonb;
  v_state text;
  v_detail text;
  v_capture_off boolean := false;
BEGIN
  SELECT i.organization_id INTO v_org FROM public.whatsapp_instances i WHERE i.id = p_instance_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'uazapi_instance_not_found' USING ERRCODE = 'PT404';
  END IF;

  -- 1. Admissão durável do botão. Falha aqui aborta tudo (nada gravado) —
  --    a edge responde 503 question_buttons_ingress_unavailable, como antes.
  PERFORM public.register_workflow_button_ingress(v_org, p_instance_id, p_payload, p_source);

  IF p_message IS NULL OR jsonb_typeof(p_message) <> 'object'
     OR coalesce(p_message->>'message_id', '') = '' THEN
    RETURN jsonb_build_object('status', 'no_message_id', 'organization_id', v_org);
  END IF;

  v_msg := p_message || jsonb_build_object('organization_id', v_org, 'instance_id', p_instance_id);
  v_message_id := v_msg->>'message_id';
  v_direction := v_msg->>'direction';
  v_is_group := coalesce(v_msg->>'is_group', 'false') = 'true';

  -- 2. Grupos: opt-out explícito da org (NULL/ausente = captura). Leitura que
  --    falha = captura (fail-open do caminho antigo). 57014 NÃO é pego aqui de
  --    propósito: o timer do statement_timeout já disparou, seguir para
  --    INSERT + triggers + receive deixaria o backend sem teto. Aborta → 503,
  --    igual a timeout no register.
  IF v_is_group THEN
    BEGIN
      SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org AND o.capture_groups IS FALSE)
        INTO v_capture_off;
    EXCEPTION WHEN OTHERS THEN
      v_capture_off := false;
    END;
    IF v_capture_off THEN
      RETURN jsonb_build_object('status', 'group_skipped', 'organization_id', v_org);
    END IF;
  END IF;

  -- 3. Upsert ignore-duplicates. Sub-bloco = savepoint: falha não desfaz o passo 1.
  --    `OTHERS` NÃO cobre query_canceled (57014 = statement_timeout do
  --    authenticator em prod, 8 s, ou cancel): sem nomeá-lo, um timeout aqui
  --    derrubaria a admissão junto. lock_timeout é 55P03, já coberto por OTHERS.
  --    Os três sub-blocos tratam 57014 igual a qualquer falha.
  BEGIN
    SELECT string_agg(k, ',') INTO v_unknown
      FROM jsonb_object_keys(v_msg) AS k WHERE NOT (k = ANY (c_allowed));
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'unknown whatsapp_messages column(s): %', v_unknown USING ERRCODE = '42703';
    END IF;
    SELECT string_agg(format('%I', k), ',') INTO v_cols FROM jsonb_object_keys(v_msg) AS k;
    EXECUTE format(
      'INSERT INTO public.whatsapp_messages (%1$s) SELECT %1$s FROM pg_catalog.jsonb_populate_record(NULL::public.whatsapp_messages, $1) ON CONFLICT (message_id, instance_id) DO NOTHING RETURNING id',
      v_cols) INTO v_row_id USING v_msg;
    v_inserted := v_row_id IS NOT NULL;
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = MESSAGE_TEXT;
    RETURN jsonb_build_object('status', 'upsert_failed', 'organization_id', v_org,
      'sqlstate', v_state, 'error_message', v_detail);
  END;

  -- 4. Eco de saída: promove só status anteriores (lista vem de statusesBeforeEcho).
  IF v_direction = 'outgoing' AND coalesce(cardinality(p_echo_prior_statuses), 0) > 0 THEN
    BEGIN
      UPDATE public.whatsapp_messages m SET status = v_msg->>'status'
        WHERE m.organization_id = v_org AND m.instance_id = p_instance_id
          AND m.message_id = v_message_id AND m.direction = 'outgoing'
          AND m.status = ANY (p_echo_prior_statuses);
      v_echo_updated := true;
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      RETURN jsonb_build_object('status', 'echo_status_failed', 'organization_id', v_org);
    END;
  END IF;

  -- 5. Id da linha (nova ou já existente), restrito à org da instância.
  SELECT m.id INTO v_row_id FROM public.whatsapp_messages m
    WHERE m.organization_id = v_org AND m.message_id = v_message_id AND m.instance_id = p_instance_id;
  IF v_row_id IS NULL THEN
    RETURN jsonb_build_object('status', 'missing_row', 'organization_id', v_org,
      'echo_status_updated', v_echo_updated);
  END IF;

  -- 6. Resposta de botão só pela admissão já registrada (incoming 1:1).
  IF v_direction = 'incoming' AND NOT v_is_group THEN
    BEGIN
      v_received := public.receive_workflow_button_reply(v_row_id, v_org);
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      RETURN jsonb_build_object('status', 'button_reply_failed', 'organization_id', v_org,
        'row_id', v_row_id, 'inserted', v_inserted, 'echo_status_updated', v_echo_updated);
    END;
  END IF;

  RETURN jsonb_build_object(
    'status', 'persisted',
    'organization_id', v_org,
    'row_id', v_row_id,
    'inserted', v_inserted,
    'button_reply_recognized', coalesce((v_received->>'recognized')::boolean, false),
    'echo_status_updated', v_echo_updated);
EXCEPTION
  WHEN serialization_failure OR deadlock_detected THEN
    RAISE EXCEPTION 'uazapi_ingest_conflict' USING ERRCODE = 'PT409';
END $$;

COMMENT ON FUNCTION public.ingest_uazapi_message(uuid, jsonb, jsonb, text, text[]) IS
  'F5a: admissão de botão + upsert + eco + receive em 1 chamada do webhook Uazapi. Org resolvida por whatsapp_instances.id. service_role only.';

CREATE OR REPLACE FUNCTION public.apply_uazapi_receipt(
  p_instance_id uuid,
  p_message_ids text[],
  p_status text,
  p_predecessors text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_changed integer;
  v_has_outgoing boolean;
BEGIN
  IF p_status IS NULL OR NOT (p_status = ANY (ARRAY['sent','delivered','read','failed']))
     OR coalesce(cardinality(p_predecessors), 0) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_predecessors) s
                WHERE s IS NULL OR NOT (s = ANY (ARRAY['pending','sent','delivered','failed'])) OR s = p_status) THEN
    RAISE EXCEPTION 'uazapi_receipt_invalid' USING ERRCODE = 'PT400';
  END IF;

  SELECT i.organization_id INTO v_org FROM public.whatsapp_instances i WHERE i.id = p_instance_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'uazapi_instance_not_found' USING ERRCODE = 'PT404';
  END IF;

  IF coalesce(cardinality(p_message_ids), 0) = 0 THEN
    RETURN jsonb_build_object('changed_count', 0, 'has_outgoing', false);
  END IF;

  UPDATE public.whatsapp_messages m SET status = p_status
    WHERE m.organization_id = v_org AND m.instance_id = p_instance_id
      AND m.direction = 'outgoing' AND m.message_id = ANY (p_message_ids)
      AND m.status = ANY (p_predecessors);
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed > 0 THEN
    v_has_outgoing := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_messages m
        WHERE m.organization_id = v_org AND m.instance_id = p_instance_id
          AND m.message_id = ANY (p_message_ids) AND m.direction = 'outgoing'
    ) INTO v_has_outgoing;
  END IF;

  RETURN jsonb_build_object('changed_count', v_changed, 'has_outgoing', v_has_outgoing);
EXCEPTION
  WHEN serialization_failure OR deadlock_detected THEN
    RAISE EXCEPTION 'uazapi_receipt_conflict' USING ERRCODE = 'PT409';
END $$;

COMMENT ON FUNCTION public.apply_uazapi_receipt(uuid, text[], text, text[]) IS
  'F5a: recibo Uazapi (update de status com predecessores + lookup de fallback) em 1 chamada. Org resolvida por whatsapp_instances.id. service_role only.';

-- Função nova nasce executável por PUBLIC; DEFINER exige fechar explicitamente.
REVOKE ALL ON FUNCTION public.ingest_uazapi_message(uuid, jsonb, jsonb, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_uazapi_receipt(uuid, text[], text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_uazapi_message(uuid, jsonb, jsonb, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_uazapi_receipt(uuid, text[], text, text[]) TO service_role;

COMMIT;
