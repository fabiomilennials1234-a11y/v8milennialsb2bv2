-- Onboarding state machine: consolidate into organizations, create template tables, RPCs
-- Replaces legacy org_onboarding table with state machine columns on organizations.
-- Default='completed' — zero impact on existing orgs.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Add onboarding columns to organizations
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_state text NOT NULL DEFAULT 'completed'
    CHECK (onboarding_state IN (
      'pending_whatsapp',
      'pending_profile',
      'pending_pipelines',
      'pending_automations',
      'completed'
    ));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_answers jsonb;

CREATE INDEX IF NOT EXISTS idx_organizations_onboarding_state
  ON public.organizations(onboarding_state)
  WHERE onboarding_state != 'completed';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Deprecate org_onboarding auto-create trigger
-- ══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_create_org_onboarding ON public.organizations;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Pipeline templates table (global, master-only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.onboarding_pipeline_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  color text,
  default_pipelines_config jsonb NOT NULL DEFAULT '{}',
  custom_pipelines jsonb NOT NULL DEFAULT '[]',
  match_criteria jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_pipeline_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_pipeline_tpl_all"
  ON public.onboarding_pipeline_templates FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Automation templates table (global, master-only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.onboarding_automation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('boas_vindas', 'follow_up', 'confirmacao_reuniao')),
  icon text,
  workflow_definition jsonb NOT NULL,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  customizable_fields jsonb NOT NULL DEFAULT '[]',
  match_criteria jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_automation_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_automation_tpl_all"
  ON public.onboarding_automation_templates FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RPC: advance_onboarding_state (SECURITY DEFINER helper)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.advance_onboarding_state(
  p_org_id uuid,
  p_expected_state text,
  p_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_next text;
BEGIN
  SELECT onboarding_state INTO v_current
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Organization not found: %', p_org_id;
  END IF;

  IF v_current != p_expected_state THEN
    RAISE EXCEPTION 'State mismatch: expected %, got %', p_expected_state, v_current;
  END IF;

  v_next := CASE v_current
    WHEN 'pending_whatsapp' THEN 'pending_profile'
    WHEN 'pending_profile' THEN 'pending_pipelines'
    WHEN 'pending_pipelines' THEN 'pending_automations'
    WHEN 'pending_automations' THEN 'completed'
  END;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Cannot advance from state: %', v_current;
  END IF;

  IF v_current = 'pending_profile' AND p_payload IS NOT NULL THEN
    UPDATE organizations SET onboarding_answers = p_payload WHERE id = p_org_id;
  END IF;

  IF v_next = 'completed' THEN
    UPDATE organizations SET onboarding_completed_at = now() WHERE id = p_org_id;
  END IF;

  UPDATE organizations
  SET onboarding_state = v_next, updated_at = now()
  WHERE id = p_org_id;

  RETURN jsonb_build_object('previous_state', v_current, 'new_state', v_next);
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RPC: match_onboarding_templates (SECURITY DEFINER — used by onboarding flow)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.match_onboarding_templates(
  p_org_id uuid,
  p_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_answers jsonb;
  v_results jsonb := '[]'::jsonb;
  v_row record;
  v_match boolean;
  v_key text;
  v_allowed_values jsonb;
  v_actual_value jsonb;
  v_path_parts text[];
BEGIN
  SELECT onboarding_answers INTO v_answers
  FROM organizations WHERE id = p_org_id;

  IF v_answers IS NULL THEN
    v_answers := '{}'::jsonb;
  END IF;

  IF p_type = 'pipeline' THEN
    FOR v_row IN
      SELECT * FROM onboarding_pipeline_templates
      WHERE is_active = true
      ORDER BY priority DESC, created_at ASC
    LOOP
      v_match := true;
      IF v_row.match_criteria IS NOT NULL AND v_row.match_criteria != '{}'::jsonb THEN
        FOR v_key, v_allowed_values IN
          SELECT * FROM jsonb_each(v_row.match_criteria)
        LOOP
          v_path_parts := string_to_array(v_key, '.');
          v_actual_value := v_answers;
          FOR i IN 1..array_length(v_path_parts, 1) LOOP
            v_actual_value := v_actual_value -> v_path_parts[i];
          END LOOP;
          IF v_actual_value IS NULL OR NOT (v_allowed_values ? (v_actual_value #>> '{}')) THEN
            v_match := false;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      IF v_match THEN
        v_results := v_results || jsonb_build_object(
          'id', v_row.id,
          'name', v_row.name,
          'description', v_row.description,
          'icon', v_row.icon,
          'color', v_row.color,
          'default_pipelines_config', v_row.default_pipelines_config,
          'custom_pipelines', v_row.custom_pipelines,
          'priority', v_row.priority
        );
      END IF;
    END LOOP;
  ELSIF p_type = 'automation' THEN
    FOR v_row IN
      SELECT * FROM onboarding_automation_templates
      WHERE is_active = true
      ORDER BY created_at ASC
    LOOP
      v_match := true;
      IF v_row.match_criteria IS NOT NULL AND v_row.match_criteria != '{}'::jsonb THEN
        FOR v_key, v_allowed_values IN
          SELECT * FROM jsonb_each(v_row.match_criteria)
        LOOP
          v_path_parts := string_to_array(v_key, '.');
          v_actual_value := v_answers;
          FOR i IN 1..array_length(v_path_parts, 1) LOOP
            v_actual_value := v_actual_value -> v_path_parts[i];
          END LOOP;
          IF v_actual_value IS NULL OR NOT (v_allowed_values ? (v_actual_value #>> '{}')) THEN
            v_match := false;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      IF v_match THEN
        v_results := v_results || jsonb_build_object(
          'id', v_row.id,
          'name', v_row.name,
          'description', v_row.description,
          'type', v_row.type,
          'icon', v_row.icon,
          'trigger_type', v_row.trigger_type,
          'customizable_fields', v_row.customizable_fields
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_results;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. RPC: reset_onboarding_state (master only)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reset_onboarding_state(
  p_org_id uuid,
  p_target_state text DEFAULT 'pending_whatsapp'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Only master can reset onboarding state';
  END IF;

  UPDATE organizations
  SET onboarding_state = p_target_state,
      onboarding_completed_at = NULL,
      updated_at = now()
  WHERE id = p_org_id;
END;
$$;
