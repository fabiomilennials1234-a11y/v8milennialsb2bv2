---
type: adr
title: "copilot.set_sections — recompile fiel do system_prompt"
status: accepted
created: 2026-06-26
updated: 2026-06-26
tags: [adr, copilot, torque-mcp, prompt]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]", "[[2026-06-24-torque-mcp-s5-s6-crm-mcp-c1]]"]
owner: gabriel
supersedes: []
superseded_by: []
---

# ADR-2026-06-26 — copilot.set_sections — recompile fiel do system_prompt

**Data:** 2026-06-26
**Status:** accepted
**Escopo:** `supabase/functions/torque-mcp/tools/copilot.ts`, `supabase/functions/_shared/copilot-prompt/`, runtime do Copilot (`supabase/functions/agent-message/engine/build-prompt.ts`), Playground (`src/modules/copilot/components/playground/CopilotPlayground.tsx`).

> Tool nova do **Torque MCP** (cenário A interno). A decisão-mãe sobre a forma do servidor está em [[ADR-2026-06-22-torque-mcp-interno]] / `docs/adr/0011-torque-mcp-internal-ops-server.md`. **Este ADR não duplica** aquela — foca a sub-decisão de como editar prompt de Copilot via MCP sem regredir o runtime. Não existe ADR equivalente em `docs/adr/` (verificado: lista vai até `0013`).

## Contexto

O prompt de um Copilot v1 vive em **3 lugares no DB** e o runtime e a UI leem fontes diferentes:

- **Runtime** (`agent-message/engine/build-prompt.ts:85`): se `copilot_agents.system_prompt` existe, ele é empurrado **verbatim** e o caminho que reconstrói a partir das seções estruturadas é **pulado por inteiro**. Ou seja, o runtime lê **só `system_prompt`**.
- **Playground/UI** (`CopilotPlayground.tsx`): o CTO edita **5 seções** (`personality`, `objective`, `flow`, `products`, `instructions`) guardadas em `conversation_style.promptSections`; ao salvar, a UI recompila e regrava `system_prompt`.
- **Wizard**: recompila a partir de `custom_instructions.dos`.

Consequência operacional recorrente (memória + incidentes "Nadir genérico", KomBag, Itatex): editar `promptSections` por SQL/MCP **não muda o comportamento em produção** — o runtime continua servindo o `system_prompt` velho. E recompilar à mão diverge do formato do Playground (perde blocos de FERRAMENTAS/MÍDIA, quebra `||SPLIT||`, etc.). Faltava uma tool MCP que editasse as seções da UI e produzisse um `system_prompt` **byte-idêntico** ao que o Playground geraria — caso contrário toda edição via MCP introduz drift silencioso entre os dois runtimes (frontend TS vs. Edge Deno).

## Forças em jogo

**Restrições do CTO:**
- A fonte de verdade editável continua sendo as 5 seções da UI. MCP não pode criar um "segundo formato" de prompt.
- Toda mutação de Copilot via MCP precisa ser **revisável antes de aplicar** (dry-run → confirm), padrão das tools mutating do Torque MCP.

**Restrições técnicas:**
- O composer do Playground é TypeScript de browser; o MCP roda em **Deno** (Edge Function). Sem porta fiel, os dois divergem com qualquer mudança futura de formato.
- O runtime ignora `promptSections` quando `system_prompt` está setado → recompilar `system_prompt` é **obrigatório**, não opcional.
- `system_prompt` é cache materializado: precisa invalidar `prompt_hash` senão um recompile/cache downstream pode reusar o hash velho.

**Restrições de segurança/multi-tenant:**
- Escrita herda RLS do master (sem `service_role`) — princípio nuclear do Torque MCP ([[ADR-2026-06-22-torque-mcp-interno]]).
- Falha na leitura dos documentos (bloco MÍDIA) **não pode** persistir um `system_prompt` degradado.

## Opções consideradas

### Opção (a) — Editar só `conversation_style.promptSections` via MCP
Vantagem: simples, escreve um lugar só.
Desvantagem (vetada): runtime lê `system_prompt` verbatim → edição **não tem efeito** em produção. É exatamente a pegadinha que causou incidentes anteriores.

### Opção (b) — Recompilar com um composer próprio no Deno (best-effort)
Vantagem: não depende do código do frontend.
Desvantagem (vetada): diverge do Playground a cada mudança de formato; sem contrato de paridade, o drift é invisível até o cliente ver prompt errado.

### Opção (c) — Porta Deno fiel do `buildSystemPrompt` do Playground + golden parity ⭐ ESCOLHIDA
Vantagem: `system_prompt` byte-idêntico ao Playground, garantido por goldens cross-runtime. Escreve os 3 lugares de uma vez e nula `prompt_hash`. Dry-run→confirm.
Desvantagem: duplica a lógica do composer em dois runtimes — mitigado pelo teste de paridade que falha o CI se divergirem.

## Decisão

**Adotada opção (c).** Tool `copilot.set_sections` no Torque MCP (PR #915, merge `e52f6932`).

### D1 — Composer compartilhado, paridade byte-a-byte entre 2 runtimes
Extraído `buildSystemPrompt` + `resolveMentions` do `CopilotPlayground.tsx` para módulo puro em **dois** locais:
- Frontend: `src/modules/copilot/lib/compose-system-prompt.ts`
- Deno/MCP: `supabase/functions/_shared/copilot-prompt/compose.ts` (cabeçalho: *"PORT pura de CopilotPlayground.tsx buildSystemPrompt + resolveMentions … fidelidade byte-a-byte com o frontend é o requisito"*).

Contrato de paridade via **goldens** (`compose-goldens.json`, 5 fixtures: sections-only, +tools, +media, all, all-tools-default) rodados nos dois runtimes:
- `tests/unit/copilot-compose-parity.test.ts` (Vitest, frontend)
- `supabase/functions/_shared/copilot-prompt/compose.test.ts` (Deno)

`reconstruct.ts` (`agentRowToComposeInput`) remonta o `ComposeInput` a partir da linha do agente lendo as flags `can_*` vivas, para que o bloco de FERRAMENTAS/MÍDIA reflita o estado real do agente.

### D2 — Recompila fiel + grava os 3 lugares + nula prompt_hash
`buildSetSectionsUpdate` faz merge parcial sobre `DEFAULT_PROMPT_SECTIONS` ∪ seções atuais, recompila via `composeSystemPrompt` e devolve o update:
- `system_prompt` = texto recompilado (o que o runtime serve verbatim)
- `custom_instructions` = mesmo texto plano (`sectionsToFlatText`, paridade Playground)
- `conversation_style.promptSections` = seções mescladas (fonte editável da UI)
- `prompt_hash = null` (força re-compile/invalidação)

Merge parcial: passar uma seção só altera aquela; string vazia limpa a seção.

### D3 — runMutation dry-run → confirm; fail-closed
`set_sections` é `readonly:false` e passa por `runMutation`: a 1ª chamada planeja e devolve o diff (`changed`, `sections_before`/`after`) + `confirm_token`; só re-chamar com o token aplica. Erro ao ler `copilot_agent_documents` **lança dentro do `plan()`** (commit `0e71c83c`), abortando antes de qualquer token/escrita — nunca persiste prompt sem o bloco MÍDIA.

## Consequências

### Positivas
- Editar prompt de Copilot via MCP passa a **ter efeito real** em runtime (recompila `system_prompt`), fechando a classe de incidentes "editei as seções e nada mudou".
- Paridade garantida: qualquer mudança de formato no Playground que não seja replicada no Deno **quebra o CI** (goldens cross-runtime).
- `copilot.dump_prompt` + `copilot.set_sections` dão um ciclo auditável read→edit→apply sobre os 3 lugares, RLS-scoped como master.

### Negativas
- O composer existe em **dois runtimes** (TS browser + Deno). É dívida deliberada, presa pelo teste de paridade; tocar o formato exige editar os dois.
- `set_sections` grava `custom_instructions` com o **texto plano** (não `{dos}`), divergindo da forma que o wizard escreve — coerente com o Playground, mas é um detalhe a lembrar ao auditar `custom_instructions`.

### Pendências geradas
- LOW: consolidar o composer num pacote único consumido pelos dois runtimes (hoje são dois arquivos espelhados + goldens duplicados).
- LOW: documentar no sub-CLAUDE do `agent-message` que `promptSections` é inerte no runtime quando `system_prompt` existe (já implícito em `build-prompt.ts:85`).

## Alternativas rejeitadas

- **Editar só `promptSections`** — runtime ignora; edição sem efeito.
- **Composer Deno best-effort sem paridade** — drift invisível com o Playground.
- **Escrever via `service_role`/RPC `SECURITY DEFINER`** — bypassa RLS, anti-pattern nuclear do Torque MCP.

## Evidência

- PR **#915** — merge `e52f6932` (`feat(torque-mcp): copilot.set_sections — CRUD dos 5 prompts da UI com recompile fiel`), 18 arquivos, +2559/−93. Commits-chave: `fdefcc8d` (set_sections + recompile), `0e71c83c` (fail-closed em docs read + cobertura FERRAMENTAS), `3520ef51` (registra em `TOOLS`), `a7dfbc62` (reconstruct ComposeInput com flags `can_*` vivas), `403a76db` (porta Deno fiel do composer), `f8bf034f` (porta do catálogo `PLAYGROUND_TOOLS`).
- Tool: `supabase/functions/torque-mcp/tools/copilot.ts` — `copilotSetSectionsTool`, `buildSetSectionsUpdate`, `SECTION_KEYS = [personality, objective, flow, products, instructions]`, `prompt_hash: null`.
- Composer compartilhado: `supabase/functions/_shared/copilot-prompt/` (`compose.ts`, `reconstruct.ts`, `tools-catalog.ts`, `index.ts`, `fixtures/compose-goldens.json`) + espelho frontend `src/modules/copilot/lib/compose-system-prompt.ts`.
- Paridade: `tests/unit/copilot-compose-parity.test.ts` + `compose.test.ts` (goldens byte-exatos).
- Runtime lê verbatim: `supabase/functions/agent-message/engine/build-prompt.ts:85` (`if (capabilities.system_prompt) sections.push(capabilities.system_prompt)`).
- Spec viva: `.specs/features/copilot-prompt-sections-mcp/` (`DESIGN.md`, `PLAN.md`).
- Decisão-mãe do servidor: [[ADR-2026-06-22-torque-mcp-interno]] · `docs/adr/0011-torque-mcp-internal-ops-server.md`.
