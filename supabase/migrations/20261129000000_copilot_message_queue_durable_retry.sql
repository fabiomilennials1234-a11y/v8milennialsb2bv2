-- copilot_message_queue — realinhamento ao modelo atual + durabilidade/retry.
--
-- Contexto (RC 2026-06-24): a fila era 100% morta. O insert sempre falhava por:
--   1. message_id FK -> channel_messages(id), mas o fluxo inbound atual escreve
--      SÓ whatsapp_messages; channel_messages é arquitetura morta nesse caminho.
--   2. conversation_id NOT NULL, mas cold-start (lead novo) não tem conversa ainda.
-- Com a fila morta, toda resposta da IA caía no fallback floating-promise do
-- whatsapp-webhook (sem EdgeRuntime.waitUntil) → ~3.6% das respostas eram
-- geradas mas nunca enviadas ("IA não volta a responder").
--
-- A tabela está VAZIA em prod (insert nunca funcionou) → alteração é segura.
-- Política de retry/backoff/reclaim vive em _shared/copilot/queue-policy.ts
-- (testada por unidade); aqui só o schema que ela persiste.

BEGIN;

-- 1. conversation_id passa a ser opcional (cold-start não tem conversa).
ALTER TABLE public.copilot_message_queue
  ALTER COLUMN conversation_id DROP NOT NULL;

-- 2. message_id aponta para a mensagem ENTRANTE real (whatsapp_messages.id, uuid),
--    fonte de conteúdo do worker. Remove o FK órfão para channel_messages.
ALTER TABLE public.copilot_message_queue
  DROP CONSTRAINT IF EXISTS copilot_message_queue_message_id_fkey;

ALTER TABLE public.copilot_message_queue
  ADD CONSTRAINT copilot_message_queue_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE;

-- 3. Colunas de durabilidade/retry consumidas por queue-policy.ts.
ALTER TABLE public.copilot_message_queue
  ADD COLUMN IF NOT EXISTS attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error      text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at      timestamptz;

-- 4. Índice do sweep de retry: pendentes cujo backoff já venceu.
--    (next_attempt_at NULL = elegível imediato; coalesce para o passado.)
CREATE INDEX IF NOT EXISTS idx_copilot_message_queue_retry
  ON public.copilot_message_queue (coalesce(next_attempt_at, '-infinity'::timestamptz))
  WHERE status = 'pending';

-- 5. Índice de reclaim: processing preso (worker morto) detectado por claimed_at.
CREATE INDEX IF NOT EXISTS idx_copilot_message_queue_reclaim
  ON public.copilot_message_queue (claimed_at)
  WHERE status = 'processing';

COMMIT;
