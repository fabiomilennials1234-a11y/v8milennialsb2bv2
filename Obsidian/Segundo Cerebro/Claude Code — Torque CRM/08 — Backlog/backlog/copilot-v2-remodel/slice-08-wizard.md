---
title: "Slice 8 — Contrato de config / wizard (+ capability config real)"
feature: copilot-v2-remodel
slice: "8"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-1H-harness-hardening]]", "[[slice-03-tools-media]]", "[[slice-05-guardrails-handoff]]", "[[slice-06-asset-stores]]", "[[slice-07-ingestion-rag]]"]
branch: feat/copilot-v2/slice-8-wizard
handoff: "design (superfície de autoria — grande) → engenheiro"
security: true
tags: [copilot-v2, slice, brief, wizard, security]
---

# Slice 8 — Wizard / contrato de config 🔒

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Formulário de 12 seções por arquétipo, slots tipados + escape-hatch vigiado, alimentando o capability-gate de verdade.

## Escopo (SPEC #8 + #52 + mata #29/#30/#31/#35 da v1)
- Wizard por arquétipo: 12 seções, **slots tipados** (dropdown/número/lista/texto-curto-guiado). **Sem edição do prompt.**
- **Capability config real por agente** → alimenta o capability-gate de [[slice-1H-harness-hardening]] (mata #52). ⚠️ Lembrar: 1-H já flipou v2 pra fail-closed; aqui o operador habilita caps explicitamente.
- Escape-hatch único ≤500 char por arquétipo → **LLM-linter** rejeita conflito/PII/jailbreak antes de salvar.
- **Save transacional** (RPC único, sem órfão de mídia/doc — mata #35 da v1).
- **Validação de ativação real** (não o gate morto #29 da v1).
- **Um** prompt-builder (slots → base imutável), sem a divergência de 2 builders #30/#31 da v1.

## Touches
`copilot_v2_config` (slots), wizard UI (substitui o Playground v1), RPC save transacional, LLM-linter.

## Exit
Operador cria + ativa arquétipo com validação real; escape-hatch malicioso rejeitado; nenhum campo free-text além do escape-hatch; caps configuradas refletem no gate; save sem órfão (round-trip sem perda).

## 🔒 Segurança
escape-hatch = superfície de injeção (linter + cap + sanitização).
