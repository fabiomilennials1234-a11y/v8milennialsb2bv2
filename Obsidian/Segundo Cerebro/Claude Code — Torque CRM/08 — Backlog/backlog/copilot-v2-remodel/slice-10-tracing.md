---
title: "Slice 10 — Tracing + eval dataset (transversal)"
feature: copilot-v2-remodel
slice: "10"
phase: "B — Capabilities core (transversal)"
status: "em-andamento (routing/contact-status feito)"
depends_on: []
branch: feat/copilot-v2/slice-10-tracing
handoff: "engenheiro"
security: false
tags: [copilot-v2, slice, brief, observability]
---

# Slice 10 — Tracing + eval dataset

> **Brief de execução.** Transversal — começa cedo, continua durante tudo. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Observabilidade ponta-a-ponta + base de regressão (incidente→caso).

## Escopo (SPEC #10)
- `trace_id` propagado borda→queue→cognição→tools→saída; steps em `copilot_v2_trace_steps`.
- Sessões por conversa/lead.
- Eval dataset: cada incidente vira caso; runner roda a suíte a cada mudança de base prompt (regression guard). CI gate = [[phase-D-world-class]] W13.
- (Futuro) adaptador Langfuse plugável.

## Touches
`copilot_v2_traces`, `copilot_v2_trace_steps`, `copilot_v2_eval_cases`, runner.

## Exit
1 turno = 1 trace correlacionável; mudar base prompt + rodar suíte detecta regressão introduzida de propósito.
