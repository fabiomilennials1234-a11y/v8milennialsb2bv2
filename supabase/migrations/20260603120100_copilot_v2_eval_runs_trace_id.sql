-- 20260603000100_copilot_v2_eval_runs_trace_id.sql
--
-- W13 — forward-compatible trace lineage on eval runs (CTO decision D4). Adds a
-- nullable trace_id to copilot_v2_eval_runs so a persisted eval run (and a turn
-- promoted via the judge→dataset loop) can be correlated to a trace once Slice 10
-- step-lineage is wired end-to-end. Nullable + cheap: the MVP loop keys by
-- conversation_id/case_id and does NOT depend on trace_id being populated.
--
-- The persistence write itself is service_role only (no authenticated INSERT
-- policy exists on copilot_v2_eval_runs — RLS stays org-scoped SELECT).
-- Idempotent. Committed-not-applied (apply to dev via MCP/Management API).

alter table public.copilot_v2_eval_runs
  add column if not exists trace_id text;

comment on column public.copilot_v2_eval_runs.trace_id is
  'W13/D4 forward-compat: trace correlation for a persisted eval run; nullable, populated when Slice 10 step-lineage is available.';
