-- 20270302000110_custom_pipeline_stages_stage_role.sql
--
-- Issue U1 · PRD #986 · ADR-0017 §1 — STAGE_ROLE GOVERNANCE reaches CUSTOM
-- pipelines. The metrics refoundation governs stage semantics via
-- `pipeline_stages.stage_role` (#990) and resolves it in
-- `metric_stage_role(org, pipeline_id, stage_key)` (20270302000030). That
-- resolver joins ONLY `pipelines.slug → pipeline_stages` — SYSTEM pipelines.
-- CUSTOM pipeline stages live in `custom_pipeline_stages` and had NO
-- stage_role, so `metric_stage_role` returned NULL (≙ open) for them → sales
-- in custom funnels never emitted `sale_events`. 22 orgs / ~8,983 custom
-- entries were invisible to canonical metrics. This is THE declared single
-- extension point (FIX-6, 20270302000090).
--
-- JOIN KEYS (discovered, not presumed):
--   custom_pipelines.id is mirrored 1:1 into pipelines.id (type='custom') by
--   sync_custom_pipeline_to_pipelines (20260981000000). custom_pipe_entries
--   (pipeline_id→custom_pipelines.id, stage_id→custom_pipeline_stages.id) is
--   mirrored into pipeline_entries (pipeline_id = custom_pipelines.id,
--   stage_key = custom_pipeline_stages.stage_key) by sync_custom_pipe_to_entries.
--   Therefore a pipeline_stage_events row for a custom pipe carries
--   pipeline_id = custom_pipelines.id (= pipelines.id) and to_stage_key =
--   custom_pipeline_stages.stage_key. metric_stage_role resolves a custom stage
--   via custom_pipeline_stages WHERE pipeline_id = <the id> AND stage_key =
--   <the key> AND organization_id = <org>.
--
-- Content:
--   1. Column `custom_pipeline_stages.stage_role` NOT NULL DEFAULT 'open'.
--      Custom stages START 'open' — no deterministic system map applies to
--      custom names; the AI Stage Classifier (U4, #991) suggests roles, and
--      won/lost require human confirmation.
--   2. Suggestion columns mirroring pipeline_stages (#991): suggested_stage_role,
--      stage_role_suggested_at, stage_role_suggestion_source,
--      stage_role_reviewed_at, stage_role_reviewed_by + the same CHECK
--      constraints + pending-suggestion partial index.
--   3. metric_stage_role() CREATE OR REPLACE (same signature): dispatch on
--      pipelines.type — 'custom' → custom_pipeline_stages, else → pipeline_stages
--      exactly as before. NULL only when neither governs.
--   4. won/lost MONEY GUARD on custom_pipeline_stages: REUSES
--      fn_pipeline_stages_guard_money_role (FIX-4) — its body reads only
--      NEW.stage_role / NEW.organization_id / OLD.stage_role, all present here.
--      A BEFORE INSERT OR UPDATE trigger blocks a non-admin member from setting
--      a custom stage's role to won/lost (allow-list: service_role/superuser/
--      master/org-admin). No system-map BEFORE trigger exists on custom, so the
--      single guard sees the FINAL role.
--
-- NOT here (U4): the classifier does NOT run and NO data is backfilled — schema
-- + resolution + guard only. Custom stages stay 'open' until U4 governs them.
--
-- Rollback: supabase/migrations/rollback/20270302000110_custom_pipeline_stages_stage_role.sql
-- Testes:   supabase/tests/custom_pipeline_stages_stage_role_test.sql (pgTAP, wired no run.sh)

-- ============================================================================
-- 1. Coluna — custom stages começam 'open'
-- ============================================================================
-- ADD COLUMN NOT NULL + DEFAULT é seguro (fast default, sem rewrite; ~9k linhas
-- em 22 orgs). Nenhum backfill de role: custom não tem mapa determinístico de
-- sistema (o nome é o único sinal; U4/classifier cuida disso). Espelha
-- pipeline_stages.stage_role (20270301000020) — mesmo tipo, mesmo default.

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN stage_role public.stage_role NOT NULL DEFAULT 'open';

COMMENT ON COLUMN public.custom_pipeline_stages.stage_role IS
  'ADR-0017 §1 / U1 — papel semântico governado da etapa custom. Único input '
  'de etapa válido para métricas (is_final_positive/negative são UI-only). '
  'Custom começa open; U4 (classifier) sugere, won/lost exige confirmação humana. '
  'Renomear a etapa (name) NUNCA altera o role.';

-- ============================================================================
-- 3. metric_stage_role — dispatch SISTEMA vs CUSTOM (o ponto único de extensão)
-- ============================================================================
-- CREATE OR REPLACE, MESMA assinatura/atributos (STABLE + SECURITY DEFINER +
-- search_path pinado) — só o corpo muda. Um único scan de `pipelines` (chave
-- p_pipeline_id) resolve o tenant e o TIPO do funil, e despacha:
--   · type = 'custom' → custom_pipeline_stages via as REAIS chaves de join
--     (pipeline_id = pipelines.id [espelho de custom_pipelines.id] + stage_key
--     + organization_id). custom_pipe_entries → pipeline_entries carrega
--     exatamente esse stage_key (sync_custom_pipe_to_entries, 20260981000000),
--     e pipeline_stage_events herda pipeline_id/to_stage_key da entry — então o
--     caderno de venda (fn_capture_sale_event) resolve o role certo e emite.
--   · caso contrário (system) → pipelines.slug → pipeline_stages, IDÊNTICO ao
--     20270302000030 (sem regressão).
-- Retorna NULL só quando NENHUM dos dois governa a etapa (≙ open, fast-path do
-- capture). p_stage_key NULL → NULL (entrada sem stage). A dispatch por
-- pipelines.type (não por slug) evita qualquer colisão slug system↔custom.

CREATE OR REPLACE FUNCTION public.metric_stage_role(
  p_organization_id uuid,
  p_pipeline_id     uuid,
  p_stage_key       text
)
RETURNS public.stage_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.type = 'custom' THEN (
      SELECT cps.stage_role
      FROM public.custom_pipeline_stages cps
      WHERE cps.pipeline_id     = p.id
        AND cps.organization_id = p.organization_id
        AND cps.stage_key       = p_stage_key
    )
    ELSE (
      SELECT ps.stage_role
      FROM public.pipeline_stages ps
      WHERE ps.organization_id = p.organization_id
        AND ps.pipeline_type   = p.slug
        AND ps.stage_key       = p_stage_key
    )
  END
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id
    AND p.organization_id = p_organization_id
    AND p_stage_key IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.metric_stage_role(uuid, uuid, text) IS
  'ADR-0017 §1 / #993 / U1 — resolve o stage_role governado de (org, pipeline, '
  'stage_key). Dispatch por pipelines.type: custom → custom_pipeline_stages '
  '(pipeline_id + stage_key), system → pipelines.slug → pipeline_stages. NULL = '
  'nenhum governa (≙ open). Ponto único de extensão da governança de etapa.';

-- ============================================================================
-- 2. Colunas de sugestão — espelho EXATO de pipeline_stages (#991)
-- ============================================================================
-- Mesmas colunas, mesmos CHECKs, mesmo índice parcial de fila de revisão. O
-- classifier (U4, edge fn classify-stage-roles) escreve AQUI para etapas custom:
-- meeting_* auto-aplicam em stage_role; won/lost ficam PENDENTES em
-- suggested_stage_role até confirmação humana (won/lost = dinheiro, ADR-0017 §1).
-- Persistência em coluna (não tabela): estado 1:1 efêmero da etapa; o histórico
-- de MÉTRICA vive nos ledgers, nunca aqui. Mesma justificativa do #991.

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN suggested_stage_role public.stage_role,
  ADD COLUMN stage_role_suggested_at timestamptz,
  ADD COLUMN stage_role_suggestion_source text,
  ADD COLUMN stage_role_reviewed_at timestamptz,
  ADD COLUMN stage_role_reviewed_by uuid;

ALTER TABLE public.custom_pipeline_stages
  ADD CONSTRAINT custom_pipeline_stages_suggested_role_not_open
    CHECK (suggested_stage_role IS DISTINCT FROM 'open'),
  ADD CONSTRAINT custom_pipeline_stages_suggestion_source_valid
    CHECK (
      stage_role_suggestion_source IS NULL
      OR stage_role_suggestion_source IN ('deterministic', 'ai', 'flag')
    );

COMMENT ON COLUMN public.custom_pipeline_stages.suggested_stage_role IS
  '#991 / U1 / ADR-0017 §1 — sugestão PENDENTE do Stage Role Classifier. Só '
  'won/lost persistem aqui (meeting_* auto-aplicam em stage_role). Limpa na '
  'revisão humana. NUNCA é input de métrica.';
COMMENT ON COLUMN public.custom_pipeline_stages.stage_role_suggested_at IS
  '#991 / U1 — quando o classifier sugeriu/aplicou por último.';
COMMENT ON COLUMN public.custom_pipeline_stages.stage_role_suggestion_source IS
  '#991 / U1 — origem: deterministic (sinônimos pt-BR) | ai (LLM) | flag '
  '(is_final_positive/negative como sinal fraco).';
COMMENT ON COLUMN public.custom_pipeline_stages.stage_role_reviewed_at IS
  '#991 / U1 — quando um humano resolveu a sugestão won/lost. Marcador '
  'anti-re-sugestão em re-runs do classifier.';
COMMENT ON COLUMN public.custom_pipeline_stages.stage_role_reviewed_by IS
  '#991 / U1 — auth.users.id de quem confirmou (won/lost = dinheiro = auditável). '
  'Sem FK de propósito: master user pode ser removido sem quebrar a trilha.';

-- Fila de revisão master: índice parcial enxuto (só linhas com pendência).
CREATE INDEX idx_custom_pipeline_stages_pending_role_suggestion
  ON public.custom_pipeline_stages (organization_id)
  WHERE suggested_stage_role IS NOT NULL;

-- ============================================================================
-- 4. Money guard — won/lost em custom exige admin/master/backend
-- ============================================================================
-- REUSA fn_pipeline_stages_guard_money_role (FIX-4, 20270302000090): o corpo
-- lê SÓ NEW.stage_role, NEW.organization_id, OLD.stage_role e TG_OP — todos
-- presentes em custom_pipeline_stages após a coluna acima. DRY: uma função de
-- gate, dois cadernos de etapa (system + custom). Allow-list idêntica:
-- service_role/superuser (seed, classifier, jobs) · master (/master/stage-roles)
-- · admin da org (modal de etapa). open/meeting_* seguem livres pro membro.
--
-- FIRE-ORDER: custom_pipeline_stages NÃO tem trigger BEFORE de mapa de sistema
-- (custom começa 'open'; não há system_stage_role pra custom). O único BEFORE
-- que mexe em linha aqui é trg_custom_pipeline_stages_updated_at, que só toca
-- updated_at. Logo este guard, sozinho, já enxerga o role FINAL — sem
-- dependência de ordem alfabética (diferente de pipeline_stages, onde o gate é
-- nomeado pra rodar após o trigger de mapa). RLS de custom_pipeline_stages
-- ("Users can manage ... FOR ALL USING org = get_user_organization_id()") não
-- distingue admin de membro nesta coluna — por isso o gate vive no trigger.

DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_won_lost_guard
  ON public.custom_pipeline_stages;
CREATE TRIGGER trg_custom_pipeline_stages_won_lost_guard
  BEFORE INSERT OR UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_pipeline_stages_guard_money_role();
