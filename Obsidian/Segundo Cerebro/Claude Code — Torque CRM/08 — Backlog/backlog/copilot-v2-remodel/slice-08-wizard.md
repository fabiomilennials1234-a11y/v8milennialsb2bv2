---
title: "Slice 8 — Contrato de config / wizard (+ capability config real)"
feature: copilot-v2-remodel
slice: "8"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]", "[[slice-03-tools-media]]", "[[slice-05-guardrails-handoff]]", "[[slice-06-asset-stores]]", "[[slice-07-ingestion-rag]]"]
branch: feat/copilot-v2/slice-8-wizard
handoff: "design (superfície de autoria — grande) → engenheiro"
security: true
tags: [copilot-v2, slice, ready, wizard, security]
---

# Slice 8 — Wizard / contrato de config 🔒

> **Execution-ready 2026-06-02.** Deps (1-H/3/5/6/7) MERGED em develop. Plano via workflow understand→plan (8 agentes). Mapa: [[_MOC]]. Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md`.

## Decisões do CTO (2026-06-02)
1. **Linter escape-hatch:** hard-block, `gemini-2.5-flash` always-on. Regex prefilter (PII/jailbreak, custo zero) → se limpo, 1 classify de conflito de política. Parse falho → fail-CLOSED. (warn-and-allow rejeitado).
2. **Capabilities:** whitelist por arquétipo, default OFF. Qualificador=7; Vendedor=sem `can_handoff`; Carteira=sem `can_set_tier`. Whitelist = const compartilhada gate+UI.
3. **Wizard IA:** híbrido — stepper na criação, tabs na edição. 1 save transacional (sem save-por-seção).
4. **12 seções:** design-first, CTO revisa spec por arquétipo antes da UI (T9). Seção 4 = rubric-form (Qualificador) / objective-dropdown curado (Vendedor/Carteira).

## Desvio de engenharia (vs "Zod shared")
Edge `_shared/copilot-v2/*` é puro (zero deps, deno.json sem zod). `config-schema.ts` = **validador puro hand-rolled** (Deno+Vitest safe, house-style dos `decide*`). FE deriva Zod das constantes exportadas. Mais robusto que forçar zod no Deno.

## Tasks TDD (10) — progresso
- ✅ **T1** `config-schema.ts` — contrato estrito (strict keys, no-coerção, whitelist por arquétipo, escape-hatch ≤500, split/merge persistência). 17 tests.
- ✅ **T2** capability-persistence — wizard→slots→`resolveAgentCapabilities` lossless, fail-closed (mata #52). 4 tests.
- ✅ **T3** `escape-hatch-linter.ts` — `decideEscapeHatchLinter` fail-CLOSED + `prefilterEscapeHatch` (PII/jailbreak) + `buildLinterPrompt`. 13 tests.
- ✅ **T4** `activation-gate.ts` — `decideActivation` (mandatórios + ≥1 cap + qualificador→rubric; soft warns). Mata #29. 8 tests.
- ✅ **T5** `prompt-builder` wiring + `toAgentConfig` — zero token órfão, zero campo órfão (mata #30/#31). 5 tests.
- ✅ **T6** migration `20260602220000_copilot_v2_save_config_rpcs.sql` — `save_copilot_v2_config` + `set_copilot_v2_agent_active` (SECURITY DEFINER, org do agent row, admin-only, upsert único anti-#35, len recheck). Skip integration test (convenção; committed-not-applied).
- ✅ **T7** `save-config-flow.ts` (orquestração pura schema→linter→activation→save) + edge `copilot-v2-save-config/` (wrapper fino). 9 tests. org NUNCA do payload.
- 🟡 **T8** spec de design por arquétipo (12 seções, widgets, enums, IA híbrida) — **EM REVIEW pelo CTO** antes da UI.
- ⏳ **T9** wizard UI + hooks (`wizard-v2/`, `useCopilotV2Config`) — depende T8 aprovado.
- ⏳ **T10** e2e exit proof — caps refletem no gate, hatch malicioso rejeitado, sem órfão.

**Backend (T1–T7) verde:** suíte copilot-v2 `48 files / 342 pass / 12 skip`.

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
