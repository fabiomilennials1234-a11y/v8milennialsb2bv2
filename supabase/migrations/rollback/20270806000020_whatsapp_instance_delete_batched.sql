-- Rollback de 20270806000020_whatsapp_instance_delete_batched.sql
--
-- Reverter derruba a RPC de exclusão em lotes; o whatsapp-api-proxy volta a
-- precisar do caminho antigo (pré-nulificação direta), que estoura o
-- statement_timeout em instância com histórico grande. Só reverter junto com
-- o redeploy da versão anterior do edge function.

DROP FUNCTION IF EXISTS public.whatsapp_instance_delete_step(uuid, uuid, integer);

-- Os índices abaixo são aditivos e não quebram nada se ficarem. Dropar só se o
-- rollback precisar ser bit a bit.
DROP INDEX IF EXISTS public.idx_scheduled_pipe_messages_wa_instance;
DROP INDEX IF EXISTS public.idx_scheduled_campaign_messages_wa_instance;
DROP INDEX IF EXISTS public.idx_scheduled_user_messages_wa_instance;
DROP INDEX IF EXISTS public.idx_team_members_preferred_wa_instance;
DROP INDEX IF EXISTS public.idx_blast_plan_recipients_instance;
DROP INDEX IF EXISTS public.idx_blast_plans_instance;
DROP INDEX IF EXISTS public.idx_whatsapp_webhook_dlq_resolved_instance;
DROP INDEX IF EXISTS public.idx_uazapi_sender_jobs_instance;
DROP INDEX IF EXISTS public.idx_voip_call_usage_wa_instance;
DROP INDEX IF EXISTS public.idx_pipe_dispatch_rules_wa_instance;
DROP INDEX IF EXISTS public.idx_pending_copilot_deliveries_instance;
DROP INDEX IF EXISTS public.idx_whatsapp_rate_tracking_instance;
