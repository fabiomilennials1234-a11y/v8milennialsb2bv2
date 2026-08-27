-- MEDIÇÃO #1722 — decisão C do CTO. SOMENTE LEITURA: cinco SELECTs, zero escrita.
--
-- A PERGUNTA
-- ==========
-- O worker do Canal Oficial (#1722) grava em `blast_plan_recipients.provider_message_id`
-- o id que `sendTemplateViaInstance` devolve — que é o id da RESPOSTA DO ENVIO, o mesmo
-- que o provider grava em `channel_messages.external_id`
-- (`notificame-provider.ts:1250-1272`, `buildOutboundChannelMessageRow:979-1003`).
--
-- Mas quem casa o callback de status é o `providerMessageId` ESTÁVEL — e a linha do
-- envio nasce com `provider_message_id` NULL: quem a preenche é o PRIMEIRO callback que
-- casar (`notificame-webhook/index.ts:1131-1174`).
--
-- Se o id estável NÃO for o id da resposta do envio, a #1724 casa o callback errado: a
-- entrega nunca fecha e o custo realizado nunca sobe.
--
-- COMO RODAR (prod, read-only):
--   node scripts/prod-sql.mjs --file scripts/medicao-1722-provider-message-id.sql

-- 1. O veredito. `pmid_diferente = 0` responde SIM: o id da resposta do envio É o
--    estável, e o worker pode gravá-lo direto.
SELECT
  '1_veredito'                                              AS medicao,
  count(*)                                                  AS linhas_saida_com_pmid,
  count(*) FILTER (WHERE provider_message_id = external_id)  AS pmid_igual_ao_external,
  count(*) FILTER (WHERE provider_message_id <> external_id) AS pmid_diferente,
  min(timestamp)                                            AS mais_antiga,
  max(timestamp)                                            AS mais_recente
FROM public.channel_messages
WHERE direction = 'outgoing'
  AND provider_message_id IS NOT NULL;

-- 2. CONTROLE CONTRA VERDE POR AUSÊNCIA. Se a medição 1 vier com zero linhas, ela não
--    diz "são iguais" — diz "não há dado". Este conta o universo.
SELECT
  '2_controle_universo'                                        AS medicao,
  count(*)                                                     AS saidas_totais,
  count(*) FILTER (WHERE provider_message_id IS NULL)           AS sem_pmid,
  count(*) FILTER (WHERE provider_message_id IS NOT NULL)       AS com_pmid,
  count(DISTINCT organization_id)                               AS orgs
FROM public.channel_messages
WHERE direction = 'outgoing';

-- 3. Amostra crua, para a resposta não depender só de um contador.
SELECT
  '3_amostra'          AS medicao,
  external_id,
  provider_message_id,
  (provider_message_id = external_id) AS iguais,
  message_type,
  status,
  timestamp
FROM public.channel_messages
WHERE direction = 'outgoing'
  AND provider_message_id IS NOT NULL
ORDER BY timestamp DESC
LIMIT 10;

-- 4. O caso que importa para o Disparo: TEMPLATE. É o único tipo que o worker manda, e
--    é o que a #1688/#1689 já produzem hoje pelo nó de Workflow.
SELECT
  '4_templates'                                              AS medicao,
  count(*)                                                   AS templates_enviados,
  count(*) FILTER (WHERE provider_message_id IS NOT NULL)     AS com_pmid,
  count(*) FILTER (WHERE provider_message_id = external_id)   AS pmid_igual_ao_external
FROM public.channel_messages
WHERE direction = 'outgoing'
  AND (message_type = 'template' OR metadata->>'tipo' = 'template');

-- 5. Callbacks estacionados por não casar. `status_no_match` alto é o sintoma de que o
--    casamento por id já falha HOJE — e seria a resposta mais cara possível chegando de
--    graça, antes de a #1724 ser escrita.
SELECT
  '5_callbacks_orfaos' AS medicao,
  reason,
  count(*)             AS eventos,
  max(received_at)     AS mais_recente
FROM public.notificame_webhook_events
WHERE reason IN ('status_no_match', 'unreadable_status')
GROUP BY reason
ORDER BY eventos DESC;
