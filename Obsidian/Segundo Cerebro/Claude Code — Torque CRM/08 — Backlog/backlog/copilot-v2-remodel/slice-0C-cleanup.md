---
title: "Slice 0-C — Limpeza de dead code GEN-2 + flag inerte"
feature: copilot-v2-remodel
slice: "0-C"
phase: "A — Hardening"
status: ready
blocks: "nenhum (independente — pode rodar já)"
depends_on: []
branch: feat/copilot-v2/slice-0c-cleanup
security: false
tags: [copilot-v2, slice, execution-ready, cleanup]
---

# Slice 0-C — Limpeza de dead code GEN-2 + flag inerte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans`. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-0c-cleanup` ← `develop`, PR → `develop`, **nunca main**. QA com counts literais. Verify-no-importer antes de cada deleção; importer de produção inesperado → **parar e sinalizar**.
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` · Bloqueia: nada (independente) · Próximo: [[slice-1H-harness-hardening]]

---

## Goal
Remover 8 módulos GEN-2 mortos em `supabase/functions/_shared/copilot/` (zero importers de produção, só tests/self-reference), seus tests-âncora, e a flag inerte `copilot_engine_version` (read morto em `agent-message` + UI enganosa "Ativar v2"/"Voltar v1" no master + hooks de mutation). Risco BAIXO, mecânico. Nenhuma mudança de comportamento runtime.

## Architecture
- **Dead code GEN-2**: refactor abandonado da Trilha 3.B. As classes `AgentRouter` / `LeadProfileBuilder` / `KnowledgeRetriever` e os skeletons `prompt-builder` / `llm-client` / `followup` / `followup-response-detector` / facade `sanitizer` nunca foram ligados ao `agent-message` live (que usa `agent-message/engine/*` + `_shared/message-sanitizer.ts` diretamente). Verificado: zero importers de produção.
- **Flag inerte `copilot_engine_version`**: lida em `agent-message/index.ts:255-260` e injetada em telemetria (`:346`), mas nunca altera control-flow (comentário "Hoje v1==v2 funcionalmente"). UI master expõe toggle que escreve a coluna mas não faz nada. Coluna do DB **permanece** (fora de escopo — migration separada se desejado); só removemos o código morto que a lê/escreve.
- **Test runner**: tests em `tests/unit/copilot/` rodam via **vitest** (não Deno). Comando relevante = `npm run test:unit`.

### Verificação que fundamenta o plano (já executada pelo planejador)
- `agent-router.ts` / `AgentRouter` → só `agent-router.ts` + `tests/unit/copilot/agent-router.test.ts`.
- `lead-profile-builder.ts` / `LeadProfileBuilder` → só self + `tests/unit/copilot/lead-profile-builder.test.ts`.
- `knowledge-retriever.ts` / `KnowledgeRetriever` → só self + `tests/unit/copilot/knowledge-retriever.test.ts` + bloco em `tests/unit/copilot-rag-tuning.test.ts:54,121-138` (resto do file é LIVE).
- `prompt-builder.ts` + `llm-client.ts` → só self + `tests/unit/copilot/helpers.test.ts` + refs doc em `.specs/`.
- `followup.ts`, `followup-response-detector.ts`, `sanitizer.ts` (facade) → **zero** importers. `tests/unit/copilot/sanitizer.test.ts` importa o REAL `_shared/message-sanitizer.ts` (sobrevive). `tests/unit/copilot-followup-cadence.test.ts` importa `followup-cadence.ts`+`followup-triggers.ts` LIVE (sobrevive).
- Flag: read em `agent-message/index.ts:255-260`, uso em `:346`. UI: `MasterAutomationHealth.tsx` (imports `:41-42`, tab `:122`, content `:143-144`, `EngineTab` `:475-545`). Hooks: `useAutomationHealth.ts` (`OrgEngineRow :231-235`, `useOrgsCopilotEngine :237-250`, `useToggleCopilotEngine :252-266`). Barrel: `workflows/index.ts :87,88,94`.

## Tech Stack
React 18 + TS 5.8 + Vite 5 · Deno edge functions · Vitest · ESLint + dependency-cruiser · `tsc --noEmit`.

## Setup
- [ ] Criar branch a partir de `develop`:
  `git fetch origin && git switch develop && git pull --ff-only && git switch -c feat/copilot-v2/slice-0c-cleanup`
- [ ] Baseline verde antes de tocar nada (anota counts literais):
  `npm run test:unit 2>&1 | tail -20`
  Esperado: suíte passa. Anotar total `Test Files` / `Tests` pra comparar no fim.

---

## Task 1 — Apagar as 3 classes GEN-2 mortas + tests-âncora
**Files**
- Delete: `supabase/functions/_shared/copilot/agent-router.ts`, `lead-profile-builder.ts`, `knowledge-retriever.ts`
- Delete: `tests/unit/copilot/agent-router.test.ts`, `lead-profile-builder.test.ts`, `knowledge-retriever.test.ts`
- Edit: `tests/unit/copilot-rag-tuning.test.ts` (remover só o bloco KnowledgeRetriever)

- [ ] Re-confirmar zero importer de produção (deve listar APENAS as definições + tests):
  `rg -n "copilot/agent-router|AgentRouter|copilot/lead-profile-builder|LeadProfileBuilder|copilot/knowledge-retriever|KnowledgeRetriever" supabase/functions src`
  Se aparecer importer de produção → **PARAR e sinalizar**.
- [ ] `git rm supabase/functions/_shared/copilot/agent-router.ts supabase/functions/_shared/copilot/lead-profile-builder.ts supabase/functions/_shared/copilot/knowledge-retriever.ts`
- [ ] `git rm tests/unit/copilot/agent-router.test.ts tests/unit/copilot/lead-profile-builder.test.ts tests/unit/copilot/knowledge-retriever.test.ts`
- [ ] Editar `tests/unit/copilot-rag-tuning.test.ts`: remover o import do `KnowledgeRetriever` (linha 54) e o bloco `describe("KnowledgeRetriever (tool mode)", ...)` (linhas 121-138), preservando `executeSearchKnowledge (legacy)` e os CYCLE de `buildDynamicPrompt`.
- [ ] `npx vitest run tests/unit/copilot/ tests/unit/copilot-rag-tuning.test.ts` → Esperado: passa; rag-tuning com 4 tests.
- [ ] Commit (conventional, PT, com trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`): `chore(copilot): remover classes GEN-2 mortas (router/profile/retriever)`

## Task 2 — Apagar os 4 skeletons + a facade sanitizer + tests-âncora
**Files**
- Delete: `prompt-builder.ts`, `llm-client.ts`, `followup.ts`, `followup-response-detector.ts`, `sanitizer.ts` (em `_shared/copilot/`)
- Delete: `tests/unit/copilot/helpers.test.ts`

- [ ] `rg -n "copilot/prompt-builder|copilot/llm-client" supabase/functions src tests` → só `helpers.test.ts` + os 2 fontes (ocorrências de `withTimeout` em check-api-health/whatsapp-webhook são definições locais homônimas, NÃO imports).
- [ ] `rg -n "copilot/followup\.ts|copilot/followup-response-detector|markCadenceCompletedOnResponse|copilot/sanitizer" supabase/functions src tests` → só as próprias definições. (Não confundir com `followup-cadence.ts`/`followup-triggers.ts`, que são LIVE.)
- [ ] `git rm` dos 5 fontes + `tests/unit/copilot/helpers.test.ts`.
- [ ] `npx vitest run tests/unit/copilot/sanitizer.test.ts tests/unit/copilot-followup-cadence.test.ts` → Esperado: passa (importam módulos LIVE).
- [ ] Commit: `chore(copilot): remover skeletons GEN-2 e facade sanitizer mortos`

## Task 3 — Remover read inerte de `copilot_engine_version` no agent-message (LIVE — cuidado)
**Files** — Edit: `supabase/functions/agent-message/index.ts` (só flag read + telemetria; NÃO mudar comportamento)

- [ ] `rg -n "engineVersion|copilot_engine_version|ROUTE engine version" supabase/functions/agent-message/index.ts` (confirmar linhas; drift possível).
- [ ] Remover o bloco de leitura da flag (~252-260: comentário + query `orgRow` + `const engineVersion`). Manter `fireTrigger` acima e `// 2.5 INITIALIZE AGENT ENGINE` abaixo.
- [ ] No `trackEvent` (~343-347): remover `engine_version: engineVersion` do `metadata`.
- [ ] `rg -n "engineVersion|copilot_engine_version" supabase/functions/agent-message/index.ts` → **nenhum match** (sem identificador unbound).
- [ ] `npx vitest run tests/unit/agent-engine-fallback.test.ts` → passa (obrigatório ao mexer no agent-message).
- [ ] Commit: `refactor(copilot): remover read inerte de copilot_engine_version`

## Task 4 — Remover UI "Ativar v2"/"Voltar v1" + hooks de mutation
**Files**
- Edit: `src/modules/identity/master/pages/MasterAutomationHealth.tsx` (import dos 2 hooks, aba Engine, função `EngineTab`)
- Edit: `src/modules/workflows/hooks/useAutomationHealth.ts` (`OrgEngineRow`, `useOrgsCopilotEngine`, `useToggleCopilotEngine`)
- Edit: `src/modules/workflows/index.ts` (re-exports do barrel)

- [ ] `rg -n "useOrgsCopilotEngine|useToggleCopilotEngine|OrgEngineRow" src` → consumer único = `MasterAutomationHealth.tsx`.
- [ ] `MasterAutomationHealth.tsx`: remover imports (41-42), `<TabsTrigger value="engine">` (122), `<TabsContent value="engine">` (143-145), ajustar grid `sm:grid-cols-7`→`sm:grid-cols-6` (115), remover função `EngineTab()` (475-545).
- [ ] `useAutomationHealth.ts`: remover `interface OrgEngineRow` + `useOrgsCopilotEngine` + `useToggleCopilotEngine` (229-266), manter `// ─── Audit log ───`.
- [ ] `workflows/index.ts`: remover re-exports `useOrgsCopilotEngine` (87), `useToggleCopilotEngine` (88), `type OrgEngineRow` (94).
- [ ] `rg -n "useOrgsCopilotEngine|useToggleCopilotEngine|OrgEngineRow|EngineTab|copilot_engine_version" src` → **nenhum match** (coluna no `types.ts` auto-gerado não é tocada).
- [ ] `npm run typecheck && npm run lint` → typecheck sem novos erros, eslint limpo.
- [ ] Commit: `refactor(identity): remover UI/hooks da flag copilot_engine_version`

## Task 5 — Verificação final (build + lint + tsc + test:unit completo)
**Files** — nenhum (verificação)

- [ ] `rg --files supabase/functions/_shared/copilot` → NÃO listar os 8 deletados; devem permanecer `context-extractor`, `context-loader`, `followup-cadence`, `followup-triggers`, `state-machine`, `tool-call-logger`, `cancellation`, `dispatcher`, `rag`, `search-knowledge`, `time-context`.
- [ ] `rg -n "copilot/(agent-router|lead-profile-builder|knowledge-retriever|prompt-builder|llm-client|followup\.ts|followup-response-detector|sanitizer)" supabase src tests` → **nenhum match**.
- [ ] `npm run typecheck` → sem novos erros vs baseline.
- [ ] `npm run lint` → 0 errors.
- [ ] `npm run test:unit 2>&1 | tail -25` → `Test Files` reduzido em **4**, `Tests` reduzido proporcionalmente (+1 do bloco removido em rag-tuning), 0 failed. **Anotar os números exatos.**
- [ ] `npm run build` → conclui sem unresolved import.
- [ ] Reportar no resumo: counts literais (antes vs depois), build, typecheck, lint.

### Notas para o engenheiro
- A **coluna** `organizations.copilot_engine_version` + campo em `types.ts` **permanecem** — drop de schema é fora de escopo (exigiria migration + regen + risco prod).
- `sanitizer.test.ts` e `copilot-followup-cadence.test.ts` **não** são afetados — não deletar.
- Importer de produção inesperado em qualquer grep → **NÃO apagar, sinalizar ao CTO**.
