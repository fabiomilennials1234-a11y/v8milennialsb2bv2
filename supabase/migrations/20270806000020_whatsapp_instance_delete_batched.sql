-- 20270806000020_whatsapp_instance_delete_batched.sql
--
-- Excluir instância de WhatsApp estourava `statement timeout` em qualquer org
-- com histórico grande. Medido no PROD (Goletric Perdizes, instância
-- c7e4ba84…, 8 falhas em 06/08):
--
--   UPDATE whatsapp_messages SET instance_id = $1 WHERE instance_id = $2
--     → média 22,7s / pico 53,4s  (pg_stat_statements)
--
-- `whatsapp_messages` tem 4,4 GB e 18 índices, 7 deles contendo `instance_id`
-- (nenhum update é HOT). O teto que vale para a chamada do proxy é o do
-- PostgREST — `authenticator` está em 8s. Logo:
--   1. a pré-nulificação do edge function estoura e é revertida em silêncio;
--   2. o DELETE cai no cascade `ON DELETE SET NULL`, que é o MESMO update de
--      22s, e estoura de novo → "DB delete failed: canceling statement due to
--      statement timeout".
--
-- Conserto: uma RPC que faz UM lote por chamada e devolve progresso, com
-- `statement_timeout` próprio. O edge function chama em laço até `done`.
-- Bônus: índice nas 12 colunas de FK para `whatsapp_instances` que não tinham
-- (cada DELETE fazia seq scan nelas).

-- ---------------------------------------------------------------------------
-- 1. Índices nas FKs órfãs de índice
-- ---------------------------------------------------------------------------
-- Todas são tabelas pequenas (≤ 361 linhas hoje), então CREATE INDEX comum
-- não lockeia nada relevante — e migration roda em transação, onde
-- CONCURRENTLY não é permitido.

CREATE INDEX IF NOT EXISTS idx_scheduled_pipe_messages_wa_instance
  ON public.scheduled_pipe_messages (whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_campaign_messages_wa_instance
  ON public.scheduled_campaign_messages (whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_user_messages_wa_instance
  ON public.scheduled_user_messages (whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_team_members_preferred_wa_instance
  ON public.team_members (preferred_whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_blast_plan_recipients_instance
  ON public.blast_plan_recipients (instance_id);

CREATE INDEX IF NOT EXISTS idx_blast_plans_instance
  ON public.blast_plans (instance_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_dlq_resolved_instance
  ON public.whatsapp_webhook_dlq (resolved_instance_id);

CREATE INDEX IF NOT EXISTS idx_uazapi_sender_jobs_instance
  ON public.uazapi_sender_jobs (instance_id);

CREATE INDEX IF NOT EXISTS idx_voip_call_usage_wa_instance
  ON public.voip_call_usage (whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_pipe_dispatch_rules_wa_instance
  ON public.pipe_dispatch_rules (whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_pending_copilot_deliveries_instance
  ON public.pending_copilot_deliveries (instance_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_rate_tracking_instance
  ON public.whatsapp_rate_tracking (instance_id);

-- ---------------------------------------------------------------------------
-- 2. RPC — um lote por chamada, com progresso
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: chamada só por service_role, e o whatsapp-api-proxy já
-- validou a fronteira de tenant (organization_id do caller × da instância)
-- antes de chegar aqui. A função ainda assim recusa destino de outra org.
--
-- p_reassign_to:
--   NULL  → comportamento histórico (mensagens ficam com instance_id NULL e
--           somem do chat, que filtra por instância) + jobs/health apagados.
--   uuid  → migra o histórico para outra instância da mesma org, preservando
--           o chat. É o caminho não-destrutivo.

CREATE OR REPLACE FUNCTION public.whatsapp_instance_delete_step(
  p_instance_id uuid,
  p_reassign_to uuid DEFAULT NULL,
  p_batch integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_dest_org uuid;
  v_touched  integer;
  v_left     bigint;
BEGIN
  -- Vale só por esta transação. Sem isto herdamos os 8s do `authenticator`,
  -- que é exatamente o teto que o lote estoura.
  PERFORM set_config('statement_timeout', '55s', true);

  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 20000 THEN
    RAISE EXCEPTION 'p_batch fora do intervalo permitido (1..20000)'
      USING ERRCODE = '22023';
  END IF;

  SELECT organization_id INTO v_org
    FROM whatsapp_instances WHERE id = p_instance_id;

  -- Idempotente: chamar de novo depois de pronto não é erro.
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('done', true, 'phase', 'already_gone', 'remaining', 0);
  END IF;

  IF p_reassign_to IS NOT NULL THEN
    IF p_reassign_to = p_instance_id THEN
      RAISE EXCEPTION 'p_reassign_to nao pode ser a propria instancia'
        USING ERRCODE = '22023';
    END IF;
    SELECT organization_id INTO v_dest_org
      FROM whatsapp_instances WHERE id = p_reassign_to;
    IF v_dest_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'p_reassign_to precisa ser instancia da mesma organizacao'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Fase 1 — mensagens. FK ON DELETE SET NULL: é este cascade que estoura.
  -- O NOT EXISTS respeita a UNIQUE (message_id, instance_id) do destino; o
  -- resíduo (mensagem que já existe lá) cai no cascade do DELETE final, que
  -- por definição é pequeno.
  UPDATE whatsapp_messages
     SET instance_id = p_reassign_to
   WHERE ctid IN (
     SELECT m.ctid FROM whatsapp_messages m
      WHERE m.instance_id = p_instance_id
        AND (
          p_reassign_to IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM whatsapp_messages d
             WHERE d.instance_id = p_reassign_to
               AND d.message_id = m.message_id
          )
        )
      LIMIT p_batch
   );
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  IF v_touched > 0 THEN
    SELECT count(*) INTO v_left
      FROM whatsapp_messages WHERE instance_id = p_instance_id;
    RETURN jsonb_build_object(
      'done', false, 'phase', 'messages', 'touched', v_touched, 'remaining', v_left
    );
  END IF;

  -- Fase 2 — jobs de mídia (FK CASCADE, coluna NOT NULL).
  IF p_reassign_to IS NULL THEN
    DELETE FROM whatsapp_media_jobs
     WHERE ctid IN (
       SELECT ctid FROM whatsapp_media_jobs
        WHERE instance_id = p_instance_id LIMIT p_batch
     );
  ELSE
    UPDATE whatsapp_media_jobs
       SET instance_id = p_reassign_to
     WHERE ctid IN (
       SELECT j.ctid FROM whatsapp_media_jobs j
        WHERE j.instance_id = p_instance_id
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_media_jobs d
             WHERE d.instance_id = p_reassign_to
               AND d.message_id = j.message_id
          )
        LIMIT p_batch
     );
  END IF;
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  IF v_touched > 0 THEN
    SELECT count(*) INTO v_left
      FROM whatsapp_media_jobs WHERE instance_id = p_instance_id;
    RETURN jsonb_build_object(
      'done', false, 'phase', 'media_jobs', 'touched', v_touched, 'remaining', v_left
    );
  END IF;

  -- Fase 3 — health checks (FK CASCADE, NOT NULL, ~288 linhas/dia/instância).
  DELETE FROM whatsapp_health_checks
   WHERE ctid IN (
     SELECT ctid FROM whatsapp_health_checks
      WHERE instance_id = p_instance_id LIMIT p_batch
   );
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  IF v_touched > 0 THEN
    SELECT count(*) INTO v_left
      FROM whatsapp_health_checks WHERE instance_id = p_instance_id;
    RETURN jsonb_build_object(
      'done', false, 'phase', 'health_checks', 'touched', v_touched, 'remaining', v_left
    );
  END IF;

  -- Fase 4 — whatsapp_conversation_summary NÃO tem FK para whatsapp_instances.
  -- Sem destino, as linhas ficam de propósito apontando para o UUID morto: é
  -- esse rastro que permite restaurar o histórico recriando a instância com o
  -- MESMO UUID. Com destino, migram junto (PK = org + instance + phone, então
  -- pula quem já existe lá).
  IF p_reassign_to IS NOT NULL THEN
    UPDATE whatsapp_conversation_summary
       SET instance_id = p_reassign_to
     WHERE ctid IN (
       SELECT s.ctid FROM whatsapp_conversation_summary s
        WHERE s.instance_id = p_instance_id
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_conversation_summary d
             WHERE d.organization_id = s.organization_id
               AND d.instance_id = p_reassign_to
               AND d.normalized_phone = s.normalized_phone
          )
        LIMIT p_batch
     );
    GET DIAGNOSTICS v_touched = ROW_COUNT;
    IF v_touched > 0 THEN
      SELECT count(*) INTO v_left
        FROM whatsapp_conversation_summary WHERE instance_id = p_instance_id;
      RETURN jsonb_build_object(
        'done', false, 'phase', 'conversation_summary', 'touched', v_touched, 'remaining', v_left
      );
    END IF;
  END IF;

  -- Fase 5 — a linha. O que sobrou de FK aqui é miúdo (secrets, allowed
  -- members, conversations) e agora tem índice.
  DELETE FROM whatsapp_instances WHERE id = p_instance_id;

  RETURN jsonb_build_object('done', true, 'phase', 'deleted', 'remaining', 0);
END;
$$;

COMMENT ON FUNCTION public.whatsapp_instance_delete_step(uuid, uuid, integer) IS
  'Exclui uma instância de WhatsApp em lotes, um por chamada, devolvendo progresso em jsonb {done, phase, touched, remaining}. Chamada em laço pelo whatsapp-api-proxy (deleteInstance). p_reassign_to migra o histórico para outra instância da mesma org em vez de orfanar.';

REVOKE ALL ON FUNCTION public.whatsapp_instance_delete_step(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_instance_delete_step(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_instance_delete_step(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_instance_delete_step(uuid, uuid, integer) TO service_role;
