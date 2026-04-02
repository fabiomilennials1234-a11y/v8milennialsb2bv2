-- ================================================================
-- Migration: Ghost Master
-- Masters ficam invisíveis nas orgs + acesso total via RLS
-- Date: 2026-04-01
-- ================================================================

-- ============================================
-- PARTE 1: View org_visible_members
-- Exclui master users das listagens de equipe.
-- Usa security_invoker para respeitar RLS do team_members.
-- ============================================

CREATE OR REPLACE VIEW public.org_visible_members
WITH (security_invoker = true) AS
SELECT tm.*
FROM public.team_members tm
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_users mu
  WHERE mu.user_id = tm.user_id
  AND mu.is_active = true
);

COMMENT ON VIEW public.org_visible_members IS
  'View de team_members que exclui master users. Usar para listagens de equipe e métricas.';

GRANT SELECT ON public.org_visible_members TO authenticated, service_role;


-- ============================================
-- PARTE 2: Fix org_get_seat_usage
-- Exclui masters da contagem de seats ativos.
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_paid_seats   INTEGER;
  v_active_count INTEGER;
  v_plan_limit   INTEGER;
  v_plan_name    TEXT;
BEGIN
  -- Seats pagos via org_subscriptions
  SELECT os.user_count, sp.name
  INTO v_paid_seats, v_plan_name
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  -- Se não tem subscription, tenta pegar do plano da org (legacy)
  IF v_paid_seats IS NULL THEN
    SELECT
      COALESCE(
        (o.limit_overrides->>'max_users')::INTEGER,
        (sp.limits->>'max_users')::INTEGER,
        2 -- fallback
      ),
      COALESCE(sp.name, o.subscription_plan, 'free')
    INTO v_plan_limit, v_plan_name
    FROM public.organizations o
    LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id;

    v_paid_seats := v_plan_limit;
  END IF;

  -- Membros ativos na org (EXCLUINDO masters)
  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.team_members
  WHERE organization_id = p_org_id
    AND is_active = true
    AND NOT public.is_master_user(user_id);

  RETURN jsonb_build_object(
    'paid_seats',    COALESCE(v_paid_seats, 0),
    'active_members', v_active_count,
    'plan_name',     COALESCE(v_plan_name, 'unknown'),
    'is_unlimited',  COALESCE(v_paid_seats, 0) = -1,
    'can_add',       COALESCE(v_paid_seats, 0) = -1 OR v_active_count < COALESCE(v_paid_seats, 0),
    'remaining',     CASE
                       WHEN COALESCE(v_paid_seats, 0) = -1 THEN -1
                       ELSE GREATEST(COALESCE(v_paid_seats, 0) - v_active_count, 0)
                     END
  );
END;
$$;


-- ============================================
-- PARTE 3: Fix enforce_seat_limit
-- Masters fazem bypass do limite de seats.
-- ============================================

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage JSONB;
BEGIN
  -- Masters nunca são bloqueados pelo limite de seats
  IF public.is_master_user(NEW.user_id) THEN
    RETURN NEW;
  END IF;

  -- Só checa quando ativando um membro (is_active false → true) ou criando ativo
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false)) THEN
    -- Lock na org para serializar ativações concorrentes
    PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;

    v_usage := public.org_get_seat_usage(NEW.organization_id);

    IF NOT (v_usage->>'is_unlimited')::BOOLEAN
       AND (v_usage->>'active_members')::INTEGER >= (v_usage->>'paid_seats')::INTEGER
    THEN
      RAISE EXCEPTION 'Limite de seats atingido. Seats pagos: %, membros ativos: %.',
        (v_usage->>'paid_seats')::INTEGER,
        (v_usage->>'active_members')::INTEGER
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================
-- PARTE 4: Fix get_segment_benchmark
-- team_size exclui masters da contagem.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_segment_benchmark(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_segment TEXT; v_org_count BIGINT; result JSONB;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  v_start := DATE_TRUNC('month', NOW());
  v_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second');
  SELECT l.segment INTO v_segment FROM leads l WHERE l.organization_id = p_org_id AND l.segment IS NOT NULL AND l.segment != '' GROUP BY l.segment ORDER BY COUNT(*) DESC LIMIT 1;
  IF v_segment IS NULL THEN RETURN jsonb_build_object('available', false, 'reason', 'no_segment_data'); END IF;
  SELECT COUNT(DISTINCT o.id) INTO v_org_count FROM organizations o JOIN leads l ON l.organization_id = o.id WHERE l.segment = v_segment AND o.id != p_org_id;
  IF v_org_count < 2 THEN RETURN jsonb_build_object('available', false, 'reason', 'insufficient_peers', 'segment', v_segment); END IF;
  WITH peer_orgs AS (
    SELECT DISTINCT o.id AS org_id FROM organizations o JOIN leads l ON l.organization_id = o.id WHERE l.segment = v_segment AND o.id != p_org_id
  ), peer_metrics AS (
    SELECT po.org_id,
      (SELECT COUNT(*) FROM leads l WHERE l.organization_id = po.org_id AND COALESCE(l.metrics_period_at, l.created_at) >= v_start AND COALESCE(l.metrics_period_at, l.created_at) <= v_end) AS leads,
      (SELECT COUNT(*) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id AND pp.status = 'vendido' AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS vendas,
      (SELECT COALESCE(SUM(pp.sale_value), 0) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id AND pp.status = 'vendido' AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS revenue,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.organization_id = po.org_id AND tm.is_active = true AND NOT public.is_master_user(tm.user_id)) AS team_size
    FROM peer_orgs po
  )
  SELECT jsonb_build_object('available', true, 'segment', v_segment, 'peerCount', v_org_count,
    'avgTicketMedio', CASE WHEN SUM(vendas) > 0 THEN ROUND(SUM(revenue) / SUM(vendas), 2) ELSE 0 END,
    'avgLeadsPerSeller', CASE WHEN SUM(team_size) > 0 THEN ROUND(SUM(leads)::NUMERIC / SUM(team_size), 1) ELSE 0 END,
    'avgConversionRate', CASE WHEN SUM(leads) > 0 THEN ROUND((SUM(vendas)::NUMERIC / SUM(leads)) * 100, 1) ELSE 0 END
  ) INTO result FROM peer_metrics;
  RETURN result;
END; $$;


-- ============================================
-- PARTE 5: Master RLS policies para 76 tabelas
-- SELECT + ALL policies para masters em tabelas
-- que têm RLS habilitado mas sem policy de master.
-- ============================================

DO $$
DECLARE
  tables TEXT[] := ARRAY[
    'acoes_do_dia',
    'agent_decision_logs',
    'campaign_dispatch_batches',
    'campanha_allowed_viewers',
    'campanha_dispatch_rule_steps',
    'campanha_dispatch_rules',
    'campanha_leads',
    'campanha_members',
    'campanha_pipe_automations',
    'campanha_stages',
    'campanha_templates',
    'checklist_items',
    'checklists',
    'competition_participants',
    'competition_prizes',
    'competitions',
    'conversation_context_summary',
    'conversation_messages',
    'conversation_notes',
    'conversation_summaries',
    'copilot_ab_assignments',
    'copilot_agent_audios',
    'copilot_agent_document_chunks',
    'copilot_agent_variants',
    'copilot_conversation_evaluations',
    'cron_config',
    'custom_pipe_entries',
    'custom_pipe_transitions',
    'custom_pipeline_members',
    'custom_pipeline_stages',
    'custom_pipelines',
    'follow_up_automations',
    'followup_automation_log',
    'google_calendar_sync_logs',
    'help_articles',
    'help_categories',
    'lead_custom_field_values',
    'lead_custom_fields',
    'lead_memories',
    'lead_scores',
    'lead_tags',
    'leads_reativacao',
    'notifications',
    'oraculo_usage',
    'org_onboarding',
    'organization_role_permissions',
    'outbound_dispatch_log',
    'pending_ai_actions',
    'pending_org_invites',
    'pipe_dispatch_rule_steps',
    'pipe_dispatch_rules',
    'pipe_distribution_members',
    'pipe_distribution_rules',
    'pipe_proposta_items',
    'pipeline_display_config',
    'product_materials',
    'product_variants',
    'scheduled_campaign_messages',
    'scheduled_pipe_messages',
    'scheduled_user_messages',
    'sz_chat_config',
    'sz_chat_sessions',
    'team_member_permissions',
    'tinyerp_connections',
    'tinyerp_order_mappings',
    'tinyerp_product_mappings',
    'tinyerp_sync_logs',
    'webhook_deliveries',
    'webhook_delivery_logs',
    'webhooks',
    'whatsapp_conversation_tags',
    'whatsapp_conversations',
    'whatsapp_instance_allowed_members',
    'whatsapp_rate_tracking',
    'workflow_split_assignments',
    'workflow_split_events'
  ];
  t TEXT;
  policy_select TEXT;
  policy_all TEXT;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    policy_select := 'master_ghost_select_' || t;
    policy_all := 'master_ghost_all_' || t;

    -- SELECT policy
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = policy_select
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_master_user())',
        policy_select, t
      );
    END IF;

    -- ALL policy (INSERT, UPDATE, DELETE)
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = policy_all
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user())',
        policy_all, t
      );
    END IF;
  END LOOP;
END $$;
