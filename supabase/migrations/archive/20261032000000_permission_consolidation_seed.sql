-- ============================================================================
-- Permission Consolidation — Phase 1: Seed new features + Migrate data
-- PRD #408
--
-- Additive-only migration. Zero destructive changes.
--
-- 1) INSERT 3 new feature_permissions entries for org-level view keys
-- 2) Migrate team_member_permissions denials → member_feature_permissions
-- 3) Migrate team_member_org_permissions overrides → member_feature_permissions
-- ============================================================================

-- ─── 1) New feature_permissions entries ────────────────────────────────────
-- These replace the 3 org-level permission keys that user_has_org_permission()
-- checks: see_unassigned_cards, see_subordinates_cards, see_general_info.
-- (see_all_leads already maps to leads.view_all, can_delete_leads to leads.delete)

INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order) VALUES
  ('leads.view_unassigned',   'Leads', 'Ver leads sem responsável', 'Vê leads que não estão atribuídos a nenhum membro', false, true, 71),
  ('leads.view_subordinates', 'Leads', 'Ver leads da equipe',      'Vê leads atribuídos a outros membros da mesma organização', false, true, 72),
  ('leads.view_general_info', 'Leads', 'Ver informações gerais',   'Vê informações gerais de leads de outros responsáveis', false, true, 73)
ON CONFLICT (key) DO NOTHING;


-- ─── 2) Migrate matrix denials → member_feature_permissions ────────────────
-- Maps resource_key:action_key → feature_key for denied entries.
-- Only migrates denials (value = 'denied'); allowed is the default.

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
SELECT
  tmp.team_member_id,
  tm.organization_id,
  CASE
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key = 'create' THEN 'leads.create'
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key = 'view'   THEN 'leads.view'
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key = 'edit'   THEN 'leads.edit'
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key = 'delete' THEN 'leads.delete'
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key = 'export' THEN 'leads.export'
    WHEN tmp.resource_key = 'produtos'  AND tmp.action_key = 'create' THEN 'products.create'
    WHEN tmp.resource_key = 'produtos'  AND tmp.action_key = 'view'   THEN 'products.view'
    WHEN tmp.resource_key = 'produtos'  AND tmp.action_key = 'edit'   THEN 'products.edit'
    WHEN tmp.resource_key = 'produtos'  AND tmp.action_key = 'delete' THEN 'products.delete'
    WHEN tmp.resource_key = 'campanhas' AND tmp.action_key = 'create' THEN 'campaigns.create'
    WHEN tmp.resource_key = 'campanhas' AND tmp.action_key = 'edit'   THEN 'campaigns.edit'
    WHEN tmp.resource_key = 'campanhas' AND tmp.action_key = 'delete' THEN 'campaigns.delete'
    WHEN tmp.resource_key = 'campanhas' AND tmp.action_key = 'view'   THEN 'campaigns.view'
    WHEN tmp.resource_key IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
         AND tmp.action_key = 'view' THEN 'pipeline.view'
    WHEN tmp.resource_key IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
         AND tmp.action_key = 'edit' THEN 'pipeline.move_cards'
    WHEN tmp.resource_key IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
         AND tmp.action_key = 'delete' THEN 'pipeline.delete_cards'
    WHEN tmp.resource_key = 'checklists' AND tmp.action_key = 'view'   THEN 'followups.view'
    WHEN tmp.resource_key = 'checklists' AND tmp.action_key = 'edit'   THEN 'followups.configure'
    WHEN tmp.resource_key = 'checklists' AND tmp.action_key = 'delete' THEN 'followups.delete'
  END AS feature_key,
  false AS enabled
FROM public.team_member_permissions tmp
JOIN public.team_members tm ON tm.id = tmp.team_member_id
WHERE tmp.value = 'denied'
  AND CASE
    WHEN tmp.resource_key = 'leads'     AND tmp.action_key IN ('create','view','edit','delete','export') THEN true
    WHEN tmp.resource_key = 'produtos'  AND tmp.action_key IN ('create','view','edit','delete') THEN true
    WHEN tmp.resource_key = 'campanhas' AND tmp.action_key IN ('create','view','edit','delete') THEN true
    WHEN tmp.resource_key IN ('pipe_whatsapp','pipe_confirmacao','pipe_propostas')
         AND tmp.action_key IN ('view','edit','delete') THEN true
    WHEN tmp.resource_key = 'checklists' AND tmp.action_key IN ('view','edit','delete') THEN true
    ELSE false
  END
ON CONFLICT (team_member_id, feature_key) DO NOTHING;


-- ─── 3) Migrate org permission overrides → member_feature_permissions ──────
-- Maps permission_key → feature_key for team_member_org_permissions rows.

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
SELECT
  tmo.team_member_id,
  tm.organization_id,
  CASE tmo.permission_key
    WHEN 'see_unassigned_cards'   THEN 'leads.view_unassigned'
    WHEN 'see_subordinates_cards' THEN 'leads.view_subordinates'
    WHEN 'see_general_info'       THEN 'leads.view_general_info'
    WHEN 'see_all_leads'          THEN 'leads.view_all'
    WHEN 'can_delete_leads'       THEN 'leads.delete'
  END AS feature_key,
  tmo.enabled
FROM public.team_member_org_permissions tmo
JOIN public.team_members tm ON tm.id = tmo.team_member_id
WHERE tmo.permission_key IN ('see_unassigned_cards', 'see_subordinates_cards', 'see_general_info', 'see_all_leads', 'can_delete_leads')
ON CONFLICT (team_member_id, feature_key) DO NOTHING;
