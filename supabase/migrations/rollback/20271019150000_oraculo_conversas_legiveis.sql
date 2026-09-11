DROP POLICY IF EXISTS conversation_summaries_scoped_read ON public.conversation_summaries;
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'summarize-conversations-batch') THEN
    PERFORM cron.unschedule('summarize-conversations-batch');
  END IF;
END
$cron$;
DROP FUNCTION IF EXISTS public.invoke_summarize_conversations_batch();
DROP FUNCTION IF EXISTS public.finish_conversation_summary_job(uuid,text);
DROP FUNCTION IF EXISTS public.claim_conversation_summary_jobs(integer);
DROP FUNCTION IF EXISTS public.oraculo_conversa_detalhe(uuid,uuid,uuid,uuid,integer);
DROP FUNCTION IF EXISTS public.oraculo_conversas(uuid,uuid,integer,integer);
DROP FUNCTION IF EXISTS public.oraculo_chat_scope_allows(uuid,uuid,uuid,uuid);
DROP TABLE IF EXISTS public.conversation_summary_jobs;
DROP INDEX IF EXISTS public.idx_conversation_summaries_instance_source;
DROP INDEX IF EXISTS public.idx_conversation_summaries_org_lead_instance;
DELETE FROM public.conversation_summaries
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY lead_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS position
    FROM public.conversation_summaries
  ) ranked
  WHERE position > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_summaries_lead_unique
  ON public.conversation_summaries (lead_id);
ALTER TABLE public.conversation_summaries DROP COLUMN IF EXISTS instance_id;
ALTER TABLE public.conversation_summaries DROP COLUMN IF EXISTS source_last_message_at;
