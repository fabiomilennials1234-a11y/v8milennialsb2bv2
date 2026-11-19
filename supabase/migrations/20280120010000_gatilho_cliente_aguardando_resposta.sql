-- 20280120010000_gatilho_cliente_aguardando_resposta.sql
--
-- Gatilho de automação "Cliente aguardando resposta" (`company_no_reply`).
--
-- Espelho do `lead_no_reply`, do lado oposto da conversa: dispara quando o
-- CLIENTE escreveu e a EMPRESA não respondeu, por mão humana, dentro do prazo
-- configurado no gatilho. Caso de origem: JR Tex cobra o representante quando o
-- lead fica sem resposta humana (o motor regional fazia isso por trigger de
-- banco com 180 min úteis e foi removido em #2529 — a decisão é que isso mora em
-- automação). Esta função só ACHA candidatos; quem decide o prazo útil, grava a
-- execução e deduplica atomicamente é `process-workflow-executions`.
--
-- O que é "resposta da empresa"
-- -----------------------------
-- A MESMA régua que o produto já usa para "humano respondeu" (inbox
-- "Aguardando resposta", primeiro envio humano move etapa — 20271214000002, e o
-- antigo SLA regional):
--   chip (`whatsapp_messages`): direction='outgoing' AND sent_source='manual'
--       AND NOT sent_by_ai AND status IN ('sent','delivered','read')
--     → automação (workflow/cobranca/…), Copilot/IA e envio que falhou ou ainda
--       está pendente NÃO contam. Mensagem espelhada do celular/WhatsApp Web do
--       vendedor entra com sent_source='manual' e conta — é resposta humana.
--   canal oficial (`channel_messages`): a tabela não tem `sent_source`. A única
--       marca de mão humana é `sent_by_team_member_id` (ADR-0033 §4), gravado
--       pelo envio da caixa do CRM. Robô, disparo e régua gravam NULL. Custo
--       assumido e documentado: resposta de Master/Gestor (ator sem cadeira na
--       org, também NULL) não conta como resposta — o erro cai do lado de cobrar
--       a mais, nunca do lado de esconder cliente esperando.
--
-- A espera
-- --------
-- Âncora = a PRIMEIRA mensagem recebida do cliente depois da última resposta
-- humana (mesma definição de `guided_message_waiting_payload` com
-- waiting_for='lead'). O relógio começa nela. Mensagens de robô no meio não
-- zeram nada. Resposta humana depois do corte mata a espera; mensagem nova do
-- cliente depois disso abre OUTRA espera, com âncora nova.
--
-- A chave da espera é `company_no_reply:<âncora em UTC, microssegundos>`. A
-- função devolve a chave pronta para o chamador gravar em
-- `workflow_executions.trigger_dedup_key`, cujo índice único
-- (workflow_id, lead_id, trigger_dedup_key) torna o "uma vez por espera"
-- atômico — duas rodadas concorrentes do cron colapsam numa execução. Aqui a
-- chave também filtra: espera já disparada não volta como candidata e não
-- consome a página.
--
-- Janela de olhar para trás (`p_since`)
-- -------------------------------------
-- Esperas cuja âncora é anterior a `p_since` NÃO são candidatas. Sem isso,
-- ativar a automação numa org com meses de histórico dispararia de uma vez para
-- todo cliente que um dia ficou sem resposta. O chamador passa corte − 7 dias.
--
-- Escopo de tenant
-- ----------------
-- SECURITY DEFINER com `search_path` vazio e todo acesso qualificado. A org vem
-- por parâmetro, então o vínculo é provado no próprio corpo: o workflow precisa
-- ser desta org, deste tipo de gatilho, e a org não pode estar bloqueada. Toda
-- leitura é recortada por `organization_id = p_organization_id`. EXECUTE só para
-- service_role (o cron); anon/authenticated nunca chamam.
--
-- Telefone
-- --------
-- Lead ↔ mensagem do chip por `normalized_phone` (índice único
-- (organization_id, normalized_phone) em leads) OU por `lead_id`. No canal
-- oficial, por `lead_id` em qualquer canal, e por telefone normalizado com
-- `normalize_brazilian_phone` (a mesma de `guided_message_waiting_payload`) só no
-- canal whatsapp e só sem vínculo de lead — Direct do Instagram não tem telefone.
--
-- Rollback: supabase/migrations/rollback/20280120010000_gatilho_cliente_aguardando_resposta.sql
-- NÃO APLICADA em nenhum banco remoto por esta entrega.

BEGIN;

CREATE OR REPLACE FUNCTION public.find_leads_company_no_reply(
  p_organization_id uuid,
  p_workflow_id uuid,
  p_cutoff timestamp with time zone,
  p_since timestamp with time zone,
  p_pipeline_ids uuid[] DEFAULT NULL,
  p_after uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(lead_id uuid, waiting_since timestamp with time zone, dedup_key text, pipeline_ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH guard AS MATERIALIZED (
    SELECT true AS ok
    FROM public.workflows w
    WHERE w.id = p_workflow_id
      AND w.organization_id = p_organization_id
      AND w.trigger_type = 'company_no_reply'
      AND p_cutoff IS NOT NULL
      AND p_since IS NOT NULL
      AND p_since < p_cutoff
      AND NOT public.org_access_blocked(p_organization_id)
  ),
  -- Quem escreveu dentro da janela [p_since, p_cutoff]. Recorte barato que
  -- limita o resto: só esses podem ter uma espera aberta que já venceu o prazo
  -- de relógio e ainda está dentro da janela de olhar para trás.
  inbound_window AS MATERIALIZED (
    SELECT m.normalized_phone AS phone, m.lead_id
    FROM public.whatsapp_messages m
    WHERE EXISTS (SELECT 1 FROM guard)
      AND m.organization_id = p_organization_id
      AND m.direction = 'incoming'
      AND m.status = 'received'
      AND m."timestamp" > p_since
      AND m."timestamp" <= p_cutoff
      AND m.deleted_at IS NULL
      AND m.is_group = false
      AND m.message_type <> ALL (ARRAY['receipt','reaction','protocol','notification','system']::text[])
    UNION
    SELECT
      CASE
        WHEN cm.lead_id IS NULL
         AND cm.channel = 'whatsapp'
         AND length(regexp_replace(COALESCE(cm.phone_number, ''), '[^0-9]', '', 'g')) BETWEEN 10 AND 13
        THEN public.normalize_brazilian_phone(cm.phone_number)
      END,
      cm.lead_id
    FROM public.channel_messages cm
    WHERE EXISTS (SELECT 1 FROM guard)
      AND cm.organization_id = p_organization_id
      AND cm.direction = 'incoming'
      AND cm.status = 'received'
      AND cm."timestamp" > p_since
      AND cm."timestamp" <= p_cutoff
      AND cm.message_type <> ALL (ARRAY['receipt','reaction','protocol','notification','system']::text[])
  ),
  candidates AS MATERIALIZED (
    SELECT l.id, l.normalized_phone AS phone
    FROM inbound_window w
    JOIN public.leads l
      ON l.organization_id = p_organization_id
     AND l.deleted_at IS NULL
     AND l.id = w.lead_id
    WHERE p_after IS NULL OR l.id > p_after
    UNION
    SELECT l.id, l.normalized_phone
    FROM inbound_window w
    JOIN public.leads l
      ON l.organization_id = p_organization_id
     AND l.deleted_at IS NULL
     AND l.normalized_phone = w.phone
    WHERE w.phone IS NOT NULL
      AND (p_after IS NULL OR l.id > p_after)
  ),
  -- Última resposta HUMANA da empresa, em qualquer tempo (inclusive depois do
  -- corte: resposta dada há 1 minuto encerra a espera).
  last_human AS (
    SELECT c.id, c.phone, h.at
    FROM candidates c
    CROSS JOIN LATERAL (
      SELECT max(x.at) AS at
      FROM (
        SELECT max(m."timestamp") AS at
        FROM public.whatsapp_messages m
        WHERE m.organization_id = p_organization_id
          AND (m.lead_id = c.id OR (c.phone IS NOT NULL AND m.normalized_phone = c.phone))
          AND m.direction = 'outgoing'
          AND m.sent_source = 'manual'
          AND NOT COALESCE(m.sent_by_ai, false)
          AND m.status = ANY (ARRAY['sent','delivered','read']::text[])
          AND m.deleted_at IS NULL
          AND m.is_group = false
        UNION ALL
        SELECT max(cm."timestamp")
        FROM public.channel_messages cm
        WHERE cm.organization_id = p_organization_id
          AND cm.sent_by_team_member_id IS NOT NULL
          AND cm.direction = 'outgoing'
          AND cm.status = ANY (ARRAY['sent','delivered','read']::text[])
          AND (
                cm.lead_id = c.id
                OR (
                     cm.lead_id IS NULL
                     AND c.phone IS NOT NULL
                     AND cm.channel = 'whatsapp'
                     AND length(regexp_replace(COALESCE(cm.phone_number, ''), '[^0-9]', '', 'g')) BETWEEN 10 AND 13
                     AND public.normalize_brazilian_phone(cm.phone_number) = c.phone
                   )
              )
      ) x
    ) h
  ),
  -- Âncora: primeira mensagem do cliente depois da última resposta humana.
  anchored AS (
    SELECT lh.id, a.at
    FROM last_human lh
    CROSS JOIN LATERAL (
      SELECT min(y.at) AS at
      FROM (
        SELECT min(m."timestamp") AS at
        FROM public.whatsapp_messages m
        WHERE m.organization_id = p_organization_id
          AND (m.lead_id = lh.id OR (lh.phone IS NOT NULL AND m.normalized_phone = lh.phone))
          AND m.direction = 'incoming'
          AND m.status = 'received'
          AND m.deleted_at IS NULL
          AND m.is_group = false
          AND m.message_type <> ALL (ARRAY['receipt','reaction','protocol','notification','system']::text[])
          AND m."timestamp" > COALESCE(lh.at, '-infinity'::timestamptz)
        UNION ALL
        SELECT min(cm."timestamp")
        FROM public.channel_messages cm
        WHERE cm.organization_id = p_organization_id
          AND cm.direction = 'incoming'
          AND cm.status = 'received'
          AND cm.message_type <> ALL (ARRAY['receipt','reaction','protocol','notification','system']::text[])
          AND cm."timestamp" > COALESCE(lh.at, '-infinity'::timestamptz)
          AND (
                cm.lead_id = lh.id
                OR (
                     cm.lead_id IS NULL
                     AND lh.phone IS NOT NULL
                     AND cm.channel = 'whatsapp'
                     AND length(regexp_replace(COALESCE(cm.phone_number, ''), '[^0-9]', '', 'g')) BETWEEN 10 AND 13
                     AND public.normalize_brazilian_phone(cm.phone_number) = lh.phone
                   )
              )
      ) y
    ) a
  ),
  keyed AS (
    SELECT
      an.id,
      an.at,
      'company_no_reply:' || to_char(an.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS key
    FROM anchored an
    WHERE an.at IS NOT NULL
      AND an.at > p_since
      AND an.at <= p_cutoff
  )
  SELECT
    k.id,
    k.at,
    k.key,
    COALESCE((
      SELECT array_agg(pe.pipeline_id ORDER BY pe.pipeline_id)
      FROM public.pipeline_entries pe
      WHERE pe.organization_id = p_organization_id
        AND pe.lead_id = k.id
    ), ARRAY[]::uuid[])
  FROM keyed k
  WHERE (
          p_pipeline_ids IS NULL
          OR cardinality(p_pipeline_ids) = 0
          OR EXISTS (
               SELECT 1 FROM public.pipeline_entries pe
               WHERE pe.organization_id = p_organization_id
                 AND pe.lead_id = k.id
                 AND pe.pipeline_id = ANY (p_pipeline_ids)
             )
        )
    -- Espera já disparada (chave) ou execução em voo do mesmo workflow para o
    -- lead: não é candidata. Mesma regra de skip do `fireTrigger`.
    AND NOT EXISTS (
          SELECT 1 FROM public.workflow_executions we
          WHERE we.workflow_id = p_workflow_id
            AND we.lead_id = k.id
            AND (
                  we.trigger_dedup_key = k.key
                  OR we.status = ANY (ARRAY['running','processing','waiting_response','paused']::text[])
                )
        )
  ORDER BY k.id
  LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200);
$function$;

REVOKE ALL ON FUNCTION public.find_leads_company_no_reply(uuid, uuid, timestamp with time zone, timestamp with time zone, uuid[], uuid, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.find_leads_company_no_reply(uuid, uuid, timestamp with time zone, timestamp with time zone, uuid[], uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.find_leads_company_no_reply(uuid, uuid, timestamp with time zone, timestamp with time zone, uuid[], uuid, integer) IS
  'Candidatos ao gatilho company_no_reply ("Cliente aguardando resposta"): leads cuja '
  'primeira mensagem sem resposta HUMANA da empresa está em (p_since, p_cutoff]. Resposta '
  'humana = chip manual, não-IA, enviada; canal oficial com sent_by_team_member_id. Devolve '
  'a chave da espera para trigger_dedup_key. Paginação por p_after (lead_id). service_role only.';

-- O índice que a sonda de dedup usa: (workflow_id, lead_id, trigger_dedup_key)
-- já existe (uq_workflow_exec_trigger_dedup). As sondas por lead/telefone usam
-- idx_whatsapp_msgs_org_lead e idx_whatsapp_messages_normalized_phone; a janela
-- de entrada usa idx_whatsapp_msgs_org_dir_ts. Nenhum índice novo.

NOTIFY pgrst, 'reload schema';

COMMIT;
