---
title: "Fase D — Hardening world-class (W1–W15)"
feature: copilot-v2-remodel
phase: "D — World-class"
status: brief
branch: "feat/copilot-v2/wN-<nome> (um por W)"
handoff: "arquiteto → design/engenheiro por W"
tags: [copilot-v2, phase, brief, world-class]
---

# Fase D — World-class (W1–W15)

> **Brief de execução.** Cada Wn é um tracer-bullet vertical com branch própria. Detalhe no ADR-0002 addendum + `SPEC.md` (W1–W15). Mapa: [[_MOC]].

## Pré-produção (no ⛳ Portão de produção — obrigatórios)

| W | Tema | Dep |
|---|---|---|
| **W4** | Realismo de entrega (split natural, typing, latência, guard de duplicado) | [[slice-1H-harness-hardening]] |
| **W10** | Governança de custo + kill-switch UX (teto/org/dia, degradação graciosa, auto-pausa) | 1-H, [[slice-09-simulator]] |
| **W12** | Red-team release gate (injeção/exfil/jailbreak/over-promise) | W13 |
| **W13** ✅ | Industrialização do eval (regressão em CI, judge→dataset) — **PR aberto → develop (2026-06-03)** | [[slice-10-tracing]] |

> **W13 — implementado (PR → develop, 2026-06-03).** Não recomeçou a Slice 9: industrializou. Entregou fingerprint prompt/modelo/tool (re-bless forçado), `eval-golden.json` (dataset golden de cognição por arquétipo + cache LLM hermético), gate de dataset bloqueante (regressão introduzida → CI vermelho, verificado), loop judge→dataset (mapper puro → candidato `enabled=false`, curadoria manual = CTO D2), persistência de `eval_runs` (org do contexto, `trace_id` nullable = D4) e workflow CI path-filtered pré-merge (D5). 2 migrations committed-not-applied (seed golden org-guarded + `trace_id`). Decisões: D1 cognition goldens (5 incidentes v1 ficam regressões de harness) · D3 fixture commitado fonte-única. **Follow-up (fora do gate):** UI de curadoria de candidatos + espelho FE `JUDGE_CATEGORIES` + contract-lock; eval semântico de carteira. Detalhe: `.specs/features/copilot-v2/PROGRESS.md`. **Desbloqueia W12** (red-team na mesma eval-suite).

## Recomendados (alta qualidade, podem entrar cedo)
- **W2** — Gestão de contexto (compactação com piso de fatos + extração background). Dep: 1-H, W1.
- **W8** — Defer-safety (confiança por turno + idioma/fora-de-escopo → handoff). Dep: 8, 9.

## Pós-launch (melhoria contínua)
- **W1** Lead Fact Memory · **W3** Sinais→ação (buying-intent + frustração + cadência) · **W5** Toolkit comercial (build_quote/pricing/payment_terms) · **W6** Inteligência de Carteira (reorder forecast) · **W7** Grounding (spec Q&A + gate de claims) · **W9** Ledger de ações + undo · **W11** Linter de brand-voice/política · **W14** Copilot como nó de workflow · **W15** Legibilidade (ActivityTimeline + funil por arquétipo).

**Dropado:** A/B variants por agente (conflita com base prompt imutável; sem significância em ~30 orgs). Comparação de versões vai pro eval-suite.
