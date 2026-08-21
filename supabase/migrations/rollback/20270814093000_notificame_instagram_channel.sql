-- Rollback de 20270814093000_notificame_instagram_channel.sql
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM DE ROLLBACK — FUNÇÕES PRIMEIRO, ESTE ARQUIVO DEPOIS.            ║
-- ║     (o INVERSO do apply, que é migration primeiro e funções depois)      ║
-- ║                                                                          ║
-- ║      1º  redeploy de `notificame-channel-start` e                        ║
-- ║          `notificame-channel-finish` na versão da FATIA 1;               ║
-- ║      2º  este arquivo.                                                   ║
-- ║                                                                          ║
-- ║  Rodar isto com as funções da 1.1 no ar tira o chão delas: elas leem     ║
-- ║  `notificame_connect_sessions.requested_channel_type` e                  ║
-- ║  `messaging_channels`, e objeto ausente no PostgREST devolve ERRO.       ║
-- ║  Desfecho: 403 `session_invalid` / 500 `claimed_lookup_failed` em TODA   ║
-- ║  conexão de WhatsApp — inclusive as que funcionam hoje —, e cada         ║
-- ║  tentativa deixa no NotificaMe um canal FATURÁVEL e IRREMOVÍVEL          ║
-- ║  vinculado a ninguém. A lista completa está no cabeçalho do apply.       ║
-- ║                                                                          ║
-- ║  `_shared/notificame-schema-guard.ts` amortece esse estado, mas é rede   ║
-- ║  para quem cai, não permissão para pular: com o schema revertido o       ║
-- ║  Instagram não funciona de todo modo.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ⚠️ O PASSO 1 DESTRÓI DADO, E O DADO NÃO EXISTE SÓ AQUI.
--
-- `DROP TABLE messaging_channels` apaga o vínculo org↔canal de Instagram. O canal
-- em si CONTINUA VIVO no NotificaMe: este arquivo não fala com o fornecedor, o
-- canal é FATURÁVEL e IRREMOVÍVEL do lado deles, e nenhum reaper deste repo
-- alcança canal social. Resultado de rodar isto com canal conectado: canal órfão
-- cobrado para sempre, sem trilha de quem o gerou — exatamente o padrão que
-- produziu as 87 órfãs na Uazapi.
--
-- ANOTE ANTES DE APAGAR, e remova o canal À MÃO no painel do NotificaMe:
--
--   SELECT organization_id, channel_type, external_channel_id, display_name
--     FROM public.messaging_channels;
--
-- CAMINHO PREFERÍVEL a rodar isto com canal vivo: desligar a flag (passo 3
-- isolado) e deixar tabela e coluna de pé. As duas são inertes sem quem escreva.
--
-- Se a fatia estiver INERTE (nenhum canal de Instagram conectado — o estado em que
-- ela é mergeada), este rollback é limpo.
--
-- ORDEM entre rollbacks da feature: este é o PRIMEIRO (apply foi cofre …154500 →
-- fundação …154600 → instagram …093000; desfazer é o inverso). Rodar o rollback do
-- cofre antes deste esbarra no `ON DELETE RESTRICT` de `subaccount_id`.

-- 1. A tabela dos canais sociais.
DROP TABLE IF EXISTS public.messaging_channels;

-- 2. O discriminante de tipo na sessão. As sessões abertas voltam ao
--    comportamento sem filtro (conservador: dois candidatos = ambiguous_channel).
ALTER TABLE public.notificame_connect_sessions
  DROP CONSTRAINT IF EXISTS chk_notificame_session_requested_channel_type;

ALTER TABLE public.notificame_connect_sessions
  DROP COLUMN IF EXISTS requested_channel_type;

-- 3. Porta de entrada. `-` remove a chave; as demais flags da org sobrevivem —
--    inclusive `notificame`, que é da fatia 1 e NÃO se desliga aqui.
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) - 'notificame_instagram'
 WHERE feature_flags ? 'notificame_instagram';
