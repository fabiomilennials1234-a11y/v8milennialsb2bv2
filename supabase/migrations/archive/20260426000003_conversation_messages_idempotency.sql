-- Onda 1 / T1.1.5 — Idempotency em conversation_messages
--
-- Telemetria 30d (2026-04-26): 209 pares de mensagens assistant duplicadas em
-- <60s afetando 56 conversas distintas. Causas múltiplas (race em
-- updateConversationState, retry de webhook, double-claim). UNIQUE constraint
-- elimina dups na origem independente de quem chama insert.
--
-- Key gerada pelo caller (agent-engine.ts addMessageToMemory) no formato
-- `${role}_${turn_count}_${sha1(content).slice(0,8)}`. NULL legacy preservado
-- (índice partial).

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_idempotency
  ON public.conversation_messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.conversation_messages.idempotency_key IS
  'Onda 1 T1.1.5: dedup key. Preenchido pelo caller (agent-engine).';
