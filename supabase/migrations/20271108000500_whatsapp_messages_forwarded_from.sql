-- 20271108000500_whatsapp_messages_forwarded_from.sql
--
-- Encaminhar mensagem no chat (Chamado 6dfcae6d, item 4). A mensagem
-- encaminhada sai com o rótulo nativo "Encaminhada" do WhatsApp (`forward: true`
-- na Uazapi), mas o rótulo vive no aparelho do cliente: o Torque precisa da
-- própria evidência para mostrar no balão e para responder "de onde veio isto".
--
-- `forwarded_from_message_id` aponta para `whatsapp_messages.id` da ORIGEM.
-- Quem encaminhou já está em `sent_by_team_member_id` (o proxy manda o
-- `track_id` do composer e o webhook grava a autoria no eco).
--
-- SEM FOREIGN KEY, de propósito. `whatsapp_messages` tem ~3 M linhas; uma FK
-- autorreferente pediria índice na coluna para o ON DELETE não varrer a tabela
-- a cada exclusão, e `CREATE INDEX` sem CONCURRENTLY trava escrita do webhook
-- (CONCURRENTLY não roda dentro da transação da migration). A exclusão de
-- mensagem no produto é lógica (`deleted_at`), então a origem não some; se um
-- dia sumir por limpeza física, o balão continua dizendo "Encaminhada" — que
-- segue verdadeiro.
--
-- SÓ DDL: nullable, sem default — só catálogo, sem rewrite.
--
-- ORDEM DE DEPLOY:
--   1) esta migration;
--   2) edge function `whatsapp-api-proxy`
--      (`--import-map supabase/functions/deno.json`);
--   3) frontend. Ele faz SELECT de `forwarded_from_message_id`: sem a coluna o
--      PostgREST devolve 400 e a thread do chat fica vazia em TODAS as orgs.
--
-- Idempotente: IF NOT EXISTS.
-- Rollback: supabase/migrations/rollback/20271108000500_whatsapp_messages_forwarded_from.sql

BEGIN;

-- Curto: se houver fila no lock da tabela, falha rápido em vez de enfileirar
-- o tráfego do chat atrás do ALTER. Basta rodar de novo.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id uuid;

COMMENT ON COLUMN public.whatsapp_messages.forwarded_from_message_id IS
  'Mensagem encaminhada pelo Torque: id (whatsapp_messages.id) da mensagem de '
  'origem. Gravado pelo whatsapp-api-proxy (action forwardMessage). Sem FK: '
  'referência lógica. NULL = não é encaminhamento feito pelo Torque.';

COMMIT;
