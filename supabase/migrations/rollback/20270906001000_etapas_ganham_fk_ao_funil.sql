-- rollback/20270906001000_etapas_ganham_fk_ao_funil.sql
--
-- Reverte SCRUM-616: recria a TABELA custom_pipeline_stages a partir das linhas
-- migradas (join pipelines.type='custom'), devolve as FKs aos alvos originais,
-- derruba view/uniques/FK/coluna/trigger/RPC e restaura CHECK + NOT NULL.
--
-- PERDA CONHECIDA E ACEITA: a migration renumerou `position` (ativas 0..n-1,
-- inativas 1000+). O rollback preserva a ORDEM relativa, não os valores
-- absolutos originais. `updated_at` das linhas tocadas também não volta.
--
-- ATENÇÃO: se o front do mesmo PR (hooks de reorder → RPC reorder_pipeline_stages)
-- já estiver no ar, reverter esta migration quebra o reorder — reverter os dois
-- juntos.
--
-- metric-lint-allow: rollback one-off de migração de dados (SCRUM-616) — não é métrica

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- Guarda: só roda por cima do estado pós-migration (view existente).
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM616: custom_pipeline_stages não é view — migration não aplicada?';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Cai a view de compat (triggers INSTEAD OF caem junto)
-- ════════════════════════════════════════════════════════════════════════════

DROP VIEW public.custom_pipeline_stages;
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_insert_fn();
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_update_fn();
DROP FUNCTION IF EXISTS public.custom_pipeline_stages_delete_fn();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Recria a tabela original (DDL medido em prod 2026-09-01)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.custom_pipeline_stages (
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id              uuid NOT NULL,
  pipeline_id                  uuid NOT NULL,
  stage_key                    text NOT NULL,
  name                         text NOT NULL,
  color                        text DEFAULT '#64748b'::text,
  position                     integer DEFAULT 0,
  is_active                    boolean DEFAULT true,
  is_final_positive            boolean DEFAULT false,
  is_final_negative            boolean DEFAULT false,
  target_pipeline_id           uuid,
  target_stage_id              uuid,
  target_pipe_type             text,
  target_stage_key             text,
  created_at                   timestamptz DEFAULT now(),
  updated_at                   timestamptz DEFAULT now(),
  checklist_template_id        uuid,
  stage_role                   public.stage_role NOT NULL DEFAULT 'open',
  suggested_stage_role         public.stage_role,
  stage_role_suggested_at      timestamptz,
  stage_role_suggestion_source text,
  stage_role_reviewed_at       timestamptz,
  stage_role_reviewed_by       uuid,
  requires_sale_value          boolean NOT NULL DEFAULT false,
  CONSTRAINT custom_pipeline_stages_pkey PRIMARY KEY (id),
  CONSTRAINT custom_pipeline_stages_pipeline_id_stage_key_key UNIQUE (pipeline_id, stage_key),
  CONSTRAINT custom_pipeline_stages_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT custom_pipeline_stages_pipeline_id_fkey
    FOREIGN KEY (pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE CASCADE,
  CONSTRAINT custom_pipeline_stages_checklist_template_id_fkey
    FOREIGN KEY (checklist_template_id) REFERENCES public.checklists(id) ON DELETE SET NULL,
  CONSTRAINT custom_pipeline_stages_target_pipeline_id_fkey
    FOREIGN KEY (target_pipeline_id) REFERENCES public.custom_pipelines(id) ON DELETE SET NULL,
  CONSTRAINT custom_pipeline_stages_target_stage_id_fkey
    FOREIGN KEY (target_stage_id) REFERENCES public.custom_pipeline_stages(id) ON DELETE SET NULL,
  CONSTRAINT custom_pipeline_stages_suggested_role_not_open
    CHECK (suggested_stage_role IS DISTINCT FROM 'open'::public.stage_role),
  CONSTRAINT custom_pipeline_stages_suggestion_source_valid
    CHECK (stage_role_suggestion_source IS NULL
           OR stage_role_suggestion_source = ANY (ARRAY['deterministic','ai','flag']))
);

CREATE INDEX idx_custom_pipeline_stages_pipeline ON public.custom_pipeline_stages (pipeline_id);
CREATE INDEX idx_custom_pipeline_stages_active   ON public.custom_pipeline_stages (pipeline_id, is_active);
CREATE INDEX idx_custom_pipeline_stages_pending_role_suggestion
  ON public.custom_pipeline_stages (organization_id) WHERE suggested_stage_role IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Copia as linhas custom de volta (id preservado)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.custom_pipeline_stages (
  id, organization_id, pipeline_id, stage_key, name, color, position, is_active,
  is_final_positive, is_final_negative, target_pipeline_id, target_stage_id,
  target_pipe_type, target_stage_key, created_at, updated_at,
  checklist_template_id, stage_role, suggested_stage_role,
  stage_role_suggested_at, stage_role_suggestion_source, stage_role_reviewed_at,
  stage_role_reviewed_by, requires_sale_value
)
SELECT
  ps.id, ps.organization_id, ps.pipeline_id, ps.stage_key, ps.name, ps.color,
  ps.position, ps.is_active, ps.is_final_positive, ps.is_final_negative,
  ps.target_pipeline_id, ps.target_stage_id, ps.target_pipe_type,
  ps.target_stage_key, ps.created_at, ps.updated_at, ps.checklist_template_id,
  ps.stage_role, ps.suggested_stage_role, ps.stage_role_suggested_at,
  ps.stage_role_suggestion_source, ps.stage_role_reviewed_at,
  ps.stage_role_reviewed_by, ps.requires_sale_value
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. FKs voltam aos alvos originais ANTES do delete (senão o SET NULL da
--    target_stage_id apagaria referência viva)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT pipeline_stages_target_stage_id_fkey;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_target_stage_id_fkey
  FOREIGN KEY (target_stage_id) REFERENCES public.custom_pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE public.custom_pipe_entries
  DROP CONSTRAINT custom_pipe_entries_stage_id_fkey;
ALTER TABLE public.custom_pipe_entries
  ADD CONSTRAINT custom_pipe_entries_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES public.custom_pipeline_stages(id);

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_source_stage_id_fkey;
ALTER TABLE public.custom_pipe_transitions
  ADD CONSTRAINT custom_pipe_transitions_source_stage_id_fkey
  FOREIGN KEY (source_stage_id) REFERENCES public.custom_pipeline_stages(id) ON DELETE CASCADE;

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_target_stage_id_fkey;
ALTER TABLE public.custom_pipe_transitions
  ADD CONSTRAINT custom_pipe_transitions_target_stage_id_fkey
  FOREIGN KEY (target_stage_id) REFERENCES public.custom_pipeline_stages(id) ON DELETE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Remove as linhas migradas de pipeline_stages e desfaz o schema novo
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_stages DISABLE TRIGGER USER;

DELETE FROM public.pipeline_stages ps
USING public.pipelines p
WHERE p.id = ps.pipeline_id AND p.type = 'custom';

ALTER TABLE public.pipeline_stages ENABLE TRIGGER USER;

DROP TRIGGER IF EXISTS trg_pipeline_stages_resolve_pipeline_id ON public.pipeline_stages;
DROP FUNCTION IF EXISTS public.pipeline_stages_resolve_pipeline_id();
DROP FUNCTION IF EXISTS public.reorder_pipeline_stages(uuid[]);

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_id_stage_key_key,
  DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_id_position_key,
  DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_id_fkey;

ALTER TABLE public.pipeline_stages DROP COLUMN pipeline_id;

-- Restaura NOT NULL + CHECK (guarda: nenhuma linha pode ter ficado NULL).
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM public.pipeline_stages WHERE pipeline_type IS NULL;
  IF v <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM616: % linhas com pipeline_type NULL sobraram em pipeline_stages', v;
  END IF;
END;
$$;

ALTER TABLE public.pipeline_stages
  ALTER COLUMN pipeline_type SET NOT NULL;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_pipeline_type_check
  CHECK (pipeline_type = ANY (ARRAY['whatsapp'::text, 'confirmacao'::text,
                                    'propostas'::text, 'upsell_base'::text,
                                    'upsell_gestao'::text]));

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS, triggers e grants da tabela recriada (como medidos em prod)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.custom_pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members podem gerenciar custom pipeline stages"
  ON public.custom_pipeline_stages FOR ALL
  USING (organization_id IN (SELECT get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

CREATE POLICY "master_ghost_all_custom_pipeline_stages"
  ON public.custom_pipeline_stages FOR ALL
  USING ((SELECT is_master_user()))
  WITH CHECK ((SELECT is_master_user()));

CREATE POLICY "master_ghost_select_custom_pipeline_stages"
  ON public.custom_pipeline_stages FOR SELECT
  USING ((SELECT is_master_user()));

CREATE TRIGGER trg_custom_pipeline_stages_updated_at
  BEFORE UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_custom_pipeline_stages_won_lost_guard
  BEFORE INSERT OR UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.fn_pipeline_stages_guard_money_role();

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.custom_pipeline_stages TO authenticated, service_role;
GRANT SELECT, REFERENCES, TRIGGER ON public.custom_pipeline_stages TO anon;
GRANT SELECT ON public.custom_pipeline_stages TO mcp_readonly;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Asserções do rollback
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tab bigint;
  v_ps  bigint;
BEGIN
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM616: custom_pipeline_stages não voltou a ser tabela';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pipeline_stages'::regclass
                    AND conname = 'pipeline_stages_pipeline_type_check') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM616: CHECK dos 5 tipos não voltou';
  END IF;

  SELECT count(*) INTO v_tab FROM public.custom_pipeline_stages;
  SELECT count(*) INTO v_ps  FROM public.pipeline_stages WHERE pipeline_type IS NULL;
  IF v_ps <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM616: sobraram % linhas NULL em pipeline_stages', v_ps;
  END IF;

  RAISE NOTICE 'ROLLBACK SCRUM616 OK: % etapas custom de volta na tabela própria', v_tab;
END;
$$;
