-- ================================================================
-- Migration: Master Ghost RLS — varredura restante (35 tabelas)
-- Date: 2026-07-21
--
-- Complementa 20270721000000. Aquela migration cobriu 23 tabelas a
-- partir de uma auditoria com defeito: ela aceitava is_master_user
-- no WITH CHECK como prova de leitura. Nao e — policy de INSERT com
-- master no WITH CHECK nao concede SELECT nenhum.
--
-- Auditoria correta exige as duas coisas:
--   polcmd IN ('r','*')  AND  is_master_user no USING
--
-- Com o criterio certo eram 59 tabelas org-scoped sem SELECT de
-- master. 23 cobertas na anterior, 36 restantes. Esta migration
-- cobre 35 delas.
--
-- FORA DE ESCOPO — api_keys. Tabela de segredo; ghost master nao
-- recebe leitura de credencial. Mesma postura de
-- whatsapp_instance_secrets (deny-all, acesso so via RPC
-- service_role).
--
-- Impacto medido em prod nesta data: 14 das 36 tinham dados. O
-- cluster *_events (pipeline_stage_events 39k, field_changes 31k,
-- meeting_events 1221, sale_events 303, order_events 235) e o mais
-- critico — master cego neles nao produz tela vazia, produz METRICA
-- ERRADA, que nao se denuncia sozinha.
--
-- ESCOPO: somente SELECT. O ghost master le, nao escreve.
-- Escopo de org continua sendo feito pela query da aplicacao
-- (.eq organization_id), igual ao padrao de leads.
-- ================================================================

DO $$
DECLARE
  alvo text;
  alvos text[] := ARRAY[
    'activities',
    'ai_email_drafts',
    'approval_requests',
    'blast_instance_daily_usage',
    'call_logs',
    'companies',
    'competitor_mentions',
    'contacts',
    'copilot_v2_agents',
    'copilot_v2_config',
    'copilot_v2_knowledge',
    'copilot_v2_rubric',
    'copilot_v2_send_media',
    'copilot_v2_traces',
    'deal_contacts',
    'deal_insights',
    'deals',
    'emails',
    'enrichment_requests',
    'field_changes',
    'import_batches',
    'loss_reasons',
    'meeting_events',
    'meta_asset_bindings',
    'notas_fiscais',
    'order_events',
    'org_onboarding_progress',
    'pending_copilot_deliveries',
    'phone_ai_preferences',
    'pipeline_stage_events',
    'push_subscriptions',
    'sale_events',
    'saved_views',
    'sms_messages',
    'titulos_receber'
  ];
BEGIN
  FOREACH alvo IN ARRAY alvos LOOP
    EXECUTE format('DROP POLICY IF EXISTS master_select_all_%I ON public.%I', alvo, alvo);
    EXECUTE format(
      'CREATE POLICY master_select_all_%I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_master_user()))',
      alvo, alvo
    );
    EXECUTE format(
      'COMMENT ON POLICY master_select_all_%I ON public.%I IS %L',
      alvo, alvo,
      'Ghost master le esta tabela em qualquer org. Espelha master_select_all_leads. Escopo de org e feito pela query da app (.eq organization_id).'
    );
  END LOOP;
END $$;
