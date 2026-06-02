---
title: "Slice 5 — Guardrails cumulativos + notificação de handoff (definitiva)"
feature: copilot-v2-remodel
slice: "5"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]"]
branch: feat/copilot-v2/slice-5-guardrails-handoff
handoff: "design (UX sino/toast/config phone+role) → engenheiro (DB+RPC+realtime+PII)"
security: true
tags: [copilot-v2, slice, brief, guardrails, notification, security]
---

# Slice 5 — Guardrails + notificação de handoff 🔒

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Os 5 gates cumulativos + HITL toggle + notificação de handoff humano **confiável, estruturada e idempotente** ao responsável do lead.

## Escopo (merge SPEC #5/#7 + auditoria + NET-NEW requisito CTO)
- **5 gates**: capability-gate (formalizado), tool-call budget (5/turno), loop-detector (exposto), **output LLM-as-judge** (modelo barato veta preço/promessa/credencial/tom antes do envio — possivelmente amostrado), **input short-circuit** (spam/abuso/concorrente → resposta padrão sem gastar LLM).
- **HITL**: toggle por org (default off) — aprovar/editar/rejeitar antes de ação crítica em lead alto valor.
- **`transfer_to_human` → notificação:**
  - **In-app**: insere em `notifications` → entrega **realtime** (canal + toast + sino `AlertsDropdown`), não polling. Destino: **responsável do lead** (role-aware: `responsible_id` → fallback `closer_id`/`sdr_id` → fallback time ativo).
  - **WhatsApp ao responsável (pessoa)**: novo `team_members.phone` (opt-in) + roteamento por role; mantém `handoff_notify_phones` legado p/ grupos. **NET-NEW.**
  - Conteúdo estruturado: lead / tier / motivo / resumo / deeplink.
  - **Idempotente** por chave estável (não time-bucket frágil do v1, #26); entrega por caminho confiável (não o worker bugado v1 #7/#9).

## Touches
migration `team_members.phone` + `notifications`; RPC de fan-out org-scoped; canal realtime; `_shared/copilot-v2/tool-executor.ts` (`transfer_to_human`/`handoff_to_vendedor`); UI sino/toast/config.

## Exit
Lead movido pra humano → responsável recebe in-app realtime **e** WhatsApp no dev; judge bloqueia promessa proibida; short-circuit não chama LLM; HITL on pausa + pede aprovação; entrega idempotente (sem duplicar).

## 🔒 Segurança
PII (telefone do membro), multi-tenant (fan-out só dentro da org), estado de conversa.
