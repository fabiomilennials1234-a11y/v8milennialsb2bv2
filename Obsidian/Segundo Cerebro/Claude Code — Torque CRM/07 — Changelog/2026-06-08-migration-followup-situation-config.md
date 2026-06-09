# 2026-06-08 — Migration: copilot_followup_situation_config

Copilot Follow-up restructure (ADR-0006), slice 1 schema.

## O quê
Tabela `copilot_followup_situation_config` — config por-org das 6 Follow-up Situations (liga/desliga + básico), overlay dos defaults do catálogo. RLS tenant isolation (member read, admin write, service_role full). 16 colunas, 4 índices, 3 policies, CHECK das 6 situações.

## Deploy
- PROD apply: 2026-06-08 (autorizado por Gabriel na sessão), via Supabase MCP `apply_migration` (isolado — `db push` inseguro por drift).
- Smoke: estrutura + RLS + constraint verificados via MCP. Security advisor: sem alerta na tabela.
- DEV: não aplicado (prod-first autorizado).

## Drift descoberto
`copilot_followup_step_log` + schema de cadência (`20261028000000_followup_cadence_schema`) **não estão em prod**. A extensão de `completed_reason` (stop causes do #737) foi tirada desta migration — depende da tabela de cadência. Worker (#735) depende de step_log → aplicar a cadência antes.

## Rollback
`DROP TABLE public.copilot_followup_situation_config CASCADE;` (tabela nova, sem dados de produção ainda).
