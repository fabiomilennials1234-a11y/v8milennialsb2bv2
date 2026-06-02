---
title: "Slice 12 — Rollout org-a-org + decommission v1"
feature: copilot-v2-remodel
slice: "12"
phase: "C — Rollout"
status: brief
depends_on: ["[[slice-03-tools-media]]", "[[slice-05-guardrails-handoff]]", "[[slice-06-asset-stores]]", "[[slice-07-ingestion-rag]]", "[[slice-08-wizard]]", "[[slice-09-simulator]]", "[[slice-11-proactivity]]", "[[slice-10-tracing]]"]
branch: feat/copilot-v2/slice-12-rollout
handoff: "arquiteto (orquestra) → engenheiro"
security: true
prod_gated: true
tags: [copilot-v2, slice, brief, rollout, prod-gated]
---

# Slice 12 — Rollout + decommission v1 🔒 (PROD = CTO-gated)

> **Brief de execução.** ⚠️ **Cutover em produção exige autorização explícita do CTO na sessão.** Só depois do ⛳ Portão de produção (ver [[_MOC]]). Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Migrar ~30 orgs sem big-bang, depois deletar a v1 — **um motor**.

## Escopo (SPEC #12 + cutover da auditoria)
- Routing flag por org no `whatsapp-webhook` (v1 legado | v2 definitivo) — **rollback = flip de volta**.
- Milennials-first → org-a-org: CTO re-preenche wizard novo (pré-preencher do v1 onde mapeável — ver mapeamento tipo-v1→arquétipo no [[_MOC]]), testa dry-run, flipa `is_active`.
- v1 coexiste até a última org migrar.
- **Decommission final**: DELETAR GEN-1 (`agent-message` + `_shared/copilot/*`) + fila v1 (`copilot_message_queue`, `copilot-batch-processor`) + qualquer dead code/flag restante.

## Touches
`whatsapp-webhook` (routing flag), `copilot_v2_agents.is_active`, migração de config v1→wizard v2, deleção GEN-1.

## Exit
Milennials 100% v2 com traces saudáveis antes da 2ª org; org-a-org; ao final GEN-1 deletada.

## 🔒 Segurança
migração de dados, multi-tenant, rollback documentado.
