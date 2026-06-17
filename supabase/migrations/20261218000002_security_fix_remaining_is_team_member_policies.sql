-- =============================================================================
-- Security fix: replace remaining is_team_member() policies with org-scoped ones
--
-- 7 tables still use is_team_member() without organization filtering,
-- allowing any authenticated user to access data from ALL organizations.
-- =============================================================================

-- ─── 1. lead_scores (FK: lead_id → leads.organization_id) ──────────────

DROP POLICY IF EXISTS "Lead scores visíveis para autenticados" ON public.lead_scores;
DROP POLICY IF EXISTS "Team members podem gerenciar lead scores" ON public.lead_scores;

CREATE POLICY "lead_scores_select_org"
  ON public.lead_scores FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_scores.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "lead_scores_all_org"
  ON public.lead_scores FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_scores.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_scores.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 2. pipe_proposta_items (FK: pipe_proposta_id → pipe_propostas is a view) ──

DROP POLICY IF EXISTS "Pipe proposta items visíveis para autenticados" ON public.pipe_proposta_items;
DROP POLICY IF EXISTS "Team members podem gerenciar pipe proposta items" ON public.pipe_proposta_items;

-- pipe_propostas is a view over leads, so join through lead_id
CREATE POLICY "pipe_proposta_items_select_org"
  ON public.pipe_proposta_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = pipe_proposta_items.pipe_proposta_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "pipe_proposta_items_all_org"
  ON public.pipe_proposta_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = pipe_proposta_items.pipe_proposta_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = pipe_proposta_items.pipe_proposta_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 3. follow_up_automations (has organization_id since 20260320) ──────

DROP POLICY IF EXISTS "Automações visíveis para autenticados" ON public.follow_up_automations;

CREATE POLICY "follow_up_automations_select_org"
  ON public.follow_up_automations FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- ─── 4. goals (FK: team_member_id → team_members.organization_id) ──────

DROP POLICY IF EXISTS "Goals visíveis para autenticados" ON public.goals;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar goals" ON public.goals;

CREATE POLICY "goals_select_org"
  ON public.goals FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.id = goals.team_member_id
        AND team_members.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "goals_manage_admin_org"
  ON public.goals FOR ALL TO authenticated
  USING (
    (public.is_user_admin() OR public.is_master_user())
    AND EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.id = goals.team_member_id
        AND team_members.organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    (public.is_user_admin() OR public.is_master_user())
    AND EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.id = goals.team_member_id
        AND team_members.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 5. awards (same pattern as goals) ─────────────────────────────────

DROP POLICY IF EXISTS "Awards visíveis para autenticados" ON public.awards;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar awards" ON public.awards;

CREATE POLICY "awards_select_org"
  ON public.awards FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "awards_manage_admin_org"
  ON public.awards FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
    AND (public.is_user_admin() OR public.is_master_user())
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND (public.is_user_admin() OR public.is_master_user())
  );

-- ─── 6. leads_reativacao (FK: lead_id → leads.organization_id) ─────────

DROP POLICY IF EXISTS "Leads reativação visíveis para autenticados" ON public.leads_reativacao;
DROP POLICY IF EXISTS "Team members podem gerenciar leads reativação" ON public.leads_reativacao;

CREATE POLICY "leads_reativacao_select_org"
  ON public.leads_reativacao FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = leads_reativacao.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

CREATE POLICY "leads_reativacao_all_org"
  ON public.leads_reativacao FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = leads_reativacao.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = leads_reativacao.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 7. product_variants (has organization_id) ─────────────────────────

DROP POLICY IF EXISTS "Variações visíveis para autenticados" ON public.product_variants;

CREATE POLICY "product_variants_select_org"
  ON public.product_variants FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- ─── 8. lead_history INSERT fallback (FK: lead_id → leads) ─────────────

DROP POLICY IF EXISTS "lead_history_insert_team_member" ON public.lead_history;

CREATE POLICY "lead_history_insert_org"
  ON public.lead_history FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads
      WHERE leads.id = lead_history.lead_id
        AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 9. commissions (legacy policy) ────────────────────────────────────

DROP POLICY IF EXISTS "Commissions visíveis para autenticados" ON public.commissions;

CREATE POLICY "commissions_select_org"
  ON public.commissions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_members.id = commissions.team_member_id
        AND team_members.organization_id = public.get_user_organization_id()
    )
  );

-- ─── 10. profiles legacy policy ────────────────────────────────────────

DROP POLICY IF EXISTS "Profiles são visíveis para usuários autenticados" ON public.profiles;

-- ─── 11. leads legacy SELECT (should already be dropped but ensure) ────

DROP POLICY IF EXISTS "Leads visíveis para autenticados" ON public.leads;

-- ─── 12. lead_history legacy SELECT ────────────────────────────────────

DROP POLICY IF EXISTS "Lead history visível para autenticados" ON public.lead_history;
