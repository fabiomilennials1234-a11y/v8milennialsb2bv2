-- ROLLBACK de 20270806000000_restore_whatsapp_conversation.sql
--
-- A migration é ADITIVA: cria uma função nova e não altera nenhuma existente,
-- nenhuma tabela e nenhum dado. Desfazer é dropar a função.
--
-- ⚠️ Depois deste rollback, conversa excluída volta a não ter como ser
-- restaurada pela UI — o front chama esta RPC e passará a receber 42883
-- (function does not exist). Só rode se o front correspondente também sair.

DROP FUNCTION IF EXISTS public.restore_whatsapp_conversation(uuid);
