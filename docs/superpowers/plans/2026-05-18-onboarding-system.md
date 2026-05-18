# Onboarding System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild onboarding as hard-block state machine with master-controlled pipeline and automation templates.

**Architecture:** State machine in `organizations.onboarding_state`. Edge function `onboarding-advance` with action dispatch. Two global template tables (pipeline + automation). Admin UI at `/master/onboarding`. Frontend `OnboardingGate` refactored to read from organizations.

**Tech Stack:** Supabase (Postgres + Edge Functions + RLS), React 18, TypeScript, TanStack Query, shadcn/ui, React Flow (read-only preview)

**Spec:** `docs/superpowers/specs/2026-05-18-onboarding-system-design.md`

---

## File Structure

### Database (migrations)
- `supabase/migrations/20261029000000_onboarding_state_machine.sql` — organizations columns + deprecate trigger + template tables + RPCs
- `supabase/migrations/20261029000001_onboarding_seed_templates.sql` — seed initial pipeline + automation templates

### Edge Function
- `supabase/functions/onboarding-advance/index.ts` — action dispatch entry point
- `supabase/functions/_shared/onboarding-engine.ts` — match engine, pipeline apply, automation apply

### Frontend — Onboarding Flow
- `src/hooks/useOnboardingState.ts` — reads organizations.onboarding_state (replaces useOnboarding)
- `src/hooks/useOnboardingAdvance.ts` — calls onboarding-advance edge function
- `src/components/onboarding/OnboardingGate.tsx` — refactored to read onboarding_state
- `src/components/onboarding/OnboardingFlow.tsx` — new fullscreen flow (replaces OnboardingWizard)
- `src/components/onboarding/steps/OnbStepWhatsApp.tsx` — new WhatsApp gate
- `src/components/onboarding/steps/OnbStepPerfil.tsx` — new quiz gate
- `src/components/onboarding/steps/OnbStepPipelines.tsx` — new pipeline review gate
- `src/components/onboarding/steps/OnbStepAutomacoes.tsx` — new automation activation gate

### Frontend — Admin UI
- `src/pages/master/MasterOnboarding.tsx` — admin page with 3 tabs
- `src/hooks/useOnboardingTemplates.ts` — CRUD hooks for both template tables
- `src/components/master/onboarding/PipelineTemplatesTab.tsx` — CRUD + editor
- `src/components/master/onboarding/PipelineTemplateEditor.tsx` — stages, match criteria, defaults config
- `src/components/master/onboarding/AutomationTemplatesTab.tsx` — CRUD + import
- `src/components/master/onboarding/AutomationTemplateEditor.tsx` — metadata + JSON preview + fields editor
- `src/components/master/onboarding/ImportWorkflowDialog.tsx` — cross-org workflow import
- `src/components/master/onboarding/OnboardingPreviewTab.tsx` — quiz simulator
- `src/components/master/onboarding/MatchCriteriaBuilder.tsx` — reusable match criteria editor

### Modifications
- `supabase/functions/checkout-provision-org/index.ts` — set onboarding_state='pending_whatsapp'
- `src/App.tsx` — add /master/onboarding route
- `src/components/master/MasterSidebar.tsx` — add onboarding nav item
- `src/components/onboarding/OnboardingGate.tsx` — refactor to organizations.onboarding_state

---

## Task 1: Database Migration — State Machine + Template Tables

**Files:**
- Create: `supabase/migrations/20261029000000_onboarding_state_machine.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20261029000000_onboarding_state_machine.sql
-- Onboarding state machine: consolidate into organizations, create template tables

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
  p_type text  -- 'pipeline' or 'automation'
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
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd supabase && npx supabase db lint --level warning` (if available), or manually review SQL for syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261029000000_onboarding_state_machine.sql
git commit -m "feat(onboarding): add state machine migration, template tables, RPCs"
```

---

## Task 2: Seed Initial Templates

**Files:**
- Create: `supabase/migrations/20261029000001_onboarding_seed_templates.sql`

- [ ] **Step 1: Write seed migration**

```sql
-- 20261029000001_onboarding_seed_templates.sql
-- Seed initial pipeline + automation templates for onboarding

-- ══════════════════════════════════════════════════════════════════════════════
-- Pipeline Templates
-- ══════════════════════════════════════════════════════════════════════════════

-- Default fallback: matches everything (priority 0)
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Padrão Vendas',
  'Pipeline padrão para qualquer operação de vendas',
  'TrendingUp',
  '#7dc4e4',
  '{"pipe_whatsapp": {"visible": true}, "pipe_confirmacao": {"visible": false}, "pipe_propostas": {"visible": true}}'::jsonb,
  '[{
    "name": "Vendas",
    "icon": "TrendingUp",
    "color": "#7dc4e4",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Em Contato", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Negociação", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{}'::jsonb,  -- empty = matches everything
  0  -- lowest priority (fallback)
);

-- WhatsApp direct sales
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Vendas WhatsApp Direto',
  'Operação de vendas rápidas via WhatsApp',
  'MessageSquare',
  '#a6d189',
  '{"pipe_whatsapp": {"visible": true, "label": "Oportunidades WhatsApp"}, "pipe_confirmacao": {"visible": false}, "pipe_propostas": {"visible": false}}'::jsonb,
  '[{
    "name": "Vendas WhatsApp",
    "icon": "MessageSquare",
    "color": "#a6d189",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Abordado", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Respondeu", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{"perfil.sells": ["produto", "ambos"]}'::jsonb,
  10
);

-- B2B Consultive (SDR + Closer)
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Vendas Consultivas B2B',
  'SDR qualifica, Closer fecha. Reuniões e propostas.',
  'Users',
  '#ca9ee6',
  '{"pipe_whatsapp": {"visible": true, "label": "Qualificação"}, "pipe_confirmacao": {"visible": true, "label": "Reuniões"}, "pipe_propostas": {"visible": true, "label": "Propostas"}}'::jsonb,
  '[{
    "name": "Qualificação SDR",
    "icon": "UserCheck",
    "color": "#7dc4e4",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Contatado", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Qualificado", "color": "#a6d189", "position": 2, "is_final_positive": true, "is_final_negative": false},
      {"name": "Descartado", "color": "#e78284", "position": 3, "is_final_positive": false, "is_final_negative": true}
    ]
  }, {
    "name": "Fechamento",
    "icon": "Target",
    "color": "#ca9ee6",
    "stages": [
      {"name": "Reunião Marcada", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Proposta Enviada", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Negociação", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{"estrutura.has_sdr": ["true"], "processo.schedules_meeting": ["true"]}'::jsonb,
  20
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Automation Templates
-- ══════════════════════════════════════════════════════════════════════════════

-- Boas-vindas (universal)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Boas-vindas Novo Lead',
  'Envia mensagem automática quando um novo lead entra no pipeline',
  'boas_vindas',
  '👋',
  'lead_created',
  '{}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "lead_created"}},
      {"id": "delay_1", "type": "delay", "position": {"x": 250, "y": 180}, "data": {"amount": 30, "unit": "seconds"}},
      {"id": "action_1", "type": "action", "position": {"x": 250, "y": 310}, "data": {"action_type": "send_whatsapp", "message": "Olá {{nome}}! 👋 Recebemos seu contato e vamos te atender em breve. Enquanto isso, posso te ajudar com algo?"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "delay_1"},
      {"id": "e2", "source": "delay_1", "target": "action_1"}
    ]
  }'::jsonb,
  '[{
    "field_path": "nodes[2].data.message",
    "label": "Mensagem de boas-vindas",
    "type": "textarea",
    "default_value": "Olá {{nome}}! 👋 Recebemos seu contato e vamos te atender em breve. Enquanto isso, posso te ajudar com algo?",
    "placeholder": "Digite a mensagem que novos leads receberão..."
  }]'::jsonb,
  NULL  -- universal
);

-- Follow-up inatividade (universal)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Follow-up 24h',
  'Reengaja lead que não respondeu em 24 horas',
  'follow_up',
  '🔄',
  'lead_no_reply',
  '{"timeout_hours": 24}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "lead_no_reply", "timeout_hours": 24}},
      {"id": "action_1", "type": "action", "position": {"x": 250, "y": 180}, "data": {"action_type": "send_whatsapp", "message": "Oi {{nome}}, tudo bem? Vi que ainda não conseguimos conversar. Posso te ajudar com alguma dúvida?"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "action_1"}
    ]
  }'::jsonb,
  '[{
    "field_path": "nodes[1].data.message",
    "label": "Mensagem de follow-up",
    "type": "textarea",
    "default_value": "Oi {{nome}}, tudo bem? Vi que ainda não conseguimos conversar. Posso te ajudar com alguma dúvida?",
    "placeholder": "Digite a mensagem de reengajamento..."
  }]'::jsonb,
  NULL  -- universal
);

-- Confirmação reunião (match: schedules_meeting = true)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Confirmação de Reunião',
  'Confirma presença D-5, D-3 e D-1 antes da reunião',
  'confirmacao_reuniao',
  '📅',
  'meeting_confirmed',
  '{}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "meeting_confirmed"}},
      {"id": "delay_d5", "type": "delay", "position": {"x": 250, "y": 180}, "data": {"amount": 5, "unit": "days_before_meeting"}},
      {"id": "action_d5", "type": "action", "position": {"x": 250, "y": 310}, "data": {"action_type": "send_whatsapp", "message": "Olá {{nome}}! Confirmando sua reunião para {{data_reuniao}}. Posso confirmar sua presença?"}},
      {"id": "delay_d3", "type": "delay", "position": {"x": 250, "y": 440}, "data": {"amount": 3, "unit": "days_before_meeting"}},
      {"id": "action_d3", "type": "action", "position": {"x": 250, "y": 570}, "data": {"action_type": "send_whatsapp", "message": "Oi {{nome}}, sua reunião é em 3 dias ({{data_reuniao}}). Está tudo confirmado?"}},
      {"id": "delay_d1", "type": "delay", "position": {"x": 250, "y": 700}, "data": {"amount": 1, "unit": "days_before_meeting"}},
      {"id": "action_d1", "type": "action", "position": {"x": 250, "y": 830}, "data": {"action_type": "send_whatsapp", "message": "{{nome}}, sua reunião é amanhã! Confirma presença? 📅"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "delay_d5"},
      {"id": "e2", "source": "delay_d5", "target": "action_d5"},
      {"id": "e3", "source": "action_d5", "target": "delay_d3"},
      {"id": "e4", "source": "delay_d3", "target": "action_d3"},
      {"id": "e5", "source": "action_d3", "target": "delay_d1"},
      {"id": "e6", "source": "delay_d1", "target": "action_d1"}
    ]
  }'::jsonb,
  '[
    {"field_path": "nodes[2].data.message", "label": "Mensagem D-5", "type": "textarea", "default_value": "Olá {{nome}}! Confirmando sua reunião para {{data_reuniao}}. Posso confirmar sua presença?", "placeholder": "Mensagem 5 dias antes..."},
    {"field_path": "nodes[4].data.message", "label": "Mensagem D-3", "type": "textarea", "default_value": "Oi {{nome}}, sua reunião é em 3 dias ({{data_reuniao}}). Está tudo confirmado?", "placeholder": "Mensagem 3 dias antes..."},
    {"field_path": "nodes[6].data.message", "label": "Mensagem D-1", "type": "textarea", "default_value": "{{nome}}, sua reunião é amanhã! Confirma presença? 📅", "placeholder": "Mensagem 1 dia antes..."}
  ]'::jsonb,
  '{"processo.schedules_meeting": ["true"]}'::jsonb
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20261029000001_onboarding_seed_templates.sql
git commit -m "feat(onboarding): seed initial pipeline and automation templates"
```

---

## Task 3: Edge Function — onboarding-advance

**Files:**
- Create: `supabase/functions/onboarding-advance/index.ts`
- Create: `supabase/functions/_shared/onboarding-engine.ts`

- [ ] **Step 1: Write shared onboarding engine**

File: `supabase/functions/_shared/onboarding-engine.ts`

Exports:
- `verifyWhatsAppConnected(supabase, orgId): Promise<boolean>` — checks whatsapp_instances for status='connected'
- `applyPipelineTemplates(supabase, orgId, templates): Promise<{pipelines: any[]}>` — creates pipeline_display_config + custom_pipelines + stages
- `applyAutomationTemplates(supabase, orgId, selections): Promise<{workflows: any[]}>` — clones workflow_definition with customizations into real workflows
- `resolveFieldPath(definition, fieldPath, value): jsonb` — applies customization to workflow definition at field_path

Key logic for `applyPipelineTemplates`:
1. Receive matched templates (from RPC result)
2. For each template's `default_pipelines_config`: INSERT/UPDATE `pipeline_display_config`
3. For each template's `custom_pipelines`: INSERT into `custom_pipelines` + `custom_pipeline_stages`
4. Return created pipelines for frontend display

Key logic for `applyAutomationTemplates`:
1. Receive selections `[{template_id, enabled, customizations}]`
2. Filter enabled only
3. For each: fetch template from DB, clone `workflow_definition`, apply customizations via `resolveFieldPath`
4. INSERT into `workflows` table with `organization_id`, `is_active=true`, `trigger_type`, `trigger_config`

Key logic for `resolveFieldPath`:
1. Parse path like `"nodes[2].data.message"`
2. Navigate JSON structure
3. Set value at path
4. Return modified definition

- [ ] **Step 2: Write edge function entry point**

File: `supabase/functions/onboarding-advance/index.ts`

Pattern: `Deno.serve(withSentry('onboarding-advance', handler))` + CORS + JWT auth.

Actions:
- `advance_whatsapp`: call `verifyWhatsAppConnected`, then `advance_onboarding_state` RPC
- `advance_profile`: validate answers shape, then `advance_onboarding_state` RPC with payload
- `apply_pipelines`: call `match_onboarding_templates` RPC, then `applyPipelineTemplates`, then `advance_onboarding_state` RPC
- `get_automation_templates`: call `match_onboarding_templates` RPC, return results (no state change)
- `activate_automations`: validate min 1 enabled, call `applyAutomationTemplates`, then `advance_onboarding_state` RPC

Auth: JWT required. Extract user's org_id from team_members. Validate org's current state matches expected state for each action.

- [ ] **Step 3: Add to config.toml if JWT verification needed**

Check `supabase/config.toml` for the function entry. This function uses JWT auth (not cron), so default config should work.

- [ ] **Step 4: Test locally**

```bash
supabase functions serve onboarding-advance --env-file .env.local
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/onboarding-advance/index.ts supabase/functions/_shared/onboarding-engine.ts
git commit -m "feat(onboarding): add onboarding-advance edge function with action dispatch"
```

---

## Task 4: Modify checkout-provision-org

**Files:**
- Modify: `supabase/functions/checkout-provision-org/index.ts:370-382`

- [ ] **Step 1: Add onboarding_state to org creation**

In the `.insert({...})` call at line ~372, add `onboarding_state: 'pending_whatsapp'`:

```typescript
const { data: orgRow, error: orgErr } = await supabase
  .from("organizations")
  .insert({
    name: org_name.trim(),
    slug: orgSlug,
    subscription_status: "active",
    subscription_plan: plan_slug,
    plan_id: plan_id,
    payment_customer_id: asaas_customer_id ?? null,
    payment_subscription_id: resolvedSubscriptionId ?? null,
    onboarding_state: "pending_whatsapp",  // NEW
  })
  .select("id, name")
  .single();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/checkout-provision-org/index.ts
git commit -m "feat(onboarding): set onboarding_state=pending_whatsapp on org provision"
```

---

## Task 5: Frontend Hook — useOnboardingState

**Files:**
- Create: `src/hooks/useOnboardingState.ts`

- [ ] **Step 1: Write hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export type OnboardingState =
  | "pending_whatsapp"
  | "pending_profile"
  | "pending_pipelines"
  | "pending_automations"
  | "completed";

export interface OnboardingInfo {
  state: OnboardingState;
  answers: Record<string, Record<string, unknown>> | null;
  completed_at: string | null;
}

export function useOnboardingState() {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["onboarding-state", organizationId],
    queryFn: async (): Promise<OnboardingInfo | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("onboarding_state, onboarding_answers, onboarding_completed_at")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return {
        state: (data as any).onboarding_state as OnboardingState,
        answers: (data as any).onboarding_answers,
        completed_at: (data as any).onboarding_completed_at,
      };
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  return {
    info: query.data,
    state: query.data?.state ?? "completed",
    isLoading: query.isLoading,
    needsOnboarding: !!query.data && query.data.state !== "completed",
    refetch: query.refetch,
  };
}
```

- [ ] **Step 2: Write useOnboardingAdvance hook**

Create: `src/hooks/useOnboardingAdvance.ts`

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

interface AdvanceParams {
  action: "advance_whatsapp" | "advance_profile" | "apply_pipelines" | "get_automation_templates" | "activate_automations";
  payload?: Record<string, unknown>;
}

export function useOnboardingAdvance() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action, payload }: AdvanceParams) => {
      const { data, error } = await supabase.functions.invoke("onboarding-advance", {
        body: { action, org_id: organizationId, payload },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Onboarding advance failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-state", organizationId] });
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useOnboardingState.ts src/hooks/useOnboardingAdvance.ts
git commit -m "feat(onboarding): add useOnboardingState and useOnboardingAdvance hooks"
```

---

## Task 6: Refactor OnboardingGate

**Files:**
- Modify: `src/components/onboarding/OnboardingGate.tsx`

- [ ] **Step 1: Refactor to use onboarding_state**

Replace current implementation that reads from `org_onboarding` table with `useOnboardingState()`.

```typescript
import { ReactNode } from "react";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { OnboardingFlow } from "./OnboardingFlow";

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { state, isLoading, needsOnboarding } = useOnboardingState();
  const { isMaster } = useMasterAuth();
  const { isAdmin } = useIsAdmin();

  if (isMaster) return <>{children}</>;

  if (isLoading) return <TorqueLoader variant="full" />;

  if (!needsOnboarding) return <>{children}</>;

  if (isAdmin) return <OnboardingFlow currentState={state} />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm text-center p-6 space-y-4">
        <TorqueLoader variant="inline" />
        <h2 className="text-lg font-semibold">Configuração em andamento</h2>
        <p className="text-sm text-muted-foreground">
          O administrador está configurando o sistema. Aguarde a conclusão para acessar.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/onboarding/OnboardingGate.tsx
git commit -m "refactor(onboarding): gate reads organizations.onboarding_state"
```

---

## Task 7: OnboardingFlow — Fullscreen Container

**Files:**
- Create: `src/components/onboarding/OnboardingFlow.tsx`

- [ ] **Step 1: Write OnboardingFlow**

Fullscreen container with progress bar. Renders step component based on `currentState`.

```typescript
import type { OnboardingState } from "@/hooks/useOnboardingState";
import { OnbStepWhatsApp } from "./steps/OnbStepWhatsApp";
import { OnbStepPerfil } from "./steps/OnbStepPerfil";
import { OnbStepPipelines } from "./steps/OnbStepPipelines";
import { OnbStepAutomacoes } from "./steps/OnbStepAutomacoes";
import { cn } from "@/lib/utils";

const STEPS: { key: OnboardingState; label: string }[] = [
  { key: "pending_whatsapp", label: "WhatsApp" },
  { key: "pending_profile", label: "Perfil" },
  { key: "pending_pipelines", label: "Pipelines" },
  { key: "pending_automations", label: "Automações" },
];

interface Props {
  currentState: OnboardingState;
}

export function OnboardingFlow({ currentState }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentState);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-400 to-amber-600" />
          <span className="font-bold text-sm">Torque CRM</span>
        </div>
        <span className="text-xs text-muted-foreground">Configuração inicial</span>
      </div>

      {/* Progress */}
      <div className="px-12 pt-6">
        <div className="flex gap-2 mb-1.5">
          {STEPS.map((step, i) => (
            <div
              key={step.key}
              className={cn(
                "flex-1 h-1 rounded-full transition-colors",
                i <= currentIndex ? "bg-amber-500" : "bg-muted"
              )}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {STEPS.map((step, i) => (
            <span
              key={step.key}
              className={cn(
                "text-[11px]",
                i <= currentIndex ? "text-amber-500 font-semibold" : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        {currentState === "pending_whatsapp" && <OnbStepWhatsApp />}
        {currentState === "pending_profile" && <OnbStepPerfil />}
        {currentState === "pending_pipelines" && <OnbStepPipelines />}
        {currentState === "pending_automations" && <OnbStepAutomacoes />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/onboarding/OnboardingFlow.tsx
git commit -m "feat(onboarding): add OnboardingFlow fullscreen container"
```

---

## Task 8: Step Components — WhatsApp + Perfil

**Files:**
- Create: `src/components/onboarding/steps/OnbStepWhatsApp.tsx`
- Create: `src/components/onboarding/steps/OnbStepPerfil.tsx`

- [ ] **Step 1: Write OnbStepWhatsApp**

Reuse existing WhatsApp connection logic from `StepWhatsApp.tsx`:
- Instance name input
- QR code display with polling
- On connected: call `useOnboardingAdvance({ action: "advance_whatsapp" })`
- No skip button

Key difference from old step: calls edge function instead of saving to org_onboarding.

- [ ] **Step 2: Write OnbStepPerfil**

4 questions, one at a time. Cards selectable. Animated transitions.

Questions:
1. `perfil.sells`: "produto" | "servico" | "ambos"
2. `perfil.segment`: "industria" | "distribuidora" | "saas" | "consultoria" | "agencia" | "outro"
3. `estrutura.has_sdr` + `estrutura.has_closer`: boolean combo (Solo / Time sem SDR / Time com SDR+Closer)
4. `processo.schedules_meeting` + `processo.uses_proposal`: boolean combo

On complete: call `useOnboardingAdvance({ action: "advance_profile", payload: { answers } })`

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/steps/OnbStepWhatsApp.tsx src/components/onboarding/steps/OnbStepPerfil.tsx
git commit -m "feat(onboarding): add WhatsApp and Profile step components"
```

---

## Task 9: Step Components — Pipelines + Automações

**Files:**
- Create: `src/components/onboarding/steps/OnbStepPipelines.tsx`
- Create: `src/components/onboarding/steps/OnbStepAutomacoes.tsx`

- [ ] **Step 1: Write OnbStepPipelines**

On mount: call `useOnboardingAdvance({ action: "apply_pipelines" })`. Show loading while applying.
Display result: list of created pipelines with stages as colored badges.
Button: "Confirmar e continuar" (state already advanced by apply_pipelines).

- [ ] **Step 2: Write OnbStepAutomacoes**

On mount: call `useOnboardingAdvance({ action: "get_automation_templates" })`.
Display: list of automation templates with toggle + textarea for customizable_fields.
Minimum 1 active to proceed.
On submit: call `useOnboardingAdvance({ action: "activate_automations", payload: { selections } })`.

Each automation card:
- Icon + name + description
- Toggle switch
- When active: show textarea per customizable_field with default_value pre-filled
- Support `{{nome}}`, `{{empresa}}` variables (show hint)

- [ ] **Step 3: Commit**

```bash
git add src/components/onboarding/steps/OnbStepPipelines.tsx src/components/onboarding/steps/OnbStepAutomacoes.tsx
git commit -m "feat(onboarding): add Pipeline review and Automation activation steps"
```

---

## Task 10: Admin Page — MasterOnboarding + Route

**Files:**
- Create: `src/pages/master/MasterOnboarding.tsx`
- Modify: `src/App.tsx:671` — add route
- Modify: `src/components/master/MasterSidebar.tsx:38-49` — add nav item

- [ ] **Step 1: Create MasterOnboarding page shell**

Page with `Tabs` component (shadcn). 3 tabs: "Pipeline Templates", "Automação Templates", "Preview".

Follow pattern from `MasterFeatures.tsx`: same imports, same structure.

```typescript
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PipelineTemplatesTab } from "@/components/master/onboarding/PipelineTemplatesTab";
import { AutomationTemplatesTab } from "@/components/master/onboarding/AutomationTemplatesTab";
import { OnboardingPreviewTab } from "@/components/master/onboarding/OnboardingPreviewTab";

export default function MasterOnboarding() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Onboarding Templates</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie templates de pipeline e automação para o onboarding de novas organizações
        </p>
      </div>
      <Tabs defaultValue="pipelines">
        <TabsList>
          <TabsTrigger value="pipelines">Pipeline Templates</TabsTrigger>
          <TabsTrigger value="automations">Automação Templates</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="pipelines"><PipelineTemplatesTab /></TabsContent>
        <TabsContent value="automations"><AutomationTemplatesTab /></TabsContent>
        <TabsContent value="preview"><OnboardingPreviewTab /></TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

After line ~674 (`whatsapp-health` route), add:
```typescript
<Route path="onboarding" element={<MasterOnboarding />} />
```

Add lazy import at top:
```typescript
const MasterOnboarding = lazy(() => import("@/pages/master/MasterOnboarding"));
```

- [ ] **Step 3: Add sidebar nav item in MasterSidebar.tsx**

Add to `allNavItems` array:
```typescript
{ label: "Onboarding", icon: Rocket, path: "/master/onboarding", permission: "features" },
```

Import `Rocket` from lucide-react.

- [ ] **Step 4: Commit**

```bash
git add src/pages/master/MasterOnboarding.tsx src/App.tsx src/components/master/MasterSidebar.tsx
git commit -m "feat(onboarding): add MasterOnboarding page and route"
```

---

## Task 11: CRUD Hooks — useOnboardingTemplates

**Files:**
- Create: `src/hooks/useOnboardingTemplates.ts`

- [ ] **Step 1: Write template CRUD hooks**

```typescript
// Pipeline template hooks
export function usePipelineTemplates()  // useQuery: SELECT * FROM onboarding_pipeline_templates ORDER BY priority DESC
export function useCreatePipelineTemplate()  // useMutation: INSERT
export function useUpdatePipelineTemplate()  // useMutation: UPDATE
export function useDeletePipelineTemplate()  // useMutation: DELETE

// Automation template hooks
export function useAutomationTemplates()  // useQuery: SELECT * FROM onboarding_automation_templates ORDER BY created_at
export function useCreateAutomationTemplate()  // useMutation: INSERT
export function useUpdateAutomationTemplate()  // useMutation: UPDATE
export function useDeleteAutomationTemplate()  // useMutation: DELETE

// Import workflow from org
export function useOrgWorkflows(orgId: string | null)  // useQuery: SELECT * FROM workflows WHERE organization_id = orgId (master ghost policy)
export function useAllOrganizations()  // useQuery: SELECT id, name FROM organizations ORDER BY name (master ghost policy)
```

All hooks invalidate `["onboarding-pipeline-templates"]` or `["onboarding-automation-templates"]` queryKey on success.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useOnboardingTemplates.ts
git commit -m "feat(onboarding): add CRUD hooks for template management"
```

---

## Task 12: Admin — Pipeline Templates Tab

**Files:**
- Create: `src/components/master/onboarding/PipelineTemplatesTab.tsx`
- Create: `src/components/master/onboarding/PipelineTemplateEditor.tsx`
- Create: `src/components/master/onboarding/MatchCriteriaBuilder.tsx`

- [ ] **Step 1: Write PipelineTemplatesTab**

List of pipeline template cards. Each shows: name, color dot, stages as badges, match_criteria code, priority, active badge. Actions: Edit (opens editor dialog), Delete (with confirmation).

Header: title + "+ Novo Template" button.

- [ ] **Step 2: Write PipelineTemplateEditor**

Dialog with form:
- Name, description inputs
- Icon picker (lucide icon name, can be simple text input)
- Color palette (5-6 preset colors as clickable circles)
- Default pipelines config: 3 toggles (pipe_whatsapp, pipe_confirmacao, pipe_propostas) with optional label override
- Custom pipelines section: array of pipeline objects, each with:
  - Name, icon, color
  - Stages: draggable list with name, color, position, is_final_positive/negative checkboxes
  - Add stage button
- Match criteria: MatchCriteriaBuilder component
- Priority: number input

- [ ] **Step 3: Write MatchCriteriaBuilder**

Reusable component. Renders list of criteria rows: [field_path dropdown] [operator] [values multi-select].

Field path options: `perfil.sells`, `perfil.segment`, `estrutura.has_sdr`, `estrutura.has_closer`, `processo.schedules_meeting`, `processo.uses_proposal`.

Values are pre-defined per field (e.g., perfil.sells → ["produto", "servico", "ambos"]).

Output: `{ "perfil.sells": ["produto"], "estrutura.has_sdr": ["true"] }`

- [ ] **Step 4: Commit**

```bash
git add src/components/master/onboarding/PipelineTemplatesTab.tsx src/components/master/onboarding/PipelineTemplateEditor.tsx src/components/master/onboarding/MatchCriteriaBuilder.tsx
git commit -m "feat(onboarding): add pipeline templates admin UI with editor and criteria builder"
```

---

## Task 13: Admin — Automation Templates Tab

**Files:**
- Create: `src/components/master/onboarding/AutomationTemplatesTab.tsx`
- Create: `src/components/master/onboarding/AutomationTemplateEditor.tsx`
- Create: `src/components/master/onboarding/ImportWorkflowDialog.tsx`

- [ ] **Step 1: Write AutomationTemplatesTab**

List of automation template cards. Each shows: icon, name, type badge, trigger_type, node count (parsed from workflow_definition), customizable_fields count, active badge. Actions: Edit, Delete.

Header: title + "Importar de org" button + "+ Criar do zero" button.

- [ ] **Step 2: Write AutomationTemplateEditor**

Dialog/page with:
- Metadata: name, description, type (select: boas_vindas/follow_up/confirmacao_reuniao), icon
- Trigger: trigger_type (select), trigger_config (JSON editor or simple form)
- Match criteria: MatchCriteriaBuilder component (reused from pipelines)
- Workflow definition: JSON preview (formatted, read-only `<pre>` block with syntax highlighting via simple CSS)
- Customizable fields: list of field definitions:
  - field_path (text input)
  - label (text input)
  - type (select: textarea/text/number)
  - default_value (textarea)
  - placeholder (text input)
  - Add/remove field buttons

- [ ] **Step 3: Write ImportWorkflowDialog**

Dialog with 2 steps:
1. Select org: dropdown using `useAllOrganizations()`
2. Select workflow: list using `useOrgWorkflows(selectedOrgId)` with radio selection
3. "Importar como template" button: copies workflow's `definition`, `trigger_type`, `trigger_config` into a new automation template
4. Info callout: "Cópia independente — alterações não afetam org original"

- [ ] **Step 4: Commit**

```bash
git add src/components/master/onboarding/AutomationTemplatesTab.tsx src/components/master/onboarding/AutomationTemplateEditor.tsx src/components/master/onboarding/ImportWorkflowDialog.tsx
git commit -m "feat(onboarding): add automation templates admin UI with import from org"
```

---

## Task 14: Admin — Preview Tab

**Files:**
- Create: `src/components/master/onboarding/OnboardingPreviewTab.tsx`

- [ ] **Step 1: Write OnboardingPreviewTab**

Quiz simulator:
- Same 4 questions as OnbStepPerfil (can extract question config to shared constant)
- On complete: calls `match_onboarding_templates` RPC with simulated answers (via supabase.rpc)
- Shows results: which pipeline templates matched + which automation templates matched
- Each result shown as card with template details

Note: This calls the RPC directly (master has access). No need for edge function.

- [ ] **Step 2: Commit**

```bash
git add src/components/master/onboarding/OnboardingPreviewTab.tsx
git commit -m "feat(onboarding): add onboarding preview tab with quiz simulator"
```

---

## Task 15: Integration Testing

**Files:**
- Create: `tests/integration/onboarding-state-machine.test.ts`

- [ ] **Step 1: Write state machine tests**

Test cases:
1. New org gets onboarding_state='pending_whatsapp' (via checkout-provision-org simulation)
2. `advance_onboarding_state` RPC: valid transitions succeed
3. `advance_onboarding_state` RPC: invalid transitions fail (e.g., skip from whatsapp to automations)
4. `advance_onboarding_state` RPC: state mismatch raises exception
5. `match_onboarding_templates` RPC: returns correct templates for given answers
6. `match_onboarding_templates` RPC: fallback template (empty criteria) always matches
7. Pipeline template RLS: non-master gets 0 rows on direct SELECT
8. Automation template RLS: non-master gets 0 rows on direct SELECT
9. Master can CRUD both template tables
10. `reset_onboarding_state` RPC: master can reset, non-master cannot

- [ ] **Step 2: Run tests**

```bash
npm run test:integration -- --grep "onboarding"
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/onboarding-state-machine.test.ts
git commit -m "test(onboarding): add integration tests for state machine and template matching"
```

---

## Task 16: Final Wiring + Cleanup

**Files:**
- Modify: `src/App.tsx` — remove old `/onboarding` route (OnboardingGate handles it inline now)
- Verify: `src/components/onboarding/OnboardingGate.tsx` — no more Navigate to /onboarding

- [ ] **Step 1: Remove old onboarding route from App.tsx**

The old route at line ~230 (`path="/onboarding"` → `OnboardingWizard`) should be removed. OnboardingGate now renders OnboardingFlow inline, not via route navigation.

- [ ] **Step 2: Verify OnboardingGate doesn't use Navigate**

New gate renders `<OnboardingFlow>` directly instead of `<Navigate to="/onboarding">`.

- [ ] **Step 3: Verify existing onboarding files aren't imported anywhere else**

```bash
grep -rn "OnboardingWizard\|useOnboarding" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "OnboardingState\|OnboardingAdvance\|OnboardingFlow"
```

Keep old files but don't import them. Can be deleted in future cleanup PR.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(onboarding): wire up new flow, remove old route, complete integration"
```

---

## Summary

| Task | Description | Estimated effort |
|------|------------|-----------------|
| 1 | Migration: state machine + template tables + RPCs | 2-3h |
| 2 | Migration: seed templates | 1h |
| 3 | Edge function: onboarding-advance | 3-4h |
| 4 | Modify checkout-provision-org | 15min |
| 5 | Hooks: useOnboardingState + useOnboardingAdvance | 1h |
| 6 | Refactor OnboardingGate | 30min |
| 7 | OnboardingFlow container | 1h |
| 8 | Steps: WhatsApp + Perfil | 3-4h |
| 9 | Steps: Pipelines + Automações | 3-4h |
| 10 | Admin page + route + sidebar | 1h |
| 11 | CRUD hooks: useOnboardingTemplates | 1-2h |
| 12 | Admin: Pipeline Templates tab + editor | 4-5h |
| 13 | Admin: Automation Templates tab + import | 4-5h |
| 14 | Admin: Preview tab | 2h |
| 15 | Integration tests | 2-3h |
| 16 | Final wiring + cleanup | 1h |
| **Total** | | **~30-35h** |
