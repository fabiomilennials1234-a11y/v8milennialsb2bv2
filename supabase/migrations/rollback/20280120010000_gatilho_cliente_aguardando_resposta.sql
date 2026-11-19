-- rollback/20280120010000_gatilho_cliente_aguardando_resposta.sql
--
-- Remove a RPC do gatilho "Cliente aguardando resposta" (company_no_reply).
--
-- Efeito: workflows ativos com trigger_type='company_no_reply' param de
-- disparar — o cron chama a RPC, recebe erro e segue para os outros gatilhos
-- (o erro é logado, não derruba o lote). Execuções já criadas não são tocadas.
-- Reverter a edge function `process-workflow-executions` junto é opcional.

BEGIN;

DROP FUNCTION IF EXISTS public.find_leads_company_no_reply(
  uuid, uuid, timestamp with time zone, timestamp with time zone, uuid[], uuid, integer
);

NOTIFY pgrst, 'reload schema';

COMMIT;
