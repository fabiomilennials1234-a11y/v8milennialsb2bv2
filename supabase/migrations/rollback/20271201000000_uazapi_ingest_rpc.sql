-- ROLLBACK de 20271201000000_uazapi_ingest_rpc.sql
-- Antes: esvazie UAZAPI_INGEST_RPC_ORGS na edge (whatsapp-webhook) e espere o
-- deploy. Com a flag vazia nada chama estas funções; o caminho antigo
-- (ingress + upsert + select + receive / update + lookup) volta sozinho.

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.ingest_uazapi_message(uuid, jsonb, jsonb, text, text[]);
DROP FUNCTION IF EXISTS public.apply_uazapi_receipt(uuid, text[], text, text[]);

COMMIT;
