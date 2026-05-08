-- ============================================================================
-- Dual Responsible Fields: pre_sale_responsible_id + sale_responsible_id
--
-- Adds two attribution fields to every table that currently holds responsible
-- assignments.  Both fields coexist with the legacy sdr_id / closer_id /
-- responsible_id columns — those are kept for backward compatibility.
--
-- pre_sale_responsible_id  → credit for meetings / qualification stage
-- sale_responsible_id      → credit for closed deals / revenue attribution
--
-- Tables covered:
--   leads, pipe_whatsapp, pipe_confirmacao, pipe_propostas,
--   campanha_leads, custom_pipe_entries,
--   upsell_clients, upsell_campanhas, upsell_orders
--
-- Functions updated:
--   is_user_responsible(p_pre_sale UUID, p_sale UUID)  — NEW overload
--   is_user_responsible_in_any_pipe(p_lead_id UUID)     — updated
--   get_dashboard_metrics(...)                          — updated
--   get_ranking_data(...)                               — updated
--   distribute_pipe_round_robin(...)                    — updated
--   sync_dual_responsible_to_lead_from_pipe()           — NEW trigger fn
--
-- RLS policies for leads SELECT/UPDATE updated to include new fields.
--
-- Idempotent: uses IF NOT EXISTS / DROP … IF EXISTS throughout.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: ADD COLUMNS
-- ============================================================================

-- ── leads ────────────────────────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_pre_sale_responsible
  ON public.leads(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_leads_sale_responsible
  ON public.leads(sale_responsible_id);

-- ── pipe_whatsapp ─────────────────────────────────────────────────────────────
ALTER TABLE public.pipe_whatsapp
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_pre_sale_responsible
  ON public.pipe_whatsapp(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_sale_responsible
  ON public.pipe_whatsapp(sale_responsible_id);

-- ── pipe_confirmacao ──────────────────────────────────────────────────────────
ALTER TABLE public.pipe_confirmacao
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_pre_sale_responsible
  ON public.pipe_confirmacao(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_sale_responsible
  ON public.pipe_confirmacao(sale_responsible_id);

-- ── pipe_propostas ────────────────────────────────────────────────────────────
ALTER TABLE public.pipe_propostas
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipe_propostas_pre_sale_responsible
  ON public.pipe_propostas(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_sale_responsible
  ON public.pipe_propostas(sale_responsible_id);

-- ── campanha_leads ────────────────────────────────────────────────────────────
ALTER TABLE public.campanha_leads
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

-- ── custom_pipe_entries ───────────────────────────────────────────────────────
ALTER TABLE public.custom_pipe_entries
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

-- ── upsell_clients ────────────────────────────────────────────────────────────
ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

-- ── upsell_campanhas ──────────────────────────────────────────────────────────
ALTER TABLE public.upsell_campanhas
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;

-- ── upsell_orders ─────────────────────────────────────────────────────────────
ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID
    REFERENCES public.team_members(id) ON DELETE SET NULL;


-- ============================================================================
-- SECTION 2: MIGRATE EXISTING DATA
-- ============================================================================

-- ── leads ─────────────────────────────────────────────────────────────────────
-- pre_sale = whoever handled qualification (sdr first, fallback responsible)
-- sale     = whoever closed (closer first, fallback responsible)
UPDATE public.leads
SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── pipe_whatsapp ─────────────────────────────────────────────────────────────
-- Qualification pipe: sdr drives pre_sale; responsible covers sale
UPDATE public.pipe_whatsapp
SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id     = responsible_id
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── pipe_confirmacao ──────────────────────────────────────────────────────────
-- Meetings: sdr schedules (pre_sale), closer attends (sale)
UPDATE public.pipe_confirmacao
SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── pipe_propostas ────────────────────────────────────────────────────────────
-- Proposals: responsible sends (pre_sale); closer signs off (sale)
UPDATE public.pipe_propostas
SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── campanha_leads ────────────────────────────────────────────────────────────
UPDATE public.campanha_leads
SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── custom_pipe_entries ───────────────────────────────────────────────────────
-- Only assigned_to exists here; use it for both
UPDATE public.custom_pipe_entries
SET
  pre_sale_responsible_id = assigned_to,
  sale_responsible_id     = assigned_to
WHERE assigned_to IS NOT NULL
  AND pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── upsell_clients ────────────────────────────────────────────────────────────
UPDATE public.upsell_clients
SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── upsell_campanhas ──────────────────────────────────────────────────────────
-- upsell_campanhas has no direct closer_id — responsible is closest proxy
UPDATE public.upsell_campanhas
SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id     = responsible_id
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;

-- ── upsell_orders ─────────────────────────────────────────────────────────────
UPDATE public.upsell_orders
SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id     = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL
  AND sale_responsible_id IS NULL;


-- ============================================================================
-- SECTION 3: TRIGGER — sync dual fields from pipe to lead
-- ============================================================================

-- Drop old single-field sync triggers on the 3 main pipes
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_whatsapp     ON public.pipe_whatsapp;
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_confirmacao   ON public.pipe_confirmacao;
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_propostas     ON public.pipe_propostas;

CREATE OR REPLACE FUNCTION public.sync_dual_responsible_to_lead_from_pipe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when at least one dual field actually changed
  IF (NEW.pre_sale_responsible_id IS DISTINCT FROM OLD.pre_sale_responsible_id)
  OR (NEW.sale_responsible_id     IS DISTINCT FROM OLD.sale_responsible_id)
  THEN
    UPDATE public.leads
    SET
      -- COALESCE: do not overwrite an existing value with NULL from the pipe
      pre_sale_responsible_id = COALESCE(
        NEW.pre_sale_responsible_id,
        pre_sale_responsible_id
      ),
      sale_responsible_id = COALESCE(
        NEW.sale_responsible_id,
        sale_responsible_id
      ),
      updated_at = NOW()
    WHERE id = NEW.lead_id
      AND (
        -- Only write when the lead's field is actually changing
        pre_sale_responsible_id IS DISTINCT FROM COALESCE(NEW.pre_sale_responsible_id, pre_sale_responsible_id)
        OR sale_responsible_id IS DISTINCT FROM COALESCE(NEW.sale_responsible_id, sale_responsible_id)
      );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_dual_responsible_to_lead_from_pipe() IS
  'Syncs pre_sale_responsible_id and sale_responsible_id from any pipe table to the parent lead. Uses COALESCE so NULL values in the pipe do not overwrite non-NULL values on the lead.';

-- Create new triggers on all 3 pipe tables
DROP TRIGGER IF EXISTS trg_sync_dual_responsible_from_pipe_whatsapp ON public.pipe_whatsapp;
CREATE TRIGGER trg_sync_dual_responsible_from_pipe_whatsapp
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id
  ON public.pipe_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();

DROP TRIGGER IF EXISTS trg_sync_dual_responsible_from_pipe_confirmacao ON public.pipe_confirmacao;
CREATE TRIGGER trg_sync_dual_responsible_from_pipe_confirmacao
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id
  ON public.pipe_confirmacao
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();

DROP TRIGGER IF EXISTS trg_sync_dual_responsible_from_pipe_propostas ON public.pipe_propostas;
CREATE TRIGGER trg_sync_dual_responsible_from_pipe_propostas
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id
  ON public.pipe_propostas
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();


-- ============================================================================
-- SECTION 4: RLS HELPER — is_user_responsible(pre_sale, sale)
-- ============================================================================

-- New 2-param overload that checks both dual attribution fields
CREATE OR REPLACE FUNCTION public.is_user_responsible(
  p_pre_sale UUID,
  p_sale     UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND (
        (p_pre_sale IS NOT NULL AND id = p_pre_sale)
        OR
        (p_sale     IS NOT NULL AND id = p_sale)
      )
  )
$$;

COMMENT ON FUNCTION public.is_user_responsible(UUID, UUID) IS
  'Returns true if the current user''s team_member.id matches either pre_sale_responsible_id or sale_responsible_id. SECURITY DEFINER, STABLE.';


-- ============================================================================
-- SECTION 5: is_user_responsible_in_any_pipe — updated with dual fields
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_user_responsible_in_any_pipe(p_lead_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND (
        -- pipe_confirmacao: dual fields + legacy
        EXISTS (
          SELECT 1 FROM public.pipe_confirmacao pc
          WHERE pc.lead_id = p_lead_id
            AND (
              pc.pre_sale_responsible_id = tm.id
              OR pc.sale_responsible_id  = tm.id
              OR pc.responsible_id       = tm.id
              OR pc.sdr_id               = tm.id
              OR pc.closer_id            = tm.id
            )
        )
        OR
        -- pipe_propostas: dual fields + legacy
        EXISTS (
          SELECT 1 FROM public.pipe_propostas pp
          WHERE pp.lead_id = p_lead_id
            AND (
              pp.pre_sale_responsible_id = tm.id
              OR pp.sale_responsible_id  = tm.id
              OR pp.responsible_id       = tm.id
              OR pp.closer_id            = tm.id
            )
        )
        OR
        -- pipe_whatsapp: dual fields + legacy
        EXISTS (
          SELECT 1 FROM public.pipe_whatsapp pw
          WHERE pw.lead_id = p_lead_id
            AND (
              pw.pre_sale_responsible_id = tm.id
              OR pw.sale_responsible_id  = tm.id
              OR pw.responsible_id       = tm.id
              OR pw.sdr_id               = tm.id
            )
        )
      )
  )
$$;

COMMENT ON FUNCTION public.is_user_responsible_in_any_pipe(UUID) IS
  'Returns true if current user appears as responsible in any pipe for the lead. Checks dual fields (pre_sale_responsible_id, sale_responsible_id) and legacy fields (responsible_id, sdr_id, closer_id) for backward compatibility.';


-- ============================================================================
-- SECTION 6: RLS POLICIES — leads SELECT and UPDATE
-- ============================================================================

DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      -- Dual fields
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      -- Legacy fields + permissions
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      -- Any pipe (dual + legacy)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      -- Dual fields
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      -- Legacy fields + permissions
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      -- Any pipe (dual + legacy)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );


-- ============================================================================
-- SECTION 7: get_dashboard_metrics — filter by dual fields
-- ============================================================================

-- Drop old overloads so the new signature is the only one
DROP FUNCTION IF EXISTS public.get_dashboard_metrics(UUID, DATE, DATE, UUID);
DROP FUNCTION IF EXISTS public.get_dashboard_metrics(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id          UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_filter_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads               INTEGER := 0;
  v_tempo_medio_resposta      NUMERIC := 0;
  v_reunioes_marcadas         INTEGER := 0;
  v_reunioes_comparecidas     INTEGER := 0;
  v_no_show                   INTEGER := 0;
  v_taxa_no_show              NUMERIC := 0;
  v_finalizados_data_passada  INTEGER := 0;
  v_propostas_enviadas        INTEGER := 0;
  v_funnel_vendas             INTEGER := 0;
  v_funnel_propostas          INTEGER := 0;
  v_funnel_reunioes_marcadas  INTEGER := 0;
  v_funnel_compareceu         INTEGER := 0;
  v_novos_clientes            INTEGER := 0;
  v_venda_total               NUMERIC := 0;
  v_venda_mrr                 NUMERIC := 0;
  v_venda_projeto             NUMERIC := 0;
  v_venda_base_ativa          NUMERIC := 0;
  v_venda_primeiro_pedido     NUMERIC := 0;
  v_ticket_medio              NUMERIC := 0;
  v_ticket_medio_mrr          NUMERIC := 0;
  v_ticket_medio_projeto      NUMERIC := 0;
  v_taxa_conversao            NUMERIC := 0;
  v_total_in_pipe             INTEGER := 0;
  v_daily_sales               JSONB   := '[]'::jsonb;
  rec                         RECORD;
BEGIN
  -- ─── 1. Total leads in period ──────────────────────────────────────────────
  -- Filter by ANY responsible field (dual or legacy)
  SELECT COUNT(*) INTO v_total_leads
  FROM public.leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sale_responsible_id     = p_filter_member_id
      OR responsible_id          = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR closer_id               = p_filter_member_id
    );

  -- ─── 2. Average response time ─────────────────────────────────────────────
  SELECT COALESCE(AVG(minutes_diff), 0) INTO v_tempo_medio_resposta
  FROM (
    SELECT EXTRACT(EPOCH FROM (
      MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END)
      - MIN(CASE WHEN cm.role = 'user'    THEN cm.created_at END)
    )) / 60 AS minutes_diff
    FROM public.conversation_messages cm
    JOIN public.conversations c ON c.id = cm.conversation_id
    WHERE c.organization_id = p_org_id
      AND cm.created_at >= p_start_date AND cm.created_at <= p_end_date
    GROUP BY cm.conversation_id
    HAVING MIN(CASE WHEN cm.role = 'user'    THEN cm.created_at END) IS NOT NULL
       AND MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END) IS NOT NULL
  ) sub;

  -- ─── 3. Meetings — filter primarily by pre_sale_responsible_id ────────────
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR responsible_id          = p_filter_member_id
    );
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR responsible_id          = p_filter_member_id
    );
  v_funnel_compareceu := v_reunioes_comparecidas;

  SELECT COUNT(*) INTO v_no_show
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND meeting_date < NOW()
    AND status IN ('remarcar', 'perdido')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR responsible_id          = p_filter_member_id
    );

  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND meeting_date < NOW()
    AND status IN ('remarcar', 'perdido')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sdr_id                  = p_filter_member_id
      OR responsible_id          = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- ─── 4. Proposals — filter primarily by sale_responsible_id ───────────────
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sale_responsible_id = p_filter_member_id
      OR closer_id           = p_filter_member_id
      OR responsible_id      = p_filter_member_id
    );
  v_funnel_propostas := v_propostas_enviadas;

  -- ─── 5. Sales (vendido) ───────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sale_responsible_id = p_filter_member_id
      OR closer_id           = p_filter_member_id
      OR responsible_id      = p_filter_member_id
    );
  v_novos_clientes := v_funnel_vendas;

  -- ─── 6. Conversion rate ────────────────────────────────────────────────────
  SELECT COUNT(DISTINCT id) INTO v_total_in_pipe
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id
    AND (
      (COALESCE(metrics_period_at, created_at) >= p_start_date
       AND COALESCE(metrics_period_at, created_at) <= p_end_date)
      OR (status IN ('vendido', 'perdido')
          AND COALESCE(metrics_period_at, closed_at) >= p_start_date
          AND COALESCE(metrics_period_at, closed_at) <= p_end_date)
    )
    AND (
      p_filter_member_id IS NULL
      OR sale_responsible_id = p_filter_member_id
      OR closer_id           = p_filter_member_id
      OR responsible_id      = p_filter_member_id
    );

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- ─── 7. Revenue breakdown ─────────────────────────────────────────────────
  FOR rec IN
    SELECT pp.status, pp.sale_value, pp.closed_at, pp.metrics_period_at,
           pp.contract_duration, pp.product_type,
           EXISTS (
             SELECT 1 FROM public.pipe_propostas prev
             WHERE prev.organization_id = pp.organization_id
               AND prev.lead_id = pp.lead_id
               AND prev.status = 'vendido' AND prev.id != pp.id
               AND prev.closed_at < pp.closed_at
           ) AS is_repeat
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR pp.sale_responsible_id = p_filter_member_id
        OR pp.closer_id           = p_filter_member_id
        OR pp.responsible_id      = p_filter_member_id
      )
  LOOP
    DECLARE
      v_duration INTEGER;
    BEGIN
      v_duration := GREATEST(1, COALESCE(rec.contract_duration, 1));
      IF rec.product_type = 'mrr' THEN
        v_venda_mrr   := v_venda_mrr   + COALESCE(rec.sale_value, 0);
        v_venda_total := v_venda_total  + (COALESCE(rec.sale_value, 0) * v_duration);
        IF rec.is_repeat THEN
          v_venda_base_ativa       := v_venda_base_ativa       + (COALESCE(rec.sale_value, 0) * v_duration);
        ELSE
          v_venda_primeiro_pedido  := v_venda_primeiro_pedido  + (COALESCE(rec.sale_value, 0) * v_duration);
        END IF;
      ELSIF rec.product_type = 'projeto' THEN
        v_venda_projeto := v_venda_projeto + COALESCE(rec.sale_value, 0);
        v_venda_total   := v_venda_total   + COALESCE(rec.sale_value, 0);
        IF rec.is_repeat THEN
          v_venda_base_ativa      := v_venda_base_ativa      + COALESCE(rec.sale_value, 0);
        ELSE
          v_venda_primeiro_pedido := v_venda_primeiro_pedido + COALESCE(rec.sale_value, 0);
        END IF;
      ELSE
        v_venda_total := v_venda_total + COALESCE(rec.sale_value, 0);
        IF rec.is_repeat THEN
          v_venda_base_ativa      := v_venda_base_ativa      + COALESCE(rec.sale_value, 0);
        ELSE
          v_venda_primeiro_pedido := v_venda_primeiro_pedido + COALESCE(rec.sale_value, 0);
        END IF;
      END IF;
    END;
  END LOOP;

  IF v_funnel_vendas > 0 THEN
    v_ticket_medio := v_venda_total / v_funnel_vendas;
  END IF;

  -- ─── 8. Daily sales ───────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('day', day_str, 'count', count_val, 'revenue', revenue_val)
    ORDER BY day_str
  ), '[]'::jsonb) INTO v_daily_sales
  FROM (
    SELECT TO_CHAR(COALESCE(metrics_period_at, closed_at), 'YYYY-MM-DD') AS day_str,
           COUNT(*) AS count_val,
           SUM(COALESCE(sale_value, 0)) AS revenue_val
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR pp.sale_responsible_id = p_filter_member_id
        OR pp.closer_id           = p_filter_member_id
        OR pp.responsible_id      = p_filter_member_id
      )
    GROUP BY day_str
    ORDER BY day_str
  ) daily;

  RETURN jsonb_build_object(
    'totalLeads',          v_total_leads,
    'tempoMedioResposta',  ROUND(v_tempo_medio_resposta::numeric, 1),
    'reunioesMarcadas',    v_reunioes_marcadas,
    'reunioesComparecidas',v_reunioes_comparecidas,
    'noShow',              v_no_show,
    'taxaNoShow',          v_taxa_no_show,
    'propostasEnviadas',   v_propostas_enviadas,
    'novosClientes',       v_novos_clientes,
    'vendaTotal',          v_venda_total,
    'vendaMRR',            v_venda_mrr,
    'vendaProjeto',        v_venda_projeto,
    'vendaBaseAtiva',      v_venda_base_ativa,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'ticketMedio',         v_ticket_medio,
    'ticketMedioMRR',      v_ticket_medio_mrr,
    'ticketMedioProjeto',  v_ticket_medio_projeto,
    'dailySales',          v_daily_sales,
    'funnelVendas',        v_funnel_vendas,
    'funnelPropostas',     v_funnel_propostas,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu',    v_funnel_compareceu,
    'taxaConversao',       v_taxa_conversao,
    'totalInPipe',         v_total_in_pipe
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_metrics IS
  'Dashboard metrics. Filters by dual responsible fields (pre_sale/sale) with fallback to legacy fields. Updated 2026-09-30 for dual-responsible support.';


-- ============================================================================
-- SECTION 8: get_ranking_data — group by dual fields
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ranking_data(
  p_month           INT,
  p_year            INT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id          UUID;
  v_start_ts        TIMESTAMPTZ;
  v_end_ts          TIMESTAMPTZ;
  v_sales_ranking   JSONB;
  v_meetings_ranking JSONB;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_org_id := p_organization_id;
  ELSE
    SELECT tm.organization_id INTO v_org_id
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts   := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date
                  + time '23:59:59.999') AT TIME ZONE 'UTC';

  -- ── Closer / Sales ranking ──────────────────────────────────────────────
  -- Group by sale_responsible_id (new) falling back to closer_id (legacy)
  WITH sales_agg AS (
    SELECT COALESCE(pp.sale_responsible_id, pp.closer_id, pp.responsible_id) AS member_id,
           SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.sale_responsible_id, pp.closer_id, pp.responsible_id) IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL
          AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL
          AND pp.closed_at >= v_start_ts AND pp.closed_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  sales_data AS (
    SELECT tm.id, tm.name, tm.job_title,
           COALESCE(tm.metric_type, 'sales') AS metric_type,
           COALESCE(sa.total_value, 0)       AS total_value,
           COALESCE(sa.conversions, 0)        AS conversions,
           (SELECT g.target_value FROM public.goals g
            WHERE g.organization_id = v_org_id
              AND g.team_member_id = tm.id
              AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
            ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND (tm.metric_type = 'sales' OR tm.metric_type IS NULL)
  ),
  sales_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, conversions, goal_target,
           ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM sales_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',           id,
      'name',         name,
      'job_title',    job_title,
      'metric_type',  metric_type,
      'value',        total_value,
      'conversions',  conversions,
      'goal',         COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
                       THEN ROUND((total_value / goal_target) * 100)::int
                       ELSE 0 END,
      'position',     pos::int,
      'role',         'Vendas'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_sales_ranking
  FROM sales_sorted;

  -- ── SDR / Meetings ranking ──────────────────────────────────────────────
  -- Group by pre_sale_responsible_id (new) falling back to sdr_id (legacy)
  WITH meetings_agg AS (
    SELECT COALESCE(pc.pre_sale_responsible_id, pc.sdr_id, pc.responsible_id) AS member_id,
           COUNT(DISTINCT pc.id)::int AS total_meetings
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = v_org_id
      AND pc.status = 'compareceu'
      AND COALESCE(pc.pre_sale_responsible_id, pc.sdr_id, pc.responsible_id) IS NOT NULL
      AND (
        (pc.metrics_period_at IS NOT NULL
          AND pc.metrics_period_at >= v_start_ts AND pc.metrics_period_at <= v_end_ts)
        OR (pc.metrics_period_at IS NULL
          AND pc.created_at >= v_start_ts AND pc.created_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title,
           COALESCE(tm.metric_type, 'meetings') AS metric_type,
           0::numeric                           AS total_value,
           COALESCE(ma.total_meetings, 0)        AS meetings,
           (SELECT g.target_value FROM public.goals g
            WHERE g.organization_id = v_org_id
              AND g.team_member_id = tm.id
              AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes'
            ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, meetings, goal_target,
           ROW_NUMBER() OVER (ORDER BY meetings DESC) AS pos
    FROM meetings_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',           id,
      'name',         name,
      'job_title',    job_title,
      'metric_type',  metric_type,
      'value',        total_value,
      'meetings',     meetings,
      'goal',         COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
                       THEN ROUND((meetings::numeric / goal_target) * 100)::int
                       ELSE 0 END,
      'position',     pos::int,
      'role',         'Reuniões'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_meetings_ranking
  FROM meetings_sorted;

  RETURN jsonb_build_object(
    'salesRanking',    v_sales_ranking,
    'meetingsRanking', v_meetings_ranking
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_data TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_data TO service_role;

COMMENT ON FUNCTION public.get_ranking_data IS
  'Rankings. Closer: COALESCE(sale_responsible_id, closer_id). SDR: COALESCE(pre_sale_responsible_id, sdr_id). Updated 2026-09-30 for dual-responsible support.';


-- ============================================================================
-- SECTION 9: distribute_pipe_round_robin — count by dual fields
-- ============================================================================

CREATE OR REPLACE FUNCTION public.distribute_pipe_round_robin(
  p_pipe_type       TEXT,
  p_organization_id UUID,
  p_member_ids      UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_last_assigned UUID;
  v_last_idx      INT;
  v_arr_len       INT;
BEGIN
  -- Serialize concurrent callers for the same pipe + org.
  PERFORM pg_advisory_xact_lock(
    hashtext('pipe_dist:' || p_pipe_type || ':' || p_organization_id::text)
  );

  v_arr_len := array_length(p_member_ids, 1);
  IF v_arr_len IS NULL OR v_arr_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Find last assigned by the dual field that is primary for each pipe type.
  -- whatsapp + confirmacao → pre_sale_responsible_id (SDR / qualification role)
  -- propostas              → sale_responsible_id     (closer / revenue role)
  IF p_pipe_type = 'whatsapp' THEN
    SELECT COALESCE(pw.pre_sale_responsible_id, pw.responsible_id) INTO v_last_assigned
    FROM public.pipe_whatsapp pw
    WHERE pw.organization_id = p_organization_id
      AND COALESCE(pw.pre_sale_responsible_id, pw.responsible_id) = ANY(p_member_ids)
    ORDER BY pw.created_at DESC
    LIMIT 1;

  ELSIF p_pipe_type = 'confirmacao' THEN
    SELECT COALESCE(pc.pre_sale_responsible_id, pc.responsible_id) INTO v_last_assigned
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = p_organization_id
      AND COALESCE(pc.pre_sale_responsible_id, pc.responsible_id) = ANY(p_member_ids)
    ORDER BY pc.created_at DESC
    LIMIT 1;

  ELSIF p_pipe_type = 'propostas' THEN
    SELECT COALESCE(pp.sale_responsible_id, pp.responsible_id) INTO v_last_assigned
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = p_organization_id
      AND COALESCE(pp.sale_responsible_id, pp.responsible_id) = ANY(p_member_ids)
    ORDER BY pp.created_at DESC
    LIMIT 1;

  ELSE
    RAISE EXCEPTION 'Unknown pipe type: %. Expected whatsapp, confirmacao, or propostas.', p_pipe_type;
  END IF;

  -- No previous assignment → first member.
  IF v_last_assigned IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Find position of last-assigned member in the supplied array.
  v_last_idx := NULL;
  FOR i IN 1..v_arr_len LOOP
    IF p_member_ids[i] = v_last_assigned THEN
      v_last_idx := i;
      EXIT;
    END IF;
  END LOOP;

  -- Not in pool → restart from first.
  IF v_last_idx IS NULL THEN
    RETURN p_member_ids[1];
  END IF;

  -- Wrap around.
  IF v_last_idx >= v_arr_len THEN
    RETURN p_member_ids[1];
  ELSE
    RETURN p_member_ids[v_last_idx + 1];
  END IF;
END;
$$;

COMMENT ON FUNCTION public.distribute_pipe_round_robin(TEXT, UUID, UUID[]) IS
  'Sequential round-robin for pipes. Uses pre_sale_responsible_id for whatsapp/confirmacao and sale_responsible_id for propostas, with fallback to responsible_id. Serialized by advisory lock.';


-- ============================================================================
-- SECTION 10: VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_leads_cols    INT;
  v_wapp_cols     INT;
  v_conf_cols     INT;
  v_prop_cols     INT;
  v_camp_cols     INT;
  v_cpe_cols      INT;
  v_ucl_cols      INT;
  v_ucamp_cols    INT;
  v_uord_cols     INT;
  v_trg_wapp      INT;
  v_trg_conf      INT;
  v_trg_prop      INT;
  v_fn_is_resp    INT;
  v_fn_any_pipe   INT;
  v_fn_dash       INT;
  v_fn_ranking    INT;
  v_fn_rr         INT;
BEGIN
  -- Columns exist
  SELECT COUNT(*) INTO v_leads_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_wapp_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pipe_whatsapp'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_conf_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pipe_confirmacao'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_prop_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'pipe_propostas'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_camp_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'campanha_leads'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_cpe_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'custom_pipe_entries'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_ucl_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'upsell_clients'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_ucamp_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'upsell_campanhas'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  SELECT COUNT(*) INTO v_uord_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'upsell_orders'
    AND column_name IN ('pre_sale_responsible_id', 'sale_responsible_id');

  -- Triggers
  SELECT COUNT(*) INTO v_trg_wapp
  FROM pg_trigger WHERE tgname = 'trg_sync_dual_responsible_from_pipe_whatsapp';

  SELECT COUNT(*) INTO v_trg_conf
  FROM pg_trigger WHERE tgname = 'trg_sync_dual_responsible_from_pipe_confirmacao';

  SELECT COUNT(*) INTO v_trg_prop
  FROM pg_trigger WHERE tgname = 'trg_sync_dual_responsible_from_pipe_propostas';

  -- Functions (count overloads; is_user_responsible(UUID,UUID) is proargtypes '2950 2950')
  SELECT COUNT(*) INTO v_fn_is_resp
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_user_responsible'
    AND array_length(p.proargtypes, 1) = 2;

  SELECT COUNT(*) INTO v_fn_any_pipe
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_user_responsible_in_any_pipe';

  SELECT COUNT(*) INTO v_fn_dash
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_dashboard_metrics';

  SELECT COUNT(*) INTO v_fn_ranking
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_ranking_data';

  SELECT COUNT(*) INTO v_fn_rr
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'distribute_pipe_round_robin';

  -- Assertions
  IF v_leads_cols   < 2 THEN RAISE EXCEPTION 'FAIL: leads missing dual columns (%)', v_leads_cols; END IF;
  IF v_wapp_cols    < 2 THEN RAISE EXCEPTION 'FAIL: pipe_whatsapp missing dual columns'; END IF;
  IF v_conf_cols    < 2 THEN RAISE EXCEPTION 'FAIL: pipe_confirmacao missing dual columns'; END IF;
  IF v_prop_cols    < 2 THEN RAISE EXCEPTION 'FAIL: pipe_propostas missing dual columns'; END IF;
  IF v_camp_cols    < 2 THEN RAISE EXCEPTION 'FAIL: campanha_leads missing dual columns'; END IF;
  IF v_cpe_cols     < 2 THEN RAISE EXCEPTION 'FAIL: custom_pipe_entries missing dual columns'; END IF;
  IF v_ucl_cols     < 2 THEN RAISE EXCEPTION 'FAIL: upsell_clients missing dual columns'; END IF;
  IF v_ucamp_cols   < 2 THEN RAISE EXCEPTION 'FAIL: upsell_campanhas missing dual columns'; END IF;
  IF v_uord_cols    < 2 THEN RAISE EXCEPTION 'FAIL: upsell_orders missing dual columns'; END IF;

  IF v_trg_wapp  = 0 THEN RAISE EXCEPTION 'FAIL: trigger missing on pipe_whatsapp'; END IF;
  IF v_trg_conf  = 0 THEN RAISE EXCEPTION 'FAIL: trigger missing on pipe_confirmacao'; END IF;
  IF v_trg_prop  = 0 THEN RAISE EXCEPTION 'FAIL: trigger missing on pipe_propostas'; END IF;

  IF v_fn_is_resp  = 0 THEN RAISE EXCEPTION 'FAIL: is_user_responsible(UUID,UUID) not found'; END IF;
  IF v_fn_any_pipe = 0 THEN RAISE EXCEPTION 'FAIL: is_user_responsible_in_any_pipe not found'; END IF;
  IF v_fn_dash     = 0 THEN RAISE EXCEPTION 'FAIL: get_dashboard_metrics not found'; END IF;
  IF v_fn_ranking  = 0 THEN RAISE EXCEPTION 'FAIL: get_ranking_data not found'; END IF;
  IF v_fn_rr       = 0 THEN RAISE EXCEPTION 'FAIL: distribute_pipe_round_robin not found'; END IF;

  RAISE NOTICE 'VALIDATION PASSED: dual_responsible_fields migration complete.';
  RAISE NOTICE '  Columns: leads(%), pipe_whatsapp(%), pipe_confirmacao(%), pipe_propostas(%)',
    v_leads_cols, v_wapp_cols, v_conf_cols, v_prop_cols;
  RAISE NOTICE '  Columns: campanha_leads(%), custom_pipe_entries(%), upsell_clients(%), upsell_campanhas(%), upsell_orders(%)',
    v_camp_cols, v_cpe_cols, v_ucl_cols, v_ucamp_cols, v_uord_cols;
  RAISE NOTICE '  Triggers: wapp(%), conf(%), prop(%)', v_trg_wapp, v_trg_conf, v_trg_prop;
END;
$$;

COMMIT;
