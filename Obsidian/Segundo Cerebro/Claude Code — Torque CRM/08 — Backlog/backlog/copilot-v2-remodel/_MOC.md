---
title: "Copilot v2 — Remodelagem (MOC de execução)"
feature: copilot-v2-remodel
type: MOC
status: ativo
created: 2026-06-02
tags: [copilot-v2, MOC, execution]
---

# Copilot v2 — Remodelagem (Map of Content)

Plano definitivo de execução pra levar o copilot-v2 de **deployado-mas-inerte** a **motor único em produção (100% do tráfego)**, com a v1 decomissionada.

- **Plano mestre:** `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (merge ADR-0002 + SPEC + PROGRESS + auditoria 2026-06-02)
- **Decisões imutáveis:** `docs/adr/0002-copilot-v2-architecture.md`
- **Auditoria base:** 73 findings verificados (relatório no Desktop) — define os gaps de [[slice-1H-harness-hardening]]
- **Regras:** tudo em `develop` · prod só com CTO (Slice 12) · TDD incidente→regressão · migration via MCP · fail-closed

## Estado atual (baseline)
- ✅ Slices **0, 1, 2, 3-parcial, 4, 10** mergeados em develop. 133 testes TDD. Runtime vivo em prod mas **inerte** (`is_active=FALSE`, nenhuma instância Uazapi apontada).
- 🔴 4 tools `not_implemented`: `send_media`, `search_knowledge`, `schedule_meeting`, `handoff_to_vendedor`.

## Fluxo de execução

```
A (Hardening)  0-C ──► 1-H [pré-req duro]
B (Capabilities)        ├─► 3 · 5 · 6 · 7 · 11  (paralelos após 1-H) · 10 (transversal)
                        └─► 8 (integra) ──► 9
                              ▼
                    [W4 · W10 · W12 · W13]  ◄── must-have
                              ▼
                       ⛳ PORTÃO DE PRODUÇÃO
                              ▼
C (Rollout)            12 (org-a-org + decommission v1)  ◄── CTO-gated
D (World-class)        W1–W15 (priorizados)
```

## Slices

### Fase A — Hardening (bloqueia ativação)
- [[slice-0C-cleanup]] — 🟢 pronto pra execução (independente). Deletar dead code GEN-2 + flag inerte.
- [[slice-1H-harness-hardening]] — 🟢 pronto pra execução. 🔒 Os 7 gaps estruturais da auditoria (loop-gate, debounce, re-check pause no envio, claim/reaper, dedup atômico, ResolvedContext, caps reais). **Pré-requisito duro de tudo.**

### Fase B — Capabilities core
- [[slice-03-tools-media]] — 🔒 tools restantes + mídia (incl. áudio). Dep: 1-H.
- [[slice-05-guardrails-handoff]] — 🔒 5 gates + notificação de handoff ao responsável. Dep: 1-H.
- [[slice-06-asset-stores]] — 🔒 send-media (incl. áudio) + KB. Dep: 1-H.
- [[slice-07-ingestion-rag]] — 🔒 ingestão/RAG + audit inbound. Dep: 1-H.
- [[slice-08-wizard]] — 🔒 wizard 12 seções + capability config real. Dep: 1-H, 3, 5, 6, 7.
- [[slice-09-simulator]] — simulador dry-run + eval-suite. Dep: 8.
- [[slice-10-tracing]] — tracing + eval dataset (transversal, em andamento).
- [[slice-11-proactivity]] — 🔒 proatividade/scheduler idempotente. Dep: 1-H.

### ⛳ Portão de produção (Milennials 100% v2)
Todos verdes: 0-C, 1-H, 3, 5, 6, 7, 8, 9, 11, 10 + W4/W10/W12/W13 + suíte de regressão dos 5 incidentes v1 + RLS cross-org por tabela + dogfood Milennials validado por trace.

### Fase C — Rollout
- [[slice-12-rollout]] — 🔒 **CTO-gated.** Org-a-org + decommission GEN-1/GEN-2.

### Fase D — World-class
- [[phase-D-world-class]] — W1–W15 (must-have: W4/W10/W12/W13).

## Mapeamento de migração (tipo v1 → arquétipo)
| Tipo v1 | Vira |
|---|---|
| qualificador, sdr, prospectador | **Qualificador** |
| (vendas/fechamento) | **Vendedor** |
| pós-venda/upsell | **Carteira** |
| agendador | capability `schedule_meeting` |
| followup | capability de cadência (Slice 11) |
| custom | caso-a-caso (CTO no re-preenchimento) |

## ⚠️ Decisões abertas / a sinalizar
- **Slice 1-H / Task 7:** o fix de capability-gate flipa v2 de all-caps-ON pra **fail-closed** (nada habilitado até `slots.capabilities` ser setado). Correto, mas agentes v2 de dev param de escrever até serem configurados. Confirmado como intencional.
- **Slice 6:** cap da biblioteca send-media pra acomodar áudio (≤5/tipo vs ≤N total) — resolver no design.
