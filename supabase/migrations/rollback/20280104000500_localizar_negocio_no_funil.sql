-- Rollback de 20280104000500_localizar_negocio_no_funil.sql
--
-- A função é ADITIVA: ninguém além do board ("Ir para o negócio") a chama.
-- Desligue a flag chat_ir_para_negocio ANTES: sem ela o chat não mostra o
-- botão e o board ignora ?negocio= (links já enviados também). Com a flag
-- ligada e sem a função, o board mostraria um aviso de erro a cada clique.

DROP FUNCTION IF EXISTS public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer);

NOTIFY pgrst, 'reload schema';
