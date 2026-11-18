-- Desfaz o MOTOR de distribuição regional da JR Tex (PR #2512, migrations
-- 20280112002000/003000/004000/005000). A regra "CNPJ + cidade + UF antes de
-- encaminhar" vivia em triggers do banco e bloqueava a troca manual de
-- responsável (SQLSTATE 23514) para qualquer usuário. Atribuição é regra de
-- automação e pertence ao workflow, não ao schema.
--
-- REMOVE: 8 triggers (leads, pipeline_entries, lead_owners, whatsapp_messages,
--         lead_custom_field_values), o cron 'regional-sales-distribution' e as
--         18 funções do motor.
-- MANTÉM: relatórios (regional_reports_allowed, regional_sales_metric e o painel),
--         a tabela regional_sales_config, e as tabelas regional_sales_state/
--         routes/cities/assignment_log como dados inertes (rotas e histórico
--         não se perdem; o workflow pode reaproveitá-los).
-- NÃO DESFAZ: responsáveis já trocados pelo motor nem as follow_ups que ele criou.
-- Sem CASCADE de propósito: dependência inesperada aborta a transação.
-- Reversão: supabase/migrations/rollback/20280118000000_desfaz_distribuicao_regional_jrtex.sql

SET LOCAL lock_timeout = '3s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'regional-sales-distribution';

DROP TRIGGER IF EXISTS regional_assignment_guard        ON public.leads;
DROP TRIGGER IF EXISTS regional_owner_clock             ON public.leads;
DROP TRIGGER IF EXISTS regional_entry_assignment_guard  ON public.pipeline_entries;
DROP TRIGGER IF EXISTS regional_entry_created           ON public.pipeline_entries;
DROP TRIGGER IF EXISTS regional_coowner_guard           ON public.lead_owners;
DROP TRIGGER IF EXISTS regional_custom_field_changed    ON public.lead_custom_field_values;
DROP TRIGGER IF EXISTS regional_capture_contact         ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS regional_message_sla             ON public.whatsapp_messages;

DROP FUNCTION IF EXISTS private.process_regional_sales();
DROP FUNCTION IF EXISTS private.regional_assign(uuid, boolean, timestamptz);
DROP FUNCTION IF EXISTS private.regional_assignment_guard();
DROP FUNCTION IF EXISTS private.regional_capture_contact();
DROP FUNCTION IF EXISTS private.regional_coowner_guard();
DROP FUNCTION IF EXISTS private.regional_custom_field_changed();
DROP FUNCTION IF EXISTS private.regional_entry_assignment_guard();
DROP FUNCTION IF EXISTS private.regional_entry_created();
DROP FUNCTION IF EXISTS private.regional_message_sla();
DROP FUNCTION IF EXISTS private.regional_owner_clock();
DROP FUNCTION IF EXISTS private.regional_pending_task(uuid, uuid, text);
DROP FUNCTION IF EXISTS private.regional_set_owner(uuid, uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS private.regional_status(uuid, uuid, text);
DROP FUNCTION IF EXISTS private.regional_validate_handoff(uuid, uuid, uuid[], uuid[], boolean);
DROP FUNCTION IF EXISTS private.regional_contact_data(uuid);
DROP FUNCTION IF EXISTS private.regional_work_minutes(timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS private.regional_valid_cnpj(text);
DROP FUNCTION IF EXISTS private.regional_normalize(text);
