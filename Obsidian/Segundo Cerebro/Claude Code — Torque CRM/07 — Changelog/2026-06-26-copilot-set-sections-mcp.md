---
type: changelog
title: torque-mcp — copilot.set_sections (CRUD dos 5 prompts da UI com recompile fiel)
status: shipped
created: 2026-06-26
updated: 2026-06-26
tags: [torque-mcp, copilot, edge-functions, prompt, mcp]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]", "[[Copilot]]"]
owner: CTO
---

# 2026-06-26 — torque-mcp `copilot.set_sections` (CRUD dos 5 prompts da UI)

## Mudanças

- **torque-mcp / copilot**: nova tool `copilot.set_sections` que edita as **5 seções de prompt da UI do Playground** (`personality` / `objective` / `flow` / `products` / `instructions`) e **recompila o `system_prompt` fielmente** — porta Deno do `buildSystemPrompt`/composer do Playground (consciente de tools + mídia). Resolve o gap em que o runtime lê só o `system_prompt` literal (cache), enquanto a UI edita `conversation_style.promptSections`: editar via SQL solto desincronizava os dois.
- **Grava nos 3 lugares + `prompt_hash = null`**: `system_prompt` (compilado), `custom_instructions` (= texto flat, paridade com o Playground) e `conversation_style.promptSections` (merge), zerando `prompt_hash` para o novo prompt valer no próximo turno. Merge parcial — string vazia limpa a seção.
- **Paridade byte-exact entre 2 runtimes**: composer compartilhado em Deno (`_shared/copilot-prompt/`) + espelho no frontend (`src/modules/copilot/lib/compose-system-prompt.ts`), travados por goldens (`tests/unit/copilot-compose-parity.test.ts`). Garante que o que o MCP recompila é byte-idêntico ao que a UI geraria.
- **Guardrail `runMutation` (dry-run → confirm)**: `plan()` reconstrói o `ComposeInput` a partir da row do agente (flags `can_*` vivas) e **lança em erro de leitura de docs antes de qualquer token/escrita** — nunca persiste um `system_prompt` degradado.
- **Fix de schema do `copilot.update_prompt`**: `promptSections` passou de `array` → `object` (`personality|objective|flow|products|instructions`), alinhando com o formato real em `conversation_style`.

## Arquivos tocados

- `supabase/functions/torque-mcp/tools/copilot.ts` — tool `copilot.set_sections` (recompila + monta update dos 3 lugares + `prompt_hash` null) + fix do schema de `update_prompt`.
- `supabase/functions/torque-mcp/index.ts` — registro de `copilot.set_sections` em `TOOLS`.
- `supabase/functions/_shared/copilot-prompt/` — **novo** módulo compartilhado:
  - `compose.ts` (+ `compose.test.ts`, `fixtures/compose-goldens.json`) — `composeSystemPrompt`, porta fiel do composer do Playground.
  - `reconstruct.ts` (+ `reconstruct.test.ts`) — reconstrói `ComposeInput` da row do agente com as flags `can_*` vivas.
  - `tools-catalog.ts` (+ `tools-catalog.test.ts`) — porta do catálogo `PLAYGROUND_TOOLS`.
  - `index.ts` — barrel.
- `src/modules/copilot/lib/compose-system-prompt.ts` (+ `__fixtures__/compose-goldens.json`) — **novo** espelho no frontend.
- `src/modules/copilot/components/playground/CopilotPlayground.tsx` + `types.ts` — refatorado para consumir o composer compartilhado.
- `tests/unit/copilot-compose-parity.test.ts` — **novo**. Paridade golden entre runtime Deno e frontend.
- `supabase/functions/torque-mcp/tools/copilot.test.ts` — cobertura de `set_sections` (recompile FERRAMENTAS, throw em docs read error, merge parcial).
- `.specs/features/copilot-prompt-sections-mcp/DESIGN.md` + `PLAN.md` — **novos**. Design e plano da feature.

## Decisões

- **Composer único, dois runtimes**: a verdade do prompt é um só composer, portado para Deno e espelhado no frontend, ancorado por goldens byte-exact. Evita drift entre o que a UI mostra e o que o MCP grava.
- **Escrever os 3 lugares + `prompt_hash` null** (em vez de só `system_prompt`): o V1 guarda o prompt em 3 storages (`system_prompt` cache de runtime, `custom_instructions` flat, `conversation_style.promptSections` da UI); gravar parcial deixa a UI e o runtime divergentes. `prompt_hash` zerado força recompilação no turno seguinte.
- **`plan()` lança antes de escrever**: erro ao ler docs/fixtures aborta a mutação na fase de planejamento, garantindo que nenhum prompt degradado chegue ao DB.

## Deploy

- PR **#915** (squash `e52f6932`) mergeado em `main` em 2026-06-26. Deploy do `torque-mcp` em **PROD** + smoke OK (tool live, `apply`+`restore` provados em agente real).
- Commits de desenvolvimento (squashed em `e52f6932`): `fdefcc8d` (set_sections + recompile fiel), `0e71c83c` (throw em docs read error + cobre recompile FERRAMENTAS), `4681cd42` (schema `promptSections` array→object), `3520ef51` (registro em `TOOLS`).

## Follow-ups

- Reconectar o cliente MCP (`/mcp`) para o Claude enxergar a tool nova.
- Verificar paridade contínua dos goldens se o composer do Playground mudar (qualquer alteração na UI precisa re-gerar as fixtures dos 2 lados).
