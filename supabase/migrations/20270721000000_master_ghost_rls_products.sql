-- ================================================================
-- Migration: Master Ghost RLS — varredura das tabelas org-scoped
-- Date: 2026-07-21
--
-- BUG: master em modo shadow (sem team_members ativo na org) via 0
-- produtos. /produtos mostrava "Nenhum produto cadastrado" e todo
-- combobox de produto (orcamento, proposta, pedido, deal, aba do
-- lead) vinha vazio. Relatado pela conta milennialswebservices
-- ("Leonardo ADMIN"): master + team_members.is_active = false.
--
-- CAUSA: essas tabelas so tinham policy escopada por
-- get_my_organization_ids(), que resolve via team_members ativo
-- (+ gestor). Master shadow nao tem linha ativa, logo o set vem
-- vazio e a policy nunca casa. leads/product_variants/
-- product_materials ja tinham o par master; 23 tabelas ficaram sem.
--
-- Segue o padrao de master_select_all_leads: policy PERMISSIVE
-- separada, USING (SELECT is_master_user()). O SELECT envolvendo a
-- funcao mantem o initplan cacheado por statement (nao reavalia por
-- linha).
--
-- ESCOPO: somente SELECT. O ghost master le, nao escreve. Write
-- continua exigindo vinculo real de org.
--
-- NAO INCLUI tabelas de segredo (ex.: whatsapp_instance_secrets,
-- deny-all por design, acesso so via RPC service_role). Verificado:
-- omie_connections guarda cursors/status, nenhuma credencial.
-- ================================================================

DO $$
DECLARE
  alvo text;
  alvos text[] := ARRAY[
    'products',
    'approval_rules',
    'client_alerts',
    'client_health_snapshots',
    'client_purchase_items',
    'competitors',
    'consent_records',
    'copilot_followup_step_log',
    'dashboards',
    'deal_items',
    'email_templates',
    'omie_connections',
    'outbound_dispatch_log',
    'quotes',
    'report_schedules',
    'reports',
    'retention_suggestions',
    'sla_configs',
    'sms_templates',
    'system_alerts',
    'webhook_dead_letters',
    'workflow_round_robin_state',
    'workflow_templates'
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
      'Ghost master le esta tabela em qualquer org. Espelha master_select_all_leads. Sem isso o master em shadow ve a tabela vazia.'
    );
  END LOOP;
END $$;
