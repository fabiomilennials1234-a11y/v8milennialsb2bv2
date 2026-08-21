-- ============================================================================
-- `channel_messages.provider_message_id` — a chave de correlação dos callbacks
--
-- O NotificaMe emite um `messageId` NOVO A CADA EVENTO de status. Medido em
-- produção em 2026-08-19, na mesma mensagem, com 376 ms de diferença:
--
--   SENT   messageId=5f6cbedf-…  providerMessageId=U2hTM01ZaXNN…
--   ERROR  messageId=403807e5-…  providerMessageId=U2hTM01ZaXNN…   ← idêntico
--
-- `external_id` guarda o id devolvido no ENVIO, que casa com o do `SENT` e NÃO
-- com o do `ERROR`. Resultado: a recusa da Meta (`131053 Media upload error`)
-- não achava a linha, era guardada como `status_no_match`, e o áudio seguia
-- exibido como "enviado" na tela. Duas vezes, com dois arquivos diferentes.
--
-- POR QUE COLUNA, E NÃO UM CAMPO DENTRO DE `raw_payload`:
--   1. é CHAVE DE BUSCA, não anotação — o segundo callback procura por ela, e
--      procurar dentro de jsonb custa um índice de expressão para o mesmo fim;
--   2. `raw_payload` é o corpo cru do fornecedor; misturar dado nosso de
--      correlação ali confunde evidência com índice;
--   3. o valor vem de um evento e é lido por outro: precisa sobreviver a um
--      UPDATE parcial sem depender de merge de jsonb.
--
-- NULA em toda linha existente, e assim permanece para o que já passou: o valor
-- só é conhecido quando o primeiro callback de status chega.
-- ============================================================================

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text;

COMMENT ON COLUMN public.channel_messages.provider_message_id IS
  'Id da mensagem no lado do fornecedor/Meta. É a ÚNICA chave estável entre callbacks de status: o `messageId` do evento muda a cada callback (medido 2026-08-19), enquanto este permanece. Gravado pelo primeiro evento de status que casar por external_id, e usado pelos seguintes para achar a linha.';

-- Parcial porque só linha de SAÍDA que já recebeu callback tem valor — hoje uma
-- fração ínfima da tabela. A org entra no índice porque toda busca é por tenant.
CREATE INDEX IF NOT EXISTS idx_channel_messages_provider_message_id
  ON public.channel_messages (organization_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
