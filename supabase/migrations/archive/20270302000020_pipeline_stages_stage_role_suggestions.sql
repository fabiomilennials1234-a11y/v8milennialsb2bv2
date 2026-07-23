-- 20270302000020_pipeline_stages_stage_role_suggestions.sql
--
-- Issue #991 · PRD #986 · ADR-0017 §1 — persistência das sugestões do
-- AI Stage Classifier (padrão ADR-0006) para etapas CUSTOM.
--
-- Escolha de persistência: colunas em `pipeline_stages`, não tabela própria.
-- Justificativa: a sugestão é estado 1:1 e efêmero da etapa (pendente até
-- revisão humana); tabela separada exigiria FK + RLS + join em toda leitura
-- sem ganhar nada — não há histórico a preservar (o histórico de MÉTRICA vive
-- nos ledgers do ADR-0017, nunca aqui). A RLS existente de `pipeline_stages`
-- (org isolation + `master_all_pipeline_stages` FOR ALL USING is_master_user())
-- já cobre exatamente os dois consumidores: modal de etapa (org admin) e tela
-- master de revisão won/lost.
--
-- Semântica (ADR-0017 §1 — won/lost = dinheiro = confirmação humana):
--   · Sugestão meeting_booked/meeting_held → classifier AUTO-APLICA
--     (stage_role atualizado direto; suggested_stage_role fica NULL — nada
--     pendente; source/suggested_at ficam como trilha).
--   · Sugestão won/lost → fica PENDENTE em `suggested_stage_role` até um
--     master aprovar/corrigir (tela /master/stage-roles) ou o admin da org
--     escolher explicitamente no modal de etapa. Nenhum caminho de código
--     aplica won/lost sem ação humana.
--   · `stage_role_reviewed_at/by` = trilha da confirmação humana (dinheiro é
--     auditável) e marcador de "já examinada" — re-runs do classifier não
--     re-sugerem etapa dispensada/corrigida.
--
-- Rollback: supabase/migrations/rollback/20270302000020_pipeline_stages_stage_role_suggestions.sql

ALTER TABLE public.pipeline_stages
  ADD COLUMN suggested_stage_role public.stage_role,
  ADD COLUMN stage_role_suggested_at timestamptz,
  ADD COLUMN stage_role_suggestion_source text,
  ADD COLUMN stage_role_reviewed_at timestamptz,
  ADD COLUMN stage_role_reviewed_by uuid;

-- Sugerir 'open' é não-sugestão; fonte restrita ao vocabulário do classifier.
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_suggested_role_not_open
    CHECK (suggested_stage_role IS DISTINCT FROM 'open'),
  ADD CONSTRAINT pipeline_stages_suggestion_source_valid
    CHECK (
      stage_role_suggestion_source IS NULL
      OR stage_role_suggestion_source IN ('deterministic', 'ai', 'flag')
    );

COMMENT ON COLUMN public.pipeline_stages.suggested_stage_role IS
  '#991 / ADR-0017 §1 — sugestão PENDENTE do Stage Role Classifier. Só '
  'won/lost persistem aqui (meeting_* auto-aplicam em stage_role). Limpa na '
  'revisão humana (aprovar/corrigir/dispensar). NUNCA é input de métrica.';
COMMENT ON COLUMN public.pipeline_stages.stage_role_suggested_at IS
  '#991 — quando o classifier sugeriu/aplicou por último.';
COMMENT ON COLUMN public.pipeline_stages.stage_role_suggestion_source IS
  '#991 — origem da sugestão: deterministic (sinônimos pt-BR) | ai (LLM) | '
  'flag (is_final_positive/negative como sinal fraco).';
COMMENT ON COLUMN public.pipeline_stages.stage_role_reviewed_at IS
  '#991 — quando um humano resolveu a sugestão won/lost (aprovou/corrigiu/'
  'dispensou). Também é o marcador anti-re-sugestão em re-runs do classifier.';
COMMENT ON COLUMN public.pipeline_stages.stage_role_reviewed_by IS
  '#991 — auth.users.id de quem confirmou (won/lost = dinheiro = auditável). '
  'Sem FK de propósito: master user pode ser removido sem quebrar a trilha.';

-- Fila de revisão master (~30 orgs): busca é sempre "todas as pendências",
-- então índice parcial e enxuto — só linhas com sugestão pendente existem nele.
CREATE INDEX idx_pipeline_stages_pending_role_suggestion
  ON public.pipeline_stages (organization_id)
  WHERE suggested_stage_role IS NOT NULL;

-- Backfill das ~30 orgs: NÃO roda aqui. O mapa de sinônimos é TS (fonte única
-- em supabase/functions/_shared/metrics/stage-role-classifier.ts, com twin
-- frontend pinado por teste) — duplicá-lo em SQL criaria segunda fonte com
-- drift garantido. O backfill é a edge function `classify-stage-roles` com
-- body {"all_orgs":true}, invocada uma vez pós-deploy:
--
--   curl -X POST "$SUPABASE_URL/functions/v1/classify-stage-roles" \
--     -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
--     -d '{"all_orgs": true}'
