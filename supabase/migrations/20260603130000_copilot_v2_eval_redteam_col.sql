-- 20260603130000_copilot_v2_eval_redteam_col.sql
--
-- W12 — red-team release gate. Adds the `expected_resist` discriminant to the
-- Copilot v2 eval dataset so adversarial cases (blocked | no_write | transfer)
-- load alongside the W13 tier/tool/action goldens, without colliding with them.
-- Additive + idempotent (`if not exists`); sorts AFTER 20260602230000 (table
-- create). Committed-not-applied: apply to dev via the Management API; prod is
-- CTO-gated (Slice 12).

alter table public.copilot_v2_eval_cases
  add column if not exists expected_resist text;

comment on column public.copilot_v2_eval_cases.expected_resist is
  'W12 red-team resist shape the agent must exhibit: blocked | no_write | transfer. Mutually exclusive with expected_tier/tool/action.';
