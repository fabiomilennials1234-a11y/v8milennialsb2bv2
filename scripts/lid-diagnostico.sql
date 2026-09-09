-- ============================================================================
-- LID gravado como telefone — DIAGNÓSTICO (somente leitura)
--
-- Sintoma (Café Jurerê, 2026-09-03): depois do "sincronizar histórico", o inbox
-- lista contatos cujo nome é um código de 14–18 dígitos (`210028246085780`).
-- Isso é um LID (`@lid`), o identificador opaco que o WhatsApp emite quando o
-- número do outro lado não é exposto à conta. Não é telefone: não casa com
-- `leads.normalized_phone` e duplica a conversa que já existe pelo número real.
--
-- Porta: `history-sync-worker` gravava `remote_jid`/`phone_number` crus,
-- filtrando só `@g.us`. Corrigido em `_shared/whatsapp-jid.ts`.
--
-- Este arquivo NÃO escreve nada. Serve para dimensionar o estrago e, sobretudo,
-- para responder a pergunta que decide o saneamento:
--   o payload guardado tem o telefone real (→ dá para CORRIGIR),
--   ou não tem (→ só dá para ESCONDER, preservando o dado)?
-- ============================================================================

-- ⚠️ `remote_jid LIKE '%@lid'` não usa índice. Na tabela inteira (~2,3M linhas)
--    a consulta estoura o timeout da Management API — medido em 2026-09-03.
--    Rode SEMPRE com recorte de org e de período, como no exemplo abaixo:
--       AND organization_id = '4922638c-4909-494e-ba10-12282ec0b161'
--       AND "timestamp" >= now() - interval '45 days'

-- 1) Volume por org: quantas mensagens e quantas "conversas" LID existem.
SELECT
  m.organization_id,
  o.name AS org,
  count(*)                                   AS msgs_lid,
  count(DISTINCT m.phone_number)             AS conversas_lid,
  min(m.timestamp)                           AS primeira,
  max(m.timestamp)                           AS ultima
FROM public.whatsapp_messages m
LEFT JOIN public.organizations o ON o.id = m.organization_id
WHERE m.remote_jid LIKE '%@lid'
GROUP BY 1, 2
ORDER BY msgs_lid DESC;

-- 2) Por qual porta entraram. Espera-se `history_sync`; qualquer outro valor
--    significa que existe uma SEGUNDA porta a corrigir antes de sanear.
SELECT received_via, count(*) AS msgs, count(DISTINCT phone_number) AS conversas
FROM public.whatsapp_messages
WHERE remote_jid LIKE '%@lid'
GROUP BY 1
ORDER BY msgs DESC;

-- 3) A pergunta que decide o saneamento: o telefone real está no payload?
--    Se `sender_pn`/`_phone_jid`/`chat_pn` aparecerem preenchidos, dá para
--    reescrever `phone_number` em vez de esconder a conversa.
SELECT
  count(*)                                                        AS msgs_lid,
  count(*) FILTER (WHERE raw_payload ? 'sender_pn')               AS tem_sender_pn,
  count(*) FILTER (WHERE raw_payload ? '_phone_jid')              AS tem_phone_jid,
  count(*) FILTER (WHERE raw_payload ? 'chat_pn')                 AS tem_chat_pn,
  count(*) FILTER (WHERE raw_payload ? 'senderPn')                AS tem_senderPn,
  count(*) FILTER (WHERE raw_payload ? 'participant_pn')          AS tem_participant_pn
FROM public.whatsapp_messages
WHERE remote_jid LIKE '%@lid';

-- 4) Que chaves esses payloads têm, afinal. O schema da Uazapi é
--    conhecido-instável — a lista real manda mais que a documentação.
SELECT k AS chave, count(*) AS ocorrencias
FROM public.whatsapp_messages m,
     LATERAL jsonb_object_keys(m.raw_payload) AS k
WHERE m.remote_jid LIKE '%@lid'
GROUP BY 1
ORDER BY ocorrencias DESC
LIMIT 60;

-- 5) Amostra dos campos de IDENTIDADE — nunca do payload inteiro.
--    O conteúdo da mensagem é do cliente e às vezes carrega credencial que ele
--    mesmo mandou pelo chat (visto em 2026-09-03). Diagnóstico de identificador
--    não precisa do texto, então o texto não sai daqui.
SELECT
  phone_number,
  direction,
  raw_payload ->> 'chatid'     AS p_chatid,
  raw_payload ->> 'sender'     AS p_sender,
  raw_payload ->> 'owner'      AS p_owner,
  raw_payload ->> 'senderName' AS p_sendername,
  raw_payload ->> 'source'     AS p_source
FROM public.whatsapp_messages
WHERE remote_jid LIKE '%@lid'
ORDER BY "timestamp" DESC
LIMIT 5;

-- Medido em 2026-09-03 (Café Jurerê): `sender` é o próprio LID no `incoming` e
-- o NOSSO número no `outgoing`. Ou seja, NÃO existe o telefone do contato no
-- payload — e usar `sender` como pista criaria conversa com a própria conta.

-- 6) Quantas linhas de inbox essas conversas produziram (é o que o usuário vê).
SELECT s.organization_id, o.name AS org, count(*) AS linhas_no_inbox
FROM public.whatsapp_conversation_summary s
LEFT JOIN public.organizations o ON o.id = s.organization_id
WHERE EXISTS (
  SELECT 1 FROM public.whatsapp_messages m
   WHERE m.organization_id = s.organization_id
     AND m.instance_id     = s.instance_id
     AND m.normalized_phone = s.normalized_phone
     AND m.remote_jid LIKE '%@lid'
)
GROUP BY 1, 2
ORDER BY linhas_no_inbox DESC;

-- 7) Essas conversas são duplicata de algo que já temos pelo número real?
--    Sem o telefone não há como casar diretamente; o que dá para medir é
--    quantas têm lead vinculado (esperado: nenhuma) e quantas trazem mensagem
--    NOSSA (`outgoing`) — sinal de que a conversa real existe em outra linha,
--    já que só disparamos para número, nunca para LID.
SELECT
  count(DISTINCT phone_number)                                          AS conversas_lid,
  count(DISTINCT phone_number) FILTER (WHERE lead_id IS NOT NULL)       AS com_lead,
  count(DISTINCT phone_number) FILTER (WHERE direction = 'outgoing')    AS com_msg_nossa
FROM public.whatsapp_messages
WHERE remote_jid LIKE '%@lid';
