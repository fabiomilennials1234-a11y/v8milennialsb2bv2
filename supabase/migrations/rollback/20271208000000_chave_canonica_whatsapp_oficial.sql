-- Rollback de 20271208000000_chave_canonica_whatsapp_oficial.sql
--
-- Remove só a função gêmea. A reescrita de dados NÃO é desfeita, de propósito:
-- voltar a chave para 12 dígitos é recriar a conversa partida que a migration
-- conserta. O valor antigo das linhas de ENTRADA continua em `sender_id` (wa_id
-- cru da Meta) e em `raw_payload`; se um dia for preciso, a reconstrução é
--   UPDATE channel_messages SET contact_external_id = sender_id, phone_number = sender_id
--    WHERE direction = 'incoming' AND sender_id IS NOT NULL AND ... (escopo notificame)
-- As linhas de SAÍDA já nasciam com 13 dígitos (telefone do lead).

DROP FUNCTION IF EXISTS public.canonical_br_whatsapp_id(text);
