-- 20270206000000_revoke_anon_execute_tier_a.sql
--
-- Fase 3 segurança (Dossiê DB). Revoga EXECUTE de `anon` em 75 funções SECURITY
-- DEFINER "Tier A" — triggers + dispatchers de pg_cron. Reduz superfície:
-- definer bypassa RLS; anon nunca deve poder invocá-las.
--
-- Tier A = NUNCA chamável via PostgREST API: trigger functions rodam como owner
-- em evento de tabela; invoke_*/enqueue_*/trigger_* dispatchers rodam por
-- pg_cron como postgres. Verificação dupla (2026-07-08):
--   1) Workflow 4 agentes: grep src/ + supabase/functions/ → 0 caller anon/público.
--   2) SQL cross-check contra pg_policies: NENHUMA das 75 é referenciada em RLS
--      policy (revogar não quebra avaliação de policy). As 25 RLS-helpers ficam.
-- Chamada definer-aninhada roda como o owner (postgres), não anon → cadeias
-- internas intactas.
--
-- IMPORTANTE (ACL): anon tem EXECUTE via `GRANT ... TO PUBLIC` (default Postgres:
-- proacl `=X/postgres`), NÃO via grant explícito a anon. Logo `REVOKE FROM anon`
-- é no-op — precisa `REVOKE FROM PUBLIC`. authenticated e service_role têm grant
-- EXPLÍCITO (`authenticated=X`, `service_role=X`) → mantêm EXECUTE após o revoke.
-- Só anon (e roles futuros sem grant) perde. postgres (owner) sempre mantém.
-- APLICADO EM PROD via execute_sql (autorização CTO) + registrado schema_migrations.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'check_sla_breaches','enforce_ai_state_transition','enforce_copilot_agent_limit','enforce_seat_limit','enforce_whatsapp_instance_limit',
      'enqueue_acoes_do_dia_webhooks','enqueue_campaign_dispatch_webhooks','enqueue_follow_ups_webhooks','enqueue_pipe_confirmacao_webhooks','enqueue_pipe_propostas_webhooks',
      'enqueue_pipe_whatsapp_webhooks','enqueue_whatsapp_messages_webhooks','fn_capture_meeting_event','fn_capture_pipeline_stage_event','fn_capture_sale_event',
      'fn_log_pipeline_stage_change_history','fn_pipeline_stage_events_block_mutation','fn_sale_events_block_mutation','invoke_blast_plan_release','invoke_calculate_portfolio_health',
      'invoke_campaign_rule_dispatch','invoke_copilot_v2_worker','invoke_cron_health_check','invoke_followup_reclassify','invoke_history_sync_worker',
      'invoke_mass_send_status','invoke_meta_conversion_dispatch','invoke_meta_leadgen_poll','invoke_pipe_rule_dispatch','invoke_process_ai_actions',
      'invoke_process_copilot_followups','invoke_process_followup_automations','invoke_process_followup_situations','invoke_process_outbound_dispatches','invoke_process_scheduled_user_messages',
      'invoke_process_webhook_deliveries','invoke_process_workflow_executions','invoke_refresh_meta_tokens','invoke_retry_dead_letter_jobs','invoke_whatsapp_dlq_replay',
      'invoke_whatsapp_health_monitor','invoke_whatsapp_media_retry','invoke_whatsapp_session_watchdog','invoke_workflow_cron_triggers','log_lead_deletion',
      'metric_stage_role','notify_copilot_batch_processor','queue_followup_reclassify','recalc_upsell_client_metrics','resolve_message_lead_id',
      'set_pending_payment_on_signup','sweep_copilot_queue','tg_whatsapp_conversation_summary','trg_upsell_order_recalc_metrics','trigger_campanha_leads_dispatch_rules',
      'trigger_google_calendar_sync','trigger_pipe_distribution','trigger_workflow_campaign_completed','trigger_workflow_campaign_lead_no_reply','trigger_workflow_campaign_lead_replied',
      'trigger_workflow_campaign_status','trigger_workflow_custom_pipe_entry','trigger_workflow_custom_pipe_stage_change','trigger_workflow_field_changed','trigger_workflow_lead_added_to_campaign',
      'trigger_workflow_lead_assigned','trigger_workflow_lead_created','trigger_workflow_lead_removed_from_campaign','trigger_workflow_meeting_confirmed','trigger_workflow_pipeline_stage_changed',
      'trigger_workflow_proposal_result','trigger_workflow_score_reached','trigger_workflow_tag_added','update_updated_at','validate_copilot_move_rules'
    ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Restaura o grant PUBLIC (mesmo loop):
--   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.sig);
