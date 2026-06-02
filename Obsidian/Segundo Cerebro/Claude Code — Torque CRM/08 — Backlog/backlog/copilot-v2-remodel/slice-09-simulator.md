---
title: "Slice 9 — Simulador dry-run + eval-suite"
feature: copilot-v2-remodel
slice: "9"
phase: "B — Capabilities core"
status: brief
depends_on: ["[[slice-08-wizard]]"]
branch: feat/copilot-v2/slice-9-simulator
handoff: "design (UI simulador + trace) → engenheiro"
security: false
tags: [copilot-v2, slice, brief, eval]
---

# Slice 9 — Simulador dry-run + eval-suite

> **Brief de execução.** Detalhe via `superpowers:writing-plans` quando desbloqueado. Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Goal
Passo final do wizard: chat ao vivo que testa o agente sem mutar dados + rodar a eval-suite do arquétipo.

## Escopo (SPEC #9)
- Chat ao vivo: operador digita como lead; agente usa base prompt real + config; tools renderizadas como "IRIA executar" (dry-run, zero escrita); trace exibido (tool escolhida, por quê, tier extraído).
- Botão "rodar eval-suite" → roda `copilot_v2_eval_cases` do arquétipo → verde/vermelho.

## Touches
UI simulador, dry-run no tool-executor, leitura de trace, `copilot_v2_eval_cases`.

## Exit
Dry-run não muta dados; eval-suite mostra pass/fail por caso; trace legível.
