-- 20270106000000_blast_plans_post_send_target.sql
--
-- Disparos wizard "Destino" step: optional post-send lead move. When set, each
-- recipient is moved to this funnel stage AT THE MOMENT its message is sent
-- (per lot — Blast Plans drain over days, so the move is per-lead, never all
-- at once).
--
-- Shape (validated FAIL-CLOSED by blast-plan-create before persisting):
--   {
--     "funnelKind":   "system" | "custom",
--     "pipelineType": "whatsapp" | "confirmacao" | "propostas",  -- system only
--     "pipelineId":   "<custom_pipelines.id uuid>",              -- custom only
--     "stageKey":     "<pipeline_stages.stage_key | custom_pipeline_stages.id>",
--     "label":        "Oportunidades · Em negociação"            -- display only
--   }
--
-- NULL = no post-send move (default; every pre-existing plan keeps behaving
-- exactly as before). No RLS change: blast_plans policies already scope the
-- table; the column is data on an existing tenant-scoped row.

ALTER TABLE public.blast_plans
  ADD COLUMN IF NOT EXISTS post_send_target jsonb NULL;

COMMENT ON COLUMN public.blast_plans.post_send_target IS
  'Optional post-send destination: {funnelKind, pipelineType|pipelineId, stageKey, label}. Each recipient is moved there when its message is sent (per lot). NULL = keep leads where they are. Validated fail-closed by blast-plan-create.';
