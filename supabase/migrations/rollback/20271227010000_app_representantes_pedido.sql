-- Rollback de 20271227010000_app_representantes_pedido.sql. Exportar as tabelas afetadas antes de executar.
-- ATENÇÃO: não apaga os Negócios já criados por pedidos.
BEGIN;
DROP FUNCTION IF EXISTS public.mobile_order_create(uuid, uuid, jsonb, text, text, uuid);
DROP FUNCTION IF EXISTS public.mobile_op_finish(uuid, uuid);
DROP FUNCTION IF EXISTS public.mobile_op_begin(uuid, text, text);
DELETE FROM public.mobile_op_log WHERE kind = 'order';
ALTER TABLE public.mobile_op_log DROP COLUMN IF EXISTS request_hash;
ALTER TABLE public.mobile_op_log DROP COLUMN IF EXISTS kind;
ALTER TABLE public.mobile_op_log ALTER COLUMN entity_id SET NOT NULL;
COMMIT;
