-- Rollback de 20270815104500_notificame_instagram_inbound.sql
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM DE ROLLBACK — FUNÇÕES PRIMEIRO, ESTE ARQUIVO DEPOIS.            ║
-- ║     (o INVERSO do apply, que é migration primeiro e funções depois)      ║
-- ║                                                                          ║
-- ║      1º  tirar `notificame-webhook` do ar (ou redeployar uma versão que  ║
-- ║          não conheça as colunas/tabela/RPC abaixo) E remover a           ║
-- ║          subscription no painel do NotificaMe, para o fornecedor PARAR   ║
-- ║          de entregar;                                                    ║
-- ║      2º  redeploy de `notificame-channel-finish` numa versão que não     ║
-- ║          registre subscription;                                          ║
-- ║      3º  este arquivo.                                                   ║
-- ║                                                                          ║
-- ║  Rodar isto com `notificame-webhook` no ar reintroduz a janela           ║
-- ║  schema-velho-sob-função-nova, e o desfecho dela NÃO é um 500 limpo:     ║
-- ║  o INSERT em `channel_messages` erra por coluna inexistente, a função    ║
-- ║  tenta PARKAR em `notificame_webhook_events` — que este arquivo acabou   ║
-- ║  de apagar —, o park erra também, e o corpo cru se perde. Cada evento    ║
-- ║  perdido nessa janela é um exemplar de um FORMATO QUE NINGUÉM VIU        ║
-- ║  AINDA. A lista completa está no cabeçalho do apply.                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ O PASSO 4 DESTRÓI DADO DE CONVERSA, E ELE NÃO EXISTE EM MAIS LUGAR NENHUM.
--
-- `DROP COLUMN contact_external_id` apaga a CHAVE DE AGRUPAMENTO de toda conversa
-- de Instagram: as linhas de `channel_messages` sobrevivem, mas viram mensagens
-- soltas sem interlocutor — `sender_id` NÃO reconstrói a thread (ele é quem
-- mandou, e numa mensagem de saída é a nossa conta; é exatamente o defeito de
-- `useMetaMessages`). `DROP COLUMN messaging_channel_id` apaga de qual canal cada
-- linha veio, que é o ÚNICO discriminador entre a rota NotificaMe e a rota
-- Meta/Graph. Depois deste arquivo as duas rotas ficam indistinguíveis dentro da
-- mesma tabela, e nenhum backfill as separa de novo.
--
-- ANOTE ANTES DE APAGAR, se houver QUALQUER linha social:
--
--   SELECT organization_id, messaging_channel_id, contact_external_id,
--          external_id, direction, "timestamp", content
--     FROM public.channel_messages
--    WHERE messaging_channel_id IS NOT NULL
--    ORDER BY "timestamp";
--
--   SELECT received_at, reason, status, organization_id, payload
--     FROM public.notificame_webhook_events
--    ORDER BY received_at;
--
-- ⚠️ A SEGUNDA query importa MAIS que a primeira. `notificame_webhook_events` é
-- onde chega o primeiro evento real — a única coisa que ensina o formato do
-- payload, que hoje é 100% derivado de doc. Apagar essa tabela com eventos
-- parkados dentro joga fora a evidência e o trabalho volta à estaca zero.
-- EXPORTE `payload` INTEIRO antes (`\copy ... TO`), não um resumo.
--
-- CAMINHO PREFERÍVEL a rodar isto: tirar `notificame-webhook` do ar e remover a
-- subscription no fornecedor, deixando colunas, tabela e RPC de pé. As três são
-- INERTES sem quem escreva — duas colunas NULL, uma tabela vazia e uma RPC sem
-- chamador não custam nada e não mudam comportamento de ninguém.
--
-- Se a fatia estiver INERTE (nenhum canal de Instagram conectado, nenhum evento
-- recebido — o estado em que ela é mergeada), este rollback é limpo.
--
-- ORDEM entre rollbacks da feature: este é o PRIMEIRO. Apply foi cofre …154500 →
-- fundação …154600 → instagram …093000 → inbound …104500; desfazer é o inverso.
-- Rodar o rollback de …093000 (`DROP TABLE messaging_channels`) ANTES deste
-- esbarra nas FKs criadas aqui — `channel_messages.messaging_channel_id` e
-- `notificame_webhook_events.messaging_channel_id` apontam para ela.

-- 1. A RPC da lista social. Nenhum outro objeto depende dela.
DROP FUNCTION IF EXISTS public.get_social_conversation_list(uuid, uuid, integer, timestamptz);

-- 2. A fila de eventos não-interpretados. LEIA O AVISO ACIMA ANTES.
DROP TABLE IF EXISTS public.notificame_webhook_events;

-- 3. O índice da thread social. (Redundante com o passo 4 — DROP COLUMN já o
--    levaria junto — mas explícito para que a ordem fique legível.)
DROP INDEX IF EXISTS public.idx_channel_messages_social_thread;

-- 4. As duas colunas. IRREVERSÍVEL sem o backup do aviso acima.
ALTER TABLE public.channel_messages
  DROP COLUMN IF EXISTS contact_external_id;

ALTER TABLE public.channel_messages
  DROP COLUMN IF EXISTS messaging_channel_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. O GRANT do bloco 7 do apply — NÃO É RESTAURADO AQUI, E ISSO É DECISÃO.
--
--    O apply revogou de `authenticated` tudo menos SELECT em `channel_messages`.
--    Devolver o `GRANT ALL` do baseline REABRE o furo: a policy
--    `channel_messages_org_access` é FOR ALL sem WITH CHECK explícito, então um
--    MEMBRO comum da org volta a poder INSERIR linha em `channel_messages` pelo
--    PostgREST, com o organization_id dele.
--
--    Esse furo NÃO foi criado pela fatia 2-IG e não é desfeito por reverter a
--    fatia 2-IG: ele existe no baseline desde sempre e é ORTOGONAL a tudo o que
--    esta migration entrega. O que a fatia mudou foi a CONSEQUÊNCIA dele (a tabela
--    passa a ser renderizada), não a existência. Reverter o schema não devolve a
--    razão para reabrir a porta.
--
--    Nenhum caminho legítimo perde nada com o revoke em pé: todo writer de
--    `channel_messages` é service_role (lista verificada no bloco 7 do apply), e
--    em `src/` não existe UM escritor.
--
--    Se ainda assim for preciso restaurar o estado exato do baseline — e é um ATO
--    DELIBERADO, não parte do rollback —, é esta linha, e ela reabre o furo:
--
--      -- GRANT ALL ON public.channel_messages TO authenticated;
-- ─────────────────────────────────────────────────────────────────────────────
