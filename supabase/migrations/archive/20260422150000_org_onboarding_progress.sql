-- ============================================================
-- Migration: org_onboarding_progress
-- Onda 3.2 — Sprint 3.2.3
--
-- Checklist persistente de onboarding por organização.
-- Responsabilidade disjunta de org_onboarding (quiz one-shot).
--
-- Security: todas SECURITY DEFINER com search_path fixo.
-- ============================================================

-- ─── Tabela ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_onboarding_progress (
  organization_id     uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_connect_whatsapp   boolean NOT NULL DEFAULT false,
  step_import_lead        boolean NOT NULL DEFAULT false,
  step_configure_copilot  boolean NOT NULL DEFAULT false,
  step_create_workflow    boolean NOT NULL DEFAULT false,
  step_add_member         boolean NOT NULL DEFAULT false,
  step_first_sale         boolean NOT NULL DEFAULT false,
  dismissed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_onboarding_progress IS
  'Checklist progressivo de onboarding por organização. Disjunto de org_onboarding (quiz one-shot).';

-- ─── updated_at trigger ────────────────────────────────────────────────────────

CREATE TRIGGER trg_org_onb_prog_updated_at
  BEFORE UPDATE ON public.org_onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.org_onboarding_progress ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro da org
CREATE POLICY "onb_prog_select" ON public.org_onboarding_progress
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: apenas admin da org (role = 'admin' em team_members)
CREATE POLICY "onb_prog_update" ON public.org_onboarding_progress
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- INSERT: bloqueado para clientes — apenas via trigger SECURITY DEFINER
-- (sem policy INSERT → RLS bloqueia; só funções DEFINER inserem)

-- ─── Índice ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_onb_prog_dismissed
  ON public.org_onboarding_progress(dismissed_at)
  WHERE dismissed_at IS NULL;

-- ─── Auto-create por organização nova ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_create_org_onb_prog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.org_onboarding_progress (organization_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_create_org_onb_prog
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_org_onb_prog();

-- ─── Backfill: orgs existentes ─────────────────────────────────────────────────

INSERT INTO public.org_onboarding_progress (organization_id)
SELECT id FROM public.organizations
ON CONFLICT DO NOTHING;

-- ─── Trigger: step_connect_whatsapp ───────────────────────────────────────────
-- Dispara quando whatsapp_instances status vira 'connected'

CREATE OR REPLACE FUNCTION public.complete_step_connect_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'connected' AND (OLD.status IS DISTINCT FROM 'connected') THEN
    UPDATE public.org_onboarding_progress
      SET step_connect_whatsapp = true
      WHERE organization_id = NEW.organization_id
        AND step_connect_whatsapp = false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_connect_wa
  AFTER INSERT OR UPDATE OF status ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.complete_step_connect_whatsapp();

-- ─── Trigger: step_import_lead ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_step_import_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.org_onboarding_progress
    SET step_import_lead = true
    WHERE organization_id = NEW.organization_id
      AND step_import_lead = false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_import_lead
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.complete_step_import_lead();

-- ─── Trigger: step_configure_copilot ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_step_configure_copilot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.org_onboarding_progress
    SET step_configure_copilot = true
    WHERE organization_id = NEW.organization_id
      AND step_configure_copilot = false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_configure_copilot
  AFTER INSERT ON public.copilot_agents
  FOR EACH ROW EXECUTE FUNCTION public.complete_step_configure_copilot();

-- ─── Trigger: step_create_workflow ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_step_create_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.org_onboarding_progress
    SET step_create_workflow = true
    WHERE organization_id = NEW.organization_id
      AND step_create_workflow = false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_create_workflow
  AFTER INSERT ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.complete_step_create_workflow();

-- ─── Trigger: step_add_member ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_step_add_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.org_onboarding_progress
    SET step_add_member = true
    WHERE organization_id = NEW.organization_id
      AND step_add_member = false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_add_member
  AFTER INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.complete_step_add_member();

-- ─── Trigger: step_first_sale ────────────────────────────────────────────────
-- Dispara quando pipe_propostas.status muda para 'vendido'

CREATE OR REPLACE FUNCTION public.complete_step_first_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Curto-circuito: só age quando muda para 'vendido'
  IF NEW.status = 'vendido' AND (OLD.status IS DISTINCT FROM 'vendido') THEN
    -- Buscar org_id via lead
    SELECT organization_id INTO v_org_id
    FROM public.leads
    WHERE id = NEW.lead_id;

    IF v_org_id IS NOT NULL THEN
      UPDATE public.org_onboarding_progress
        SET step_first_sale = true
        WHERE organization_id = v_org_id
          AND step_first_sale = false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_step_first_sale
  AFTER INSERT OR UPDATE OF status ON public.pipe_propostas
  FOR EACH ROW
  WHEN (NEW.status = 'vendido')
  EXECUTE FUNCTION public.complete_step_first_sale();
