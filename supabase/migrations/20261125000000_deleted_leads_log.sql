-- =============================================================================
-- 20261125000000_deleted_leads_log.sql
-- Log de leads deletados (soft + hard), com snapshot lead + filhos-chave,
-- retenção de 10 dias. Garante rastro/recuperação mesmo em HARD delete
-- (que cascateia e some sem rastro — caso Jaqueline Bastos 2026-06-10).
--
-- Por que cobre os DOIS:
--   - HARD: trigger BEFORE DELETE em leads — captura OLD + filhos ANTES da
--     cascata ON DELETE remover os filhos.
--   - SOFT: trigger AFTER UPDATE OF deleted_at quando NULL -> NOT NULL.
-- Diferente do audit_log (que só loga service_role), ESTE loga todo delete
-- (UI authenticated, SQL manual, cron), pois é trigger SECURITY DEFINER.
-- =============================================================================

-- 1. Tabela de log -----------------------------------------------------------
-- organization_id SEM FK de propósito: log de auditoria é desacoplado — deve
-- sobreviver mesmo se a org/lead forem removidos.
CREATE TABLE IF NOT EXISTS public.deleted_leads_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id         uuid NOT NULL,
  lead_name       text,
  lead_phone      text,
  lead_email      text,
  delete_type     text NOT NULL CHECK (delete_type IN ('soft', 'hard')),
  deleted_by      uuid,          -- auth.uid() / leads.deleted_by (pode ser NULL em SQL/cron)
  actor_role      text,          -- role do JWT (authenticated/service_role/NULL)
  snapshot        jsonb NOT NULL,-- { lead, conversations, lead_history, meetings, pipeline_entries, lead_tags }
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deleted_leads_log_org
  ON public.deleted_leads_log (organization_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_leads_log_lead
  ON public.deleted_leads_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_deleted_leads_log_retention
  ON public.deleted_leads_log (deleted_at);

-- 2. RLS ---------------------------------------------------------------------
ALTER TABLE public.deleted_leads_log ENABLE ROW LEVEL SECURITY;

-- SELECT: membros da org + master. SEM policies de write — só o trigger
-- (SECURITY DEFINER) e o cron (postgres) escrevem/purgam; usuário não adultera.
DROP POLICY IF EXISTS "deleted_leads_log_select_org" ON public.deleted_leads_log;
CREATE POLICY "deleted_leads_log_select_org"
  ON public.deleted_leads_log FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
    OR public.is_master_user()
  );

GRANT SELECT ON public.deleted_leads_log TO authenticated;

-- 3. Trigger function (soft + hard) ------------------------------------------
CREATE OR REPLACE FUNCTION public.log_lead_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type     text;
  v_row      jsonb;
  v_actor    uuid;
  v_role     text;
  v_claims   text;
  v_snapshot jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_type := 'hard';
  ELSIF TG_OP = 'UPDATE' THEN
    -- só a transição NULL -> NOT NULL conta como soft-delete
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    v_type := 'soft';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- estado final do lead (soft=NEW c/ deleted_at; hard=OLD)
  v_row := to_jsonb(COALESCE(NEW, OLD));

  v_actor := COALESCE(
    (to_jsonb(COALESCE(NEW, OLD))->>'deleted_by')::uuid,
    auth.uid()
  );

  BEGIN
    v_claims := current_setting('request.jwt.claims', true);
    IF v_claims IS NOT NULL AND v_claims <> '' THEN
      v_role := (v_claims::jsonb)->>'role';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  -- snapshot: lead + filhos-chave (ainda presentes no BEFORE DELETE / no soft UPDATE)
  v_snapshot := jsonb_build_object(
    'lead', v_row,
    'conversations',    COALESCE((SELECT jsonb_agg(to_jsonb(c))  FROM public.conversations    c  WHERE c.lead_id  = OLD.id), '[]'::jsonb),
    'lead_history',     COALESCE((SELECT jsonb_agg(to_jsonb(h))  FROM public.lead_history     h  WHERE h.lead_id  = OLD.id), '[]'::jsonb),
    'meetings',         COALESCE((SELECT jsonb_agg(to_jsonb(m))  FROM public.meetings         m  WHERE m.lead_id  = OLD.id), '[]'::jsonb),
    'pipeline_entries', COALESCE((SELECT jsonb_agg(to_jsonb(pe)) FROM public.pipeline_entries pe WHERE pe.lead_id = OLD.id), '[]'::jsonb),
    'lead_tags',        COALESCE((SELECT jsonb_agg(to_jsonb(lt)) FROM public.lead_tags        lt WHERE lt.lead_id = OLD.id), '[]'::jsonb)
  );

  INSERT INTO public.deleted_leads_log (
    organization_id, lead_id, lead_name, lead_phone, lead_email,
    delete_type, deleted_by, actor_role, snapshot
  ) VALUES (
    OLD.organization_id, OLD.id, OLD.name, OLD.phone, OLD.email,
    v_type, v_actor, v_role, v_snapshot
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- nunca bloquear o delete por causa de falha no log
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 4. Triggers ----------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_log_lead_hard_delete ON public.leads;
CREATE TRIGGER trg_log_lead_hard_delete
  BEFORE DELETE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.log_lead_deletion();

DROP TRIGGER IF EXISTS trg_log_lead_soft_delete ON public.leads;
CREATE TRIGGER trg_log_lead_soft_delete
  AFTER UPDATE OF deleted_at ON public.leads
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.log_lead_deletion();

-- 5. Retenção 10 dias (pg_cron, diário) --------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('purge-deleted-leads-log');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'purge-deleted-leads-log',
  '17 3 * * *',  -- diário 03:17
  $$ DELETE FROM public.deleted_leads_log WHERE deleted_at < now() - interval '10 days'; $$
);

COMMENT ON TABLE public.deleted_leads_log IS
  'Log de leads deletados (soft+hard) com snapshot lead+filhos. Retenção 10d via cron purge-deleted-leads-log. Trigger SECURITY DEFINER loga todo delete (inclui UI/SQL, não só service_role).';
