-- rollback/20270908001000_inversao_do_silo_custom.sql
--
-- Reverte SCRUM-621: recria as TABELAS custom_pipe_entries e custom_pipelines
-- a partir da fonte (pipeline_entries/pipelines + config), devolve FKs, recria
-- os triggers/funções do espelho (DDL medido em prod 2026-09-02), restaura
-- apply_stage_checklist/seed_demo_data/delete_custom_pipeline e derruba as
-- views + INSTEAD OF + helpers.
--
-- PERDA CONHECIDA E ACEITA:
--   · A linha reinserida do par descasado (dd91cd35…) volta como linha de
--     custom_pipe_entries com o uuid NOVO (o antigo segue com o card de
--     sistema) — a colisão de id que motivou a reinserção não é reversível.
--   · Cards custom criados DIRETO em pipeline_entries entre a migration e o
--     rollback voltam para custom_pipe_entries normalmente (a recriação lê a
--     fonte); updated_at das linhas reconciliadas não volta ao valor antigo.
--   · Os 16 cards pe-only (manutencao-bikes) PASSAM a ter linha custom — eram
--     drift, não contrato.
--
-- ATENÇÃO: se o front desta janela (subscription pipeline_entries + FK-hint
-- pipeline_entries_assigned_to_fkey) já estiver no ar, reverter o banco exige
-- reverter o front junto — o hint antigo volta a existir, o novo continua
-- válido, mas o realtime volta a ser no-op.
--
-- metric-lint-allow: rollback one-off (SCRUM-621) — não é métrica

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipe_entries')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM621: custom_pipe_entries não é view — migration não aplicada?';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Caem as views (INSTEAD OF junto), helpers e os triggers novos da base
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW public.custom_pipe_entries;
DROP VIEW public.custom_pipelines;
DROP FUNCTION IF EXISTS public.custom_pipe_entries_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipe_entries_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipe_entries_delete_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_delete_fn();
DROP FUNCTION IF EXISTS public.custom_pipelines_check_vocab(text, text, text);
DROP FUNCTION IF EXISTS public.custom_pipelines_extras(text, timestamptz, timestamptz, text, integer, integer, integer, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.fn_assert_member_in_org(uuid, uuid, text);

DROP TRIGGER IF EXISTS trg_workflow_pipeline_custom_entry ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_workflow_pipeline_custom_stage_change ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.trigger_workflow_pipeline_custom_entry();
DROP FUNCTION IF EXISTS public.trigger_workflow_pipeline_custom_stage_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recria custom_pipelines (DDL medido em prod 2026-09-02) + dados da fonte
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.custom_pipelines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  slug                text NOT NULL,
  description         text,
  icon                text DEFAULT 'kanban',
  color               text DEFAULT '#3b82f6',
  position            integer DEFAULT 0,
  is_active           boolean DEFAULT true,
  created_by          uuid REFERENCES public.profiles(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  lifecycle_type      text NOT NULL DEFAULT 'permanent'
                      CONSTRAINT custom_pipelines_lifecycle_type_check
                      CHECK (lifecycle_type IN ('permanent', 'temporary')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  status              text NOT NULL DEFAULT 'active'
                      CONSTRAINT custom_pipelines_status_check
                      CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  team_goal           integer,
  individual_goal     integer,
  bonus_value         integer,
  bonus_description   text,
  objective_pipe_type text,
  objective_stage_key text,
  template_type       text
                      CONSTRAINT custom_pipelines_template_type_check
                      CHECK (template_type IN ('indicacao', 'prospeccao', 'reativacao')),
  lead_source_config  jsonb
);

INSERT INTO public.custom_pipelines (
  id, organization_id, name, slug, description, icon, color, position,
  is_active, created_by, created_at, updated_at, lifecycle_type, starts_at,
  ends_at, status, team_goal, individual_goal, bonus_value, bonus_description,
  objective_pipe_type, objective_stage_key, template_type, lead_source_config)
SELECT
  p.id, p.organization_id, p.name, p.slug, p.description, p.icon, p.color,
  p.display_order - 3, p.is_active, p.created_by, p.created_at, p.updated_at,
  COALESCE(p.config->>'lifecycle_type', 'permanent'),
  (p.config->>'starts_at')::timestamptz,
  (p.config->>'ends_at')::timestamptz,
  COALESCE(p.config->>'status', 'active'),
  (p.config->>'team_goal')::integer,
  (p.config->>'individual_goal')::integer,
  (p.config->>'bonus_value')::integer,
  p.config->>'bonus_description',
  p.config->>'objective_pipe_type',
  p.config->>'objective_stage_key',
  p.config->>'template_type',
  p.config->'lead_source_config'
FROM public.pipelines p
WHERE p.type = 'custom';

CREATE UNIQUE INDEX custom_pipelines_org_slug_active_idx
  ON public.custom_pipelines (organization_id, slug) WHERE is_active = true;
CREATE INDEX idx_custom_pipelines_active    ON public.custom_pipelines (organization_id, is_active);
CREATE INDEX idx_custom_pipelines_ends_at   ON public.custom_pipelines (ends_at)
  WHERE lifecycle_type = 'temporary' AND status = 'active';
CREATE INDEX idx_custom_pipelines_lifecycle ON public.custom_pipelines (organization_id, lifecycle_type);
CREATE INDEX idx_custom_pipelines_org       ON public.custom_pipelines (organization_id);
CREATE INDEX idx_custom_pipelines_status    ON public.custom_pipelines (organization_id, status)
  WHERE lifecycle_type = 'temporary';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Recria custom_pipe_entries + dados da fonte
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.custom_pipe_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id             uuid NOT NULL REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  lead_id                 uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage_id                uuid NOT NULL REFERENCES public.pipeline_stages(id),
  assigned_to             uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  notes                   text,
  entered_at              timestamptz DEFAULT now(),
  stage_changed_at        timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  pre_sale_responsible_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  sale_responsible_id     uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  deal_id                 uuid REFERENCES public.deals(id) ON DELETE SET NULL
);

-- Cards custom sem stage_id não existem na fonte (asserção 11.5 da migration);
-- o filtro é cinto de segurança pra não violar o NOT NULL na volta.
INSERT INTO public.custom_pipe_entries (
  id, organization_id, pipeline_id, lead_id, stage_id, assigned_to, notes,
  entered_at, stage_changed_at, created_at, updated_at,
  pre_sale_responsible_id, sale_responsible_id, deal_id)
SELECT
  pe.id, pe.organization_id, pe.pipeline_id, pe.lead_id, pe.stage_id,
  pe.assigned_to, pe.notes, pe.entered_at, pe.stage_changed_at,
  pe.created_at, pe.updated_at,
  (pe.metadata->>'pre_sale_responsible_id')::uuid,
  (pe.metadata->>'sale_responsible_id')::uuid,
  pe.deal_id
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
WHERE pe.stage_id IS NOT NULL AND pe.lead_id IS NOT NULL;

CREATE INDEX idx_custom_pipe_entries_assigned ON public.custom_pipe_entries (assigned_to);
CREATE INDEX idx_custom_pipe_entries_deal     ON public.custom_pipe_entries (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_custom_pipe_entries_lead     ON public.custom_pipe_entries (lead_id);
CREATE INDEX idx_custom_pipe_entries_org      ON public.custom_pipe_entries (organization_id);
CREATE INDEX idx_custom_pipe_entries_pipeline ON public.custom_pipe_entries (pipeline_id);
CREATE INDEX idx_custom_pipe_entries_stage    ON public.custom_pipe_entries (stage_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. RLS + grants (medidos em prod 2026-09-02)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.custom_pipelines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_pipe_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members podem gerenciar custom pipelines"
  ON public.custom_pipelines FOR ALL TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY master_ghost_all_custom_pipelines
  ON public.custom_pipelines FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY master_ghost_select_custom_pipelines
  ON public.custom_pipelines FOR SELECT
  USING ((SELECT public.is_master_user()));

CREATE POLICY "Team members podem gerenciar custom pipe entries"
  ON public.custom_pipe_entries FOR ALL TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY master_ghost_all_custom_pipe_entries
  ON public.custom_pipe_entries FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY master_ghost_select_custom_pipe_entries
  ON public.custom_pipe_entries FOR SELECT
  USING ((SELECT public.is_master_user()));

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.custom_pipelines    TO authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER ON public.custom_pipelines    TO anon;
GRANT SELECT ON public.custom_pipelines TO mcp_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.custom_pipe_entries TO authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER ON public.custom_pipe_entries TO anon;
GRANT SELECT ON public.custom_pipe_entries TO mcp_readonly;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. FKs de volta para custom_pipelines
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_source_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipe_transitions_source_pipeline_id_fkey
    FOREIGN KEY (source_pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE CASCADE;
ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_target_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipe_transitions_target_pipeline_id_fkey
    FOREIGN KEY (target_pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE CASCADE;
ALTER TABLE public.custom_pipeline_members
  DROP CONSTRAINT custom_pipeline_members_pipeline_id_fkey,
  ADD CONSTRAINT custom_pipeline_members_pipeline_id_fkey
    FOREIGN KEY (pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE CASCADE;
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT pipeline_stages_target_pipeline_id_fkey,
  ADD CONSTRAINT pipeline_stages_target_pipeline_id_fkey
    FOREIGN KEY (target_pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Triggers/funções do espelho de volta (fonte: pg_get_functiondef em prod)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_custom_pipe_to_entries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_stage_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipeline_entries WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT stage_key INTO v_stage_key
  FROM public.custom_pipeline_stages
  WHERE id = NEW.stage_id;

  INSERT INTO public.pipeline_entries (
    id, organization_id, pipeline_id, lead_id, stage_key,
    assigned_to, notes, metadata, entered_at, stage_changed_at,
    created_at, updated_at, deal_id
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.pipeline_id, NEW.lead_id,
    COALESCE(v_stage_key, 'unknown'), NEW.assigned_to, NEW.notes, '{}',
    NEW.entered_at, NEW.stage_changed_at, NEW.created_at, NEW.updated_at,
    NEW.deal_id
  )
  ON CONFLICT (id) DO UPDATE SET
    stage_key = EXCLUDED.stage_key,
    assigned_to = EXCLUDED.assigned_to,
    notes = EXCLUDED.notes,
    stage_changed_at = EXCLUDED.stage_changed_at,
    updated_at = EXCLUDED.updated_at,
    deal_id = EXCLUDED.deal_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_custom_pipeline_to_pipelines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.pipelines WHERE id = OLD.id AND type = 'custom';
    RETURN OLD;
  END IF;

  INSERT INTO public.pipelines (
    id, organization_id, name, slug, type, description,
    icon, color, display_order, is_active,
    created_by, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.name, NEW.slug, 'custom', NEW.description,
    NEW.icon, NEW.color, NEW.position + 3, NEW.is_active,
    NEW.created_by, NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    display_order = EXCLUDED.display_order,
    is_active = EXCLUDED.is_active,
    updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.custom_pipe_entries
     SET deal_id = NEW.deal_id
   WHERE id = NEW.id
     AND organization_id = NEW.organization_id
     AND pipeline_id = NEW.pipeline_id
     AND deal_id IS DISTINCT FROM NEW.deal_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_workflow_custom_pipe_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'lead_created', NEW.lead_id,
    jsonb_build_object('trigger', 'lead_created', 'pipeline_id', NEW.pipeline_id::text)
  );
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
      'pipeline_id', NEW.pipeline_id::text,
      'to_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = NEW.stage_id LIMIT 1))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_workflow_custom_pipe_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_entry_id UUID;
  v_deal_id UUID;
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    SELECT pe.id, pe.deal_id INTO v_entry_id, v_deal_id
    FROM public.pipeline_entries pe
    WHERE pe.pipeline_id = NEW.pipeline_id
      AND pe.lead_id = NEW.lead_id
    ORDER BY (pe.closed_at IS NULL) DESC, pe.stage_changed_at DESC NULLS LAST, pe.created_at DESC
    LIMIT 1;

    PERFORM public.fire_workflow_trigger(
      NEW.organization_id, 'stage_changed', NEW.lead_id,
      jsonb_build_object('trigger', 'stage_changed',
        'pipeline_id', NEW.pipeline_id::text,
        'from_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = OLD.stage_id LIMIT 1),
        'to_stage', (SELECT stage_key FROM public.custom_pipeline_stages WHERE id = NEW.stage_id LIMIT 1),
        'pipeline_entry_id', v_entry_id,
        'deal_id', v_deal_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_stage_checklist_custom
  AFTER INSERT OR UPDATE OF stage_id ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();
CREATE TRIGGER trg_assert_member_same_org_custom_pipe_entries
  BEFORE INSERT OR UPDATE OF assigned_to, pre_sale_responsible_id, sale_responsible_id
  ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_assert_member_same_org();
CREATE TRIGGER trg_custom_pipe_entries_updated_at
  BEFORE UPDATE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sync_custom_pipe_to_entries
  AFTER INSERT OR DELETE OR UPDATE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_custom_pipe_to_entries();
CREATE TRIGGER trg_workflow_custom_pipe_entry
  AFTER INSERT ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_workflow_custom_pipe_entry();
CREATE TRIGGER trg_workflow_custom_pipe_stage_change
  AFTER UPDATE ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_workflow_custom_pipe_stage_change();

CREATE TRIGGER trg_custom_pipelines_updated_at
  BEFORE UPDATE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sync_custom_pipeline
  AFTER INSERT OR DELETE OR UPDATE ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.sync_custom_pipeline_to_pipelines();

CREATE TRIGGER trg_sync_deal_id_to_custom_pipe_entry
  AFTER UPDATE OF deal_id ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.deal_id IS DISTINCT FROM NEW.deal_id)
  EXECUTE FUNCTION public.fn_sync_deal_id_to_custom_pipe_entry();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. apply_stage_checklist com o ramo custom de volta (versão pré-migration)
--    + trigger da base de volta a OF stage_key
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.apply_stage_checklist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
  v_entry_id uuid;
  v_deal_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' THEN
      IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'custom_pipe_entries' THEN
      IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.slug
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;

    v_entry_id := NEW.id;
    v_deal_id  := NEW.deal_id;

  ELSIF TG_TABLE_NAME = 'custom_pipe_entries' THEN
    SELECT cps.checklist_template_id, cps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.custom_pipeline_stages cps
    WHERE cps.id = NEW.stage_id
    LIMIT 1;

    SELECT pe.id, pe.deal_id INTO v_entry_id, v_deal_id
    FROM public.pipeline_entries pe
    WHERE pe.pipeline_id = NEW.pipeline_id
      AND pe.lead_id = NEW.lead_id
    ORDER BY (pe.closed_at IS NULL) DESC, pe.stage_changed_at DESC NULLS LAST, pe.created_at DESC
    LIMIT 1;
  END IF;

  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_entry_id IS NOT NULL THEN
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, v_entry_id, v_deal_id, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (pipeline_entry_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND pipeline_entry_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  ELSE
    INSERT INTO public.checklists (
      organization_id, lead_id, pipeline_entry_id, deal_id,
      source_template_id, title, description, created_by
    )
    SELECT t.organization_id, NEW.lead_id, NULL, NULL, t.id, t.title, t.description, NULL
    FROM public.checklists t
    WHERE t.id = v_template_id
      AND t.lead_id IS NULL
      AND t.organization_id = NEW.organization_id
    ON CONFLICT (lead_id, source_template_id)
      WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL AND pipeline_entry_id IS NULL
    DO NOTHING
    RETURNING id INTO v_new_checklist_id;
  END IF;

  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position, template_item_id)
    SELECT v_new_checklist_id, ci.title, ci.position, ci.id
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER trg_apply_stage_checklist_pipeline ON public.pipeline_entries;
CREATE TRIGGER trg_apply_stage_checklist_pipeline
  AFTER INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. seed_demo_data e delete_custom_pipeline de volta (versões pré-migration,
--    fonte: pg_get_functiondef em prod 2026-09-02)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_is_admin     boolean;
  v_tag_id       uuid;
  v_pipeline_id  uuid;
  v_leads_created int  := 0;
  v_lead_id      uuid;
  i              int;
  v_already_seeded boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_caller_id AND organization_id = p_org_id AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege: apenas admin pode popular dados demo'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.lead_tags lt ON lt.lead_id = l.id
    JOIN public.tags t ON t.id = lt.tag_id
    WHERE l.organization_id = p_org_id AND t.name = 'demo' AND t.organization_id = p_org_id
    LIMIT 1
  ) INTO v_already_seeded;
  IF v_already_seeded THEN
    RETURN jsonb_build_object('already_seeded', true, 'leads', 0);
  END IF;

  INSERT INTO public.tags (organization_id, name, color)
  VALUES (p_org_id, 'demo', '#facc15')
  ON CONFLICT (name, organization_id) DO NOTHING
  RETURNING id INTO v_tag_id;
  IF v_tag_id IS NULL THEN
    SELECT id INTO v_tag_id FROM public.tags WHERE organization_id = p_org_id AND name = 'demo';
  END IF;

  INSERT INTO public.custom_pipelines (organization_id, name, slug, description, color)
  VALUES (p_org_id, 'Demo Pipeline', 'demo-pipeline',
          'Pipeline criado automaticamente com dados de demonstração', '#facc15')
  ON CONFLICT (organization_id, slug) DO NOTHING
  RETURNING id INTO v_pipeline_id;
  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id FROM public.custom_pipelines
    WHERE organization_id = p_org_id AND slug = 'demo-pipeline';
  END IF;

  FOR i IN 1..10 LOOP
    INSERT INTO public.leads (organization_id, name, company, phone, email, origin, rating)
    VALUES (
      p_org_id,
      '[DEMO] Lead ' || i || ' — ' || (ARRAY[
        'João Silva', 'Maria Oliveira', 'Carlos Santos', 'Ana Costa',
        'Pedro Lima', 'Fernanda Rocha', 'Ricardo Mendes', 'Juliana Alves',
        'Marcos Pereira', 'Patrícia Souza'])[i],
      (ARRAY[
        'Distribuidora Alpha', 'Metalúrgica Beta', 'Logística Gamma',
        'Comércio Delta', 'Fábrica Epsilon', 'Transportes Zeta',
        'Indústria Eta', 'Atacado Theta', 'Importadora Iota', 'Serviços Kappa'])[i],
      '+55 11 99999-90' || LPAD(i::text, 2, '0'),
      'demo' || i || '@torquecrm-demo.com',
      'outro',
      CASE WHEN i <= 3 THEN 5 WHEN i <= 6 THEN 3 ELSE 1 END
    )
    RETURNING id INTO v_lead_id;

    INSERT INTO public.lead_tags (lead_id, tag_id)
    VALUES (v_lead_id, v_tag_id)
    ON CONFLICT DO NOTHING;

    v_leads_created := v_leads_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'already_seeded', false,
    'leads',       v_leads_created,
    'tag_id',      v_tag_id,
    'pipeline_id', v_pipeline_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_org       uuid;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.custom_pipelines
   WHERE id = p_pipeline_id
     FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), min(coalesce(p.name, '(sem nome)') || ' / ' || coalesce(l.name, e.lead_id::text))
    INTO v_invasores, v_exemplo
    FROM public.custom_pipe_entries e
    JOIN public.custom_pipeline_stages s ON s.id = e.stage_id
    LEFT JOIN public.custom_pipelines p ON p.id = e.pipeline_id
    LEFT JOIN public.leads l            ON l.id = e.lead_id
   WHERE s.pipeline_id = p_pipeline_id
     AND e.pipeline_id <> p_pipeline_id;

  IF v_invasores > 0 THEN
    RAISE EXCEPTION
      'card de outro funil parado numa etapa deste: % card(s), ex. "%". Mova-os para o funil de origem antes de excluir.',
      v_invasores, v_exemplo
      USING ERRCODE = 'P0001';
  END IF;

  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  UPDATE public.workflows w
     SET is_active = false, updated_at = now()
   WHERE w.organization_id = v_org
     AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.blast_plans
     SET post_send_target = NULL, updated_at = now()
   WHERE organization_id = v_org
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  DELETE FROM public.custom_pipe_entries    WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.custom_pipeline_stages WHERE pipeline_id = p_pipeline_id;

  DELETE FROM public.custom_pipelines WHERE id = p_pipeline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Limpa o config das chaves que voltaram pra tabela
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.pipelines
   SET config = config
                - 'lifecycle_type' - 'starts_at' - 'ends_at' - 'status'
                - 'team_goal' - 'individual_goal' - 'bonus_value'
                - 'bonus_description' - 'objective_pipe_type'
                - 'objective_stage_key' - 'template_type' - 'lead_source_config'
 WHERE type = 'custom'
   AND config ?| ARRAY['lifecycle_type','starts_at','ends_at','status','team_goal',
                       'individual_goal','bonus_value','bonus_description',
                       'objective_pipe_type','objective_stage_key','template_type',
                       'lead_source_config'];

-- Sanidade final.
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipe_entries')) IS DISTINCT FROM 'r'
     OR (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.custom_pipelines')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM621: tabelas não voltaram';
  END IF;
  IF (SELECT count(*) FROM public.custom_pipelines) <>
     (SELECT count(*) FROM public.pipelines WHERE type = 'custom') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM621: contagem de funis diverge da fonte';
  END IF;
END;
$$;
