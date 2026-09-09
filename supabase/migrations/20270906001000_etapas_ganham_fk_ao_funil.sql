-- 20270906001000_etapas_ganham_fk_ao_funil.sql
--
-- SCRUM-616 · Funil é funil (Wave 2, F1) — etapas ganham FK real ao funil e a
-- trava dos 5 tipos literais cai. Rollback pareado em
-- supabase/migrations/rollback/20270906001000_etapas_ganham_fk_ao_funil.sql.
-- Ensaio transacional: scripts/ensaio-scrum616.sh (NUNCA rodar sem janela do CTO).
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
--
--   1. Cai o CHECK `pipeline_stages_pipeline_type_check` (whatsapp/confirmacao/
--      propostas/upsell_base/upsell_gestao) e o NOT NULL de `pipeline_type`.
--   2. `pipeline_stages.pipeline_id uuid REFERENCES pipelines(id) ON DELETE
--      CASCADE` + backfill por (organization_id, pipeline_type→slug, type='system').  -- metric-lint-allow: comentário do cabeçalho, não métrica (SCRUM-616)
--   3. As 531 `custom_pipeline_stages` migram para `pipeline_stages` preservando
--      o uuid; `custom_pipeline_stages` vira VIEW de compat com INSTEAD OF
--      (playbook Wave 1 — 20260983000000_legacy_pipe_compat_views.sql).
--   4. UNIQUE (pipeline_id, stage_key) e UNIQUE (pipeline_id, position)
--      DEFERRABLE INITIALLY IMMEDIATE + RPC `reorder_pipeline_stages` (os dois
--      editores vivos reordenam com um UPDATE por linha via PostgREST — cada
--      request é uma transação; sem a RPC de statement único a constraint de
--      position quebraria o reorder em produção).
--
-- ── MEDIDO EM PROD (2026-09-01, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · pipeline_stages: whatsapp 1025 ativas/205 inativas · confirmacao 954/5 ·
--     propostas 807/55 · upsell_base 624 (todas inativas) · upsell_gestao 520
--     (todas inativas). organization_id nunca é NULL.
--   · (org, slug) NÃO resolve em `pipelines` para exatamente 1 org: AUTOTEK
--     (c0e31702-25a6-482f-af94-0cee0628e921) — 0 linhas em `pipelines` (funis
--     de sistema deletados; resíduo de 37 etapas, 32 ativas). Ficam com
--     pipeline_id NULL, documentado abaixo. Nenhum duplicado (org,slug,system).
--   · custom_pipeline_stages: 531 linhas · 0 colisões de id com pipeline_stages
--     · 0 pipeline_id fora do espelho `pipelines` · 65 pares (org, stage_key)
--     repetidos entre funis custom da mesma org → pipeline_type das migradas
--     precisa ser NULL (com 'custom', a UNIQUE legada (org, pipeline_type,
--     stage_key) estouraria — e ela fica: é o arbiter do ON CONFLICT de
--     create_default_pipeline_stages).
--   · Duplicatas de position: 173 grupos (org, pipeline_type) no sistema e 16
--     grupos (pipeline_id) no custom → renumeração determinística no backfill.
--   · FKs de entrada em custom_pipeline_stages: custom_pipe_entries.stage_id,
--     custom_pipe_transitions.source/target_stage_id (tabela com 0 linhas),
--     pipeline_stages.target_stage_id, self-FK target_stage_id. Todas
--     retargetadas para pipeline_stages(id) preservando o NOME (PostgREST
--     resolve embed por nome de FK).
--   · Triggers da tabela custom: updated_at (vira `updated_at = now()` no
--     INSTEAD OF UPDATE) e won_lost_guard (a MESMA função já está pendurada em
--     pipeline_stages — passa a disparar pela base).
--   · Triggers de pipeline_stages que passam a ver linhas custom:
--     sync_copilot_on_stage_created/removed usam `active_pipes ? pipeline_type`
--     e `pipeline_stages_assign_system_stage_role` usa system_stage_role(type,
--     key) — com pipeline_type NULL os três são provadamente no-op.
--     queue_followup_reclassify é upsert idempotente por org (replicado à mão
--     no fim, com os triggers de usuário desligados durante a carga).
--   · Realtime: só pipeline_stages está em supabase_realtime;
--     custom_pipeline_stages NÃO — a view não quebra assinatura nenhuma.
--   · Escritores vivos de custom_pipeline_stages (repo): INSERTs
--     (OnboardingWizard, onboarding-engine, useCustomPipelines create),
--     UPDATEs (update/soft-delete/reorder de useCustomPipelines, writeback do
--     classify-stage-roles) e DELETE (RPC delete_custom_pipeline). Todos
--     cobertos pelos INSTEAD OF.
--
-- ── DECISÕES DOCUMENTADAS ───────────────────────────────────────────────────
--
--   D-a `pipeline_type` das migradas = NULL (não 'custom'): evita colisão na
--       UNIQUE legada, mantém os leitores legados de pipeline_stages cegos às
--       linhas custom (quem lê custom lê pela view) e torna os triggers de
--       copilot/stage_role inertes. `pipeline_type` vira espelho transitório
--       só das linhas de sistema; morre na F6.
--   D-b Etapas upsell_base/upsell_gestao (1.144, todas is_active=false, SEM
--       linha em pipelines por guarda explícita — 0 slugs upsell em pipelines)
--       ficam com pipeline_id NULL. A faxina delas é SCRUM-618.
--   D-c AUTOTEK: 37 etapas órfãs de funis de sistema deletados ficam com
--       pipeline_id NULL — recriar as linhas em `pipelines` ressuscitaria funis
--       que a org excluiu de propósito (20270902000010). Resíduo p/ SCRUM-618.
--   D-d Renumeração de position (linhas com pipeline_id): ativas ganham 0..n-1
--       preservando a ordem atual (position, created_at, id); inativas ganham
--       1000+seq — headroom para os editores, que inserem em
--       position=len(ativas) sem enxergar as inativas.
--   D-e FK pipeline_id com ON DELETE CASCADE: espelha o CASCADE que
--       custom_pipeline_stages tinha de custom_pipelines e casa com os fluxos
--       delete_custom_pipeline/delete_system_pipeline (hard delete).
--   D-f UNIQUE (pipeline_id, position) DEFERRABLE INITIALLY IMMEDIATE: permite
--       permutação em statement único (RPC) e segue valendo por statement.
--       NULLS DISTINCT (default) deixa upsell/AUTOTEK fora da trava — correto.
--   D-g Trigger BEFORE INSERT resolve pipeline_id de inserts legados de etapa
--       de sistema (ensureDefaultStagesInDb do front, create_default_pipeline_
--       stages, clone master) até a F1 de código matar esses semeadores.
--
-- metric-lint-allow: migração one-off de dados de etapas (SCRUM-616) — não é métrica

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Snapshot pré-migração (alimenta as asserções do fim)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TEMP TABLE _scrum616_pre ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.custom_pipeline_stages)                                   AS custom_total,
  (SELECT count(*) FROM public.pipeline_stages)                                          AS system_total,
  (SELECT count(*) FROM public.pipeline_stages
    WHERE pipeline_type IN ('upsell_base','upsell_gestao'))                              AS upsell_total,
  (SELECT count(*) FROM public.pipeline_stages ps
    WHERE ps.pipeline_type IN ('whatsapp','confirmacao','propostas')
      AND EXISTS (SELECT 1 FROM public.pipelines p
                   WHERE p.organization_id = ps.organization_id
                     AND p.slug = ps.pipeline_type AND p.type = 'system'))               AS system_resolviveis,  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-616)
  (SELECT count(*) FROM public.pipeline_stages ps
    WHERE ps.pipeline_type IN ('whatsapp','confirmacao','propostas') AND ps.is_active
      AND NOT EXISTS (SELECT 1 FROM public.pipelines p
                       WHERE p.organization_id = ps.organization_id
                         AND p.slug = ps.pipeline_type AND p.type = 'system'))           AS system_orfas_ativas;  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-616)

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Cai a trava dos 5 tipos + pipeline_type vira anulável
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_type_check;

ALTER TABLE public.pipeline_stages
  ALTER COLUMN pipeline_type DROP NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. pipeline_id + FK (NOT VALID → backfill → VALIDATE)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_stages
  ADD COLUMN pipeline_id uuid;

COMMENT ON COLUMN public.pipeline_stages.pipeline_id IS
  'FK real ao funil (pipelines.id). NULL somente em: etapas upsell_* aposentadas '
  '(SCRUM-618), resíduo de funil de sistema deletado (AUTOTEK) e inserts legados '
  'de org sem linha em pipelines. SCRUM-616.';

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_pipeline_id_fkey
  FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE
  NOT VALID;

-- Carga em massa com triggers de usuário desligados (copilot sync / reclassify
-- queue / guards não devem disparar linha a linha; a fila é reposta no §7).
ALTER TABLE public.pipeline_stages DISABLE TRIGGER USER;

-- 2a. Backfill das etapas de sistema: resolve por (org, pipeline_type→slug).
UPDATE public.pipeline_stages ps
SET pipeline_id = p.id
FROM public.pipelines p
WHERE ps.pipeline_id IS NULL
  AND ps.pipeline_type IN ('whatsapp','confirmacao','propostas')
  AND p.organization_id = ps.organization_id
  AND p.slug = ps.pipeline_type
  AND p.type = 'system';  -- metric-lint-allow: resolução de FK do backfill, não métrica (SCRUM-616)

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Migra as etapas custom para dentro de pipeline_stages (id preservado)
-- ════════════════════════════════════════════════════════════════════════════
-- Guardas dentro da própria query (não confiar no plano): espelho em pipelines
-- precisa existir e ser custom; id não pode colidir. Divergência aqui derruba a
-- asserção de contagem do §8.

INSERT INTO public.pipeline_stages (
  id, organization_id, pipeline_id, pipeline_type, stage_key, name, color,
  position, is_active, is_final_positive, is_final_negative,
  target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key,
  created_at, updated_at, checklist_template_id,
  stage_role, suggested_stage_role, stage_role_suggested_at,
  stage_role_suggestion_source, stage_role_reviewed_at, stage_role_reviewed_by,
  requires_sale_value
)
SELECT
  c.id, c.organization_id, c.pipeline_id,
  NULL,                                   -- D-a: pipeline_type NULL nas migradas
  c.stage_key, c.name, COALESCE(c.color, '#64748b'),
  COALESCE(c.position, 0), COALESCE(c.is_active, true),
  COALESCE(c.is_final_positive, false), COALESCE(c.is_final_negative, false),
  c.target_pipeline_id, c.target_stage_id, c.target_pipe_type, c.target_stage_key,
  COALESCE(c.created_at, now()), COALESCE(c.updated_at, now()), c.checklist_template_id,  -- metric-lint-allow: cópia one-off de linha, updated_at não é âncora de métrica (SCRUM-616)
  c.stage_role, c.suggested_stage_role, c.stage_role_suggested_at,
  c.stage_role_suggestion_source, c.stage_role_reviewed_at, c.stage_role_reviewed_by,
  c.requires_sale_value
FROM public.custom_pipeline_stages c
WHERE EXISTS (SELECT 1 FROM public.pipelines p
               WHERE p.id = c.pipeline_id AND p.type = 'custom')
  AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages x WHERE x.id = c.id);

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Renumeração determinística de position (D-d) + uniques
-- ════════════════════════════════════════════════════════════════════════════

WITH ranked AS (
  SELECT id,
         CASE WHEN is_active
              THEN        row_number() OVER (PARTITION BY pipeline_id, is_active
                                             ORDER BY position, created_at, id) - 1
              ELSE 1000 + row_number() OVER (PARTITION BY pipeline_id, is_active
                                             ORDER BY position, created_at, id) - 1
         END AS new_pos
  FROM public.pipeline_stages
  WHERE pipeline_id IS NOT NULL
)
UPDATE public.pipeline_stages ps
SET position = r.new_pos
FROM ranked r
WHERE ps.id = r.id
  AND ps.position IS DISTINCT FROM r.new_pos;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_pipeline_id_stage_key_key
  UNIQUE (pipeline_id, stage_key);

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_pipeline_id_position_key
  UNIQUE (pipeline_id, position) DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.pipeline_stages ENABLE TRIGGER USER;

ALTER TABLE public.pipeline_stages
  VALIDATE CONSTRAINT pipeline_stages_pipeline_id_fkey;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Retarget das FKs que apontavam para custom_pipeline_stages
--    (nomes preservados — PostgREST resolve embed por nome de FK)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT pipeline_stages_target_stage_id_fkey;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_target_stage_id_fkey
  FOREIGN KEY (target_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.pipeline_stages
  VALIDATE CONSTRAINT pipeline_stages_target_stage_id_fkey;

ALTER TABLE public.custom_pipe_entries
  DROP CONSTRAINT custom_pipe_entries_stage_id_fkey;
ALTER TABLE public.custom_pipe_entries
  ADD CONSTRAINT custom_pipe_entries_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id)
  NOT VALID;
ALTER TABLE public.custom_pipe_entries
  VALIDATE CONSTRAINT custom_pipe_entries_stage_id_fkey;

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_source_stage_id_fkey;
ALTER TABLE public.custom_pipe_transitions
  ADD CONSTRAINT custom_pipe_transitions_source_stage_id_fkey
  FOREIGN KEY (source_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE CASCADE;

ALTER TABLE public.custom_pipe_transitions
  DROP CONSTRAINT custom_pipe_transitions_target_stage_id_fkey;
ALTER TABLE public.custom_pipe_transitions
  ADD CONSTRAINT custom_pipe_transitions_target_stage_id_fkey
  FOREIGN KEY (target_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. custom_pipeline_stages vira VIEW de compat com INSTEAD OF (playbook W1)
-- ════════════════════════════════════════════════════════════════════════════

DROP TABLE public.custom_pipeline_stages;

CREATE VIEW public.custom_pipeline_stages
WITH (security_invoker = on) AS
SELECT
  ps.id,
  ps.organization_id,
  ps.pipeline_id,
  ps.stage_key,
  ps.name,
  ps.color,
  ps.position,
  ps.is_active,
  ps.is_final_positive,
  ps.is_final_negative,
  ps.target_pipeline_id,
  ps.target_stage_id,
  ps.target_pipe_type,
  ps.target_stage_key,
  ps.created_at,
  ps.updated_at,
  ps.checklist_template_id,
  ps.stage_role,
  ps.suggested_stage_role,
  ps.stage_role_suggested_at,
  ps.stage_role_suggestion_source,
  ps.stage_role_reviewed_at,
  ps.stage_role_reviewed_by,
  ps.requires_sale_value
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom';

COMMENT ON VIEW public.custom_pipeline_stages IS
  'View de compat sobre pipeline_stages (funis type=custom). D5: espelho com '
  'data pra morrer — cai na F6 da unificação de funis. SCRUM-616.';

-- INSTEAD OF INSERT — valida o funil, aplica os defaults da tabela antiga e
-- devolve NEW populado (PostgREST .select().single() depende do RETURNING).
CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_insert_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pipe public.pipelines%ROWTYPE;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: pipeline_id é obrigatório';
  END IF;

  SELECT * INTO v_pipe FROM public.pipelines WHERE id = NEW.pipeline_id;
  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não existe em pipelines', NEW.pipeline_id;
  END IF;
  IF v_pipe.type <> 'custom' THEN
    RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom (type=%)', NEW.pipeline_id, v_pipe.type;
  END IF;

  NEW.id                  := COALESCE(NEW.id, gen_random_uuid());
  NEW.organization_id     := COALESCE(NEW.organization_id, v_pipe.organization_id);
  NEW.color               := COALESCE(NEW.color, '#64748b');
  NEW.position            := COALESCE(NEW.position, 0);
  NEW.is_active           := COALESCE(NEW.is_active, true);
  NEW.is_final_positive   := COALESCE(NEW.is_final_positive, false);
  NEW.is_final_negative   := COALESCE(NEW.is_final_negative, false);
  NEW.stage_role          := COALESCE(NEW.stage_role, 'open');
  NEW.requires_sale_value := COALESCE(NEW.requires_sale_value, false);
  NEW.created_at          := COALESCE(NEW.created_at, now());
  NEW.updated_at          := COALESCE(NEW.updated_at, now());  -- metric-lint-allow: default de INSTEAD OF INSERT, não métrica (SCRUM-616)

  INSERT INTO public.pipeline_stages (
    id, organization_id, pipeline_id, pipeline_type, stage_key, name, color,
    position, is_active, is_final_positive, is_final_negative,
    target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key,
    created_at, updated_at, checklist_template_id,
    stage_role, suggested_stage_role, stage_role_suggested_at,
    stage_role_suggestion_source, stage_role_reviewed_at, stage_role_reviewed_by,
    requires_sale_value
  ) VALUES (
    NEW.id, NEW.organization_id, NEW.pipeline_id, NULL, NEW.stage_key, NEW.name,
    NEW.color, NEW.position, NEW.is_active, NEW.is_final_positive,
    NEW.is_final_negative, NEW.target_pipeline_id, NEW.target_stage_id,
    NEW.target_pipe_type, NEW.target_stage_key, NEW.created_at, NEW.updated_at,
    NEW.checklist_template_id, NEW.stage_role, NEW.suggested_stage_role,
    NEW.stage_role_suggested_at, NEW.stage_role_suggestion_source,
    NEW.stage_role_reviewed_at, NEW.stage_role_reviewed_by,
    NEW.requires_sale_value
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipeline_stages_insert
  INSTEAD OF INSERT ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipeline_stages_insert_fn();

-- INSTEAD OF UPDATE — `updated_at = now()` substitui o trigger updated_at da
-- tabela antiga; won_lost_guard segue disparando na base.
CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_update_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipelines
                    WHERE id = NEW.pipeline_id AND type = 'custom') THEN
      RAISE EXCEPTION 'custom_pipeline_stages: funil % não é custom', NEW.pipeline_id;
    END IF;
  END IF;

  UPDATE public.pipeline_stages SET
    organization_id              = NEW.organization_id,
    pipeline_id                  = NEW.pipeline_id,
    stage_key                    = NEW.stage_key,
    name                         = NEW.name,
    color                        = NEW.color,
    position                     = NEW.position,
    is_active                    = NEW.is_active,
    is_final_positive            = NEW.is_final_positive,
    is_final_negative            = NEW.is_final_negative,
    target_pipeline_id           = NEW.target_pipeline_id,
    target_stage_id              = NEW.target_stage_id,
    target_pipe_type             = NEW.target_pipe_type,
    target_stage_key             = NEW.target_stage_key,
    checklist_template_id        = NEW.checklist_template_id,
    stage_role                   = NEW.stage_role,
    suggested_stage_role         = NEW.suggested_stage_role,
    stage_role_suggested_at      = NEW.stage_role_suggested_at,
    stage_role_suggestion_source = NEW.stage_role_suggestion_source,
    stage_role_reviewed_at       = NEW.stage_role_reviewed_at,
    stage_role_reviewed_by       = NEW.stage_role_reviewed_by,
    requires_sale_value          = NEW.requires_sale_value,
    updated_at                   = now()
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_custom_pipeline_stages_update
  INSTEAD OF UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipeline_stages_update_fn();

-- INSTEAD OF DELETE
CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_delete_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  DELETE FROM public.pipeline_stages WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_custom_pipeline_stages_delete
  INSTEAD OF DELETE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.custom_pipeline_stages_delete_fn();

-- Grants — espelham os da tabela antiga (medidos em prod). security_invoker=on:
-- RLS e privilégios da base (pipeline_stages/pipelines) valem para o invocador.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipeline_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pipeline_stages TO service_role;
GRANT SELECT ON public.custom_pipeline_stages TO anon;
GRANT SELECT ON public.custom_pipeline_stages TO mcp_readonly;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Resolver de pipeline_id p/ inserts legados (D-g) + RPC de reorder (D-f)
--    + reposição da fila de reclassificação (trigger ficou desligado na carga)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pipeline_stages_resolve_pipeline_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pipeline_id IS NULL AND NEW.pipeline_type IS NOT NULL THEN
    SELECT p.id INTO NEW.pipeline_id
    FROM public.pipelines p
    WHERE p.organization_id = NEW.organization_id
      AND p.slug = NEW.pipeline_type
      AND p.type = 'system'  -- metric-lint-allow: resolver de FK legado, não métrica (SCRUM-616)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pipeline_stages_resolve_pipeline_id
  BEFORE INSERT ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_stages_resolve_pipeline_id();

-- Reorder em statement ÚNICO: a UNIQUE (pipeline_id, position) é checada no fim
-- do statement (DEFERRABLE INITIALLY IMMEDIATE), então a permutação inteira
-- passa. SECURITY INVOKER: RLS de pipeline_stages decide o que o caller pode
-- mover. Substitui o Promise.all de UPDATEs por linha dos dois hooks de reorder.
CREATE OR REPLACE FUNCTION public.reorder_pipeline_stages(p_stage_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_stage_ids IS NULL OR array_length(p_stage_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH ord AS (
    SELECT t.id, t.ord - 1 AS new_pos
    FROM unnest(p_stage_ids) WITH ORDINALITY AS t(id, ord)
  )
  UPDATE public.pipeline_stages ps
  SET position   = ord.new_pos,
      updated_at = now()
  FROM ord
  WHERE ps.id = ord.id
    AND ps.position IS DISTINCT FROM ord.new_pos;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_pipeline_stages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_pipeline_stages(uuid[]) TO authenticated, service_role;

-- Fila de reclassificação de followups: os triggers de usuário ficaram
-- desligados durante a carga; repõe 1 marca por org tocada (mesmo upsert que
-- queue_followup_reclassify faria).
INSERT INTO public.followup_reclassify_queue (organization_id, queued_at)
SELECT DISTINCT ps.organization_id, now()
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom'
ON CONFLICT (organization_id) DO UPDATE SET queued_at = now();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Asserções — qualquer falha aborta a transação inteira
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pre           record;
  v_migradas    bigint;
  v_view        bigint;
  v_sys_sem_fk  bigint;
  v_upsell_com  bigint;
  v_upsell_tot  bigint;
  v_dup_key     bigint;
  v_dup_pos     bigint;
  v_nao_valida  bigint;
BEGIN
  SELECT * INTO pre FROM _scrum616_pre;

  -- 8.1 CHECK dos 5 tipos removido.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.pipeline_stages'::regclass
                AND conname = 'pipeline_stages_pipeline_type_check') THEN
    RAISE EXCEPTION 'SCRUM616: CHECK pipeline_stages_pipeline_type_check ainda existe';
  END IF;

  -- 8.2 Contagem: migradas = origem (todas, sem perda nem sobra).
  SELECT count(*) INTO v_migradas
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id AND p.type = 'custom';
  IF v_migradas <> pre.custom_total THEN
    RAISE EXCEPTION 'SCRUM616: custom migradas (%) != origem (%)', v_migradas, pre.custom_total;
  END IF;

  -- 8.3 pipeline_type NULL apenas (e exatamente) nas migradas.
  IF v_migradas <> (SELECT count(*) FROM public.pipeline_stages WHERE pipeline_type IS NULL) THEN
    RAISE EXCEPTION 'SCRUM616: pipeline_type NULL fora das linhas migradas';
  END IF;

  -- 8.4 Nenhuma etapa ativa de sistema resolvível ficou sem pipeline_id
  --     (órfãs conhecidas: AUTOTEK, medidas no snapshot — só elas podem restar).
  SELECT count(*) INTO v_sys_sem_fk
  FROM public.pipeline_stages ps
  WHERE ps.pipeline_type IN ('whatsapp','confirmacao','propostas')
    AND ps.is_active AND ps.pipeline_id IS NULL
    AND EXISTS (SELECT 1 FROM public.pipelines p
                 WHERE p.organization_id = ps.organization_id
                   AND p.slug = ps.pipeline_type AND p.type = 'system');  -- metric-lint-allow: asserção de integridade do backfill, não métrica (SCRUM-616)
  IF v_sys_sem_fk <> 0 THEN
    RAISE EXCEPTION 'SCRUM616: % etapas ativas de sistema resolvíveis sem pipeline_id', v_sys_sem_fk;
  END IF;
  IF (SELECT count(*) FROM public.pipeline_stages
       WHERE pipeline_type IN ('whatsapp','confirmacao','propostas')
         AND is_active AND pipeline_id IS NULL) <> pre.system_orfas_ativas THEN
    RAISE EXCEPTION 'SCRUM616: órfãs ativas divergem do medido no snapshot (%)', pre.system_orfas_ativas;
  END IF;

  -- 8.5 upsell_* intocadas e sem FK (D-b).
  SELECT count(*) FILTER (WHERE pipeline_id IS NOT NULL), count(*)
    INTO v_upsell_com, v_upsell_tot
  FROM public.pipeline_stages
  WHERE pipeline_type IN ('upsell_base','upsell_gestao');
  IF v_upsell_com <> 0 OR v_upsell_tot <> pre.upsell_total THEN
    RAISE EXCEPTION 'SCRUM616: upsell divergiu (com_fk=%, total=% vs %)',
      v_upsell_com, v_upsell_tot, pre.upsell_total;
  END IF;

  -- 8.6 View responde e devolve o mesmo conjunto.
  SELECT count(*) INTO v_view FROM public.custom_pipeline_stages;
  IF v_view <> pre.custom_total THEN
    RAISE EXCEPTION 'SCRUM616: view devolve % != % da origem', v_view, pre.custom_total;
  END IF;

  -- 8.7 Uniques existem e valem (zero duplicatas de fato).
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.pipeline_stages'::regclass
         AND conname IN ('pipeline_stages_pipeline_id_stage_key_key',
                         'pipeline_stages_pipeline_id_position_key')) <> 2 THEN
    RAISE EXCEPTION 'SCRUM616: uniques (pipeline_id, stage_key/position) ausentes';
  END IF;
  SELECT count(*) INTO v_dup_key FROM (
    SELECT 1 FROM public.pipeline_stages WHERE pipeline_id IS NOT NULL
    GROUP BY pipeline_id, stage_key HAVING count(*) > 1) d;
  SELECT count(*) INTO v_dup_pos FROM (
    SELECT 1 FROM public.pipeline_stages WHERE pipeline_id IS NOT NULL
    GROUP BY pipeline_id, position HAVING count(*) > 1) d;
  IF v_dup_key <> 0 OR v_dup_pos <> 0 THEN
    RAISE EXCEPTION 'SCRUM616: duplicatas restantes (stage_key=%, position=%)', v_dup_key, v_dup_pos;
  END IF;

  -- 8.8 Todas as FKs novas/retargetadas validadas.
  SELECT count(*) INTO v_nao_valida
  FROM pg_constraint
  WHERE conname IN ('pipeline_stages_pipeline_id_fkey',
                    'pipeline_stages_target_stage_id_fkey',
                    'custom_pipe_entries_stage_id_fkey',
                    'custom_pipe_transitions_source_stage_id_fkey',
                    'custom_pipe_transitions_target_stage_id_fkey')
    AND NOT convalidated;
  IF v_nao_valida <> 0 THEN
    RAISE EXCEPTION 'SCRUM616: % FKs não validadas', v_nao_valida;
  END IF;

  -- 8.9 Total geral: nada sumiu além do esperado (origem custom somada).
  IF (SELECT count(*) FROM public.pipeline_stages) <> pre.system_total + pre.custom_total THEN
    RAISE EXCEPTION 'SCRUM616: total de pipeline_stages diverge (esperado % + %)',
      pre.system_total, pre.custom_total;
  END IF;

  RAISE NOTICE 'SCRUM616 OK: % custom migradas · % sistema resolvidas · % órfãs ativas (AUTOTEK) · % upsell NULL',
    v_migradas, pre.system_resolviveis, pre.system_orfas_ativas, pre.upsell_total;
END;
$$;
