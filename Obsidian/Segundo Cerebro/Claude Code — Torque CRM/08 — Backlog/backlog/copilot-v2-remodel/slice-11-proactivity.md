---
title: "Slice 11 — Proatividade / scheduler"
feature: copilot-v2-remodel
slice: "11"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]"]
branch: feat/copilot-v2/slice-11-proactivity
handoff: "engenheiro"
security: true
tags: [copilot-v2, slice, brief, scheduler]
---

# Slice 11 — Proatividade / scheduler 🔒

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Agente inicia conversa (não só responde), sem double-send.

## Escopo (SPEC #11 + mata #7/#8/#9 da v1)
- First-touch: ad lead via lead-webhook → Qualificador manda 1ª msg.
- Followup agendado: lead frio reengaja na cadência.
- Resgate Carteira: cliente dormindo reabre conversa.
- Scheduler pg_cron → edge, respeitando horário + rate-limit.
- **Claim idempotente + UNIQUE constraints** (mata o double-send da v1 #7/#8/#9). Massa fria fica em `campaigns` (não duplicar).

## Touches
scheduler (pg_cron → edge), claim RPC idempotente, integração lead-webhook, cadência Carteira.

## Exit
Ad lead recebe first-touch; followup dispara na janela **sem duplicar**; resgate só pra dormindo; sem colisão com campaigns.

## 🔒 Segurança
rate-limit, idempotência, multi-tenant.
