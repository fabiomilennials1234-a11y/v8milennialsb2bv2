# Copilot — CRUD dos 5 prompt-sections via MCP (v1, fiel ao Playground)

**Data:** 2026-06-26
**Status:** Design — aguardando aprovação do CTO
**Alvo:** Copilot v1 (`copilot_agents`) — patch focado (decisão CTO: v1 patch, não builder v2)
**Precedente:** S7 workflow-builder (`torque-mcp/tools/workflow.ts` + `runMutation` dry-run→confirm→audit)

---

## 1. Problema

Os "5 prompts que aparecem na UI" = aba **"Prompt do Agente"** do `CopilotPlayground` =
`PromptSections = { personality, objective, flow, products, instructions }`, persistidos em
`copilot_agents.conversation_style.promptSections` (objeto).

O **runtime lê só `copilot_agents.system_prompt` verbatim** (`agent-message/engine/build-prompt.ts:65`).
O compilador que transforma os 5 sections → `system_prompt` é o **`buildSystemPrompt` do Playground**
(`CopilotPlayground.tsx:122-184`) — **vive só no frontend**. Não há recompilador server-side.

A tool MCP atual `copilot.update_prompt` **não serve** para editar os 5 sections:

1. 🔴 **Schema errado:** declara `promptSections` como `type: array` + gate `Array.isArray()`. Mas
   promptSections é **objeto**. Passar o objeto → silenciosamente ignorado. Não consegue gravá-los.
2. 🔴 **Não recompila:** grava `system_prompt` cru (o argumento passado). Editar sections sem passar um
   `system_prompt` pré-compilado = **zero efeito no runtime**. E sem compilador server-side, o caller
   teria de montar o prompt à mão — e não baterria com os blocos de tools/mídia/links do Playground.

**Resultado:** hoje é impossível editar os 5 sections via MCP e ter efeito real. Esta feature fecha isso.

## 2. Escopo

**Dentro:**
- Ler os 5 sections de um agente existente.
- Editar (merge parcial) qualquer um dos 5 sections, incluindo limpar (string vazia).
- **Recompilar `system_prompt` server-side, fiel ao Playground** (5 sections + blocos de
  FERRAMENTAS/MÍDIA + INSTRUÇÕES + resolução de @mentions), de forma que a mudança **tenha efeito no
  runtime**.
- Gravar consistente nos 3 lugares (`system_prompt` + `conversation_style.promptSections` +
  `custom_instructions`) + `prompt_hash = null`, via `runMutation` (dry-run → confirm → audit).

**Fora (YAGNI / fatias futuras):**
- Criar agente do zero pelo MCP (nome, flags `can_*`, funis, instância — é o builder maior).
- Editar tools/mídia/funis/comportamento via MCP (só os 5 sections de texto).
- Copilot v2 (`copilot_v2_*`) — congelado por decisão do CTO.
- UI nova. Esta feature é MCP-only; a UI Playground continua sendo a fonte paralela.

## 3. Arquitetura

Três peças, espelhando o S7 (engine compartilhada pura → tool fina → testes):

```
supabase/functions/
├── _shared/copilot-prompt/
│   ├── compose.ts        # porta Deno PURA do buildSystemPrompt do Playground
│   ├── compose.test.ts   # unit + golden parity
│   ├── reconstruct.ts    # agent row (+ documents) → ComposeInput
│   ├── reconstruct.test.ts
│   ├── tools-catalog.ts  # PLAYGROUND_TOOLS portado (id, name, defaultInstruction) + parity
│   └── index.ts          # barrel
└── torque-mcp/tools/copilot.ts   # + copilot.set_sections; fix do schema de update_prompt
```

### 3.1 `compose.ts` — compilador puro (fiel ao frontend)

Porta literal de `buildSystemPrompt` + `resolveMentions` (`CopilotPlayground.tsx:91-184`). Entrada
explícita (sem React, sem DB):

```ts
interface ComposeInput {
  promptSections: { personality: string; objective: string; flow: string;
                    products?: string; instructions: string };
  tools: { id: string; enabled: boolean; instruction: string }[]; // ordem = PLAYGROUND_TOOLS
  media: { name: string; fileType: "image" | "video"; description?: string; sendWhen?: string }[];
  links: { id: string; alias: string; url: string }[]; // sempre [] em v1 (ver §3.3)
}
function composeSystemPrompt(input: ComposeInput): string
```

Ordem idêntica ao Playground: PERSONALIDADE → OBJETIVO → FLUXO → PRODUTOS → FERRAMENTAS DISPONÍVEIS →
MÍDIA DISPONÍVEL PARA ENVIAR → INSTRUÇÕES → Links. @mentions resolvidas via tools/links/media.

### 3.2 `reconstruct.ts` — agent row → ComposeInput

Espelha o **load path** do Playground (`CopilotPlayground.tsx:355-435`). Mapa exato:

| ComposeInput | Fonte na row do agente |
|---|---|
| `promptSections` | `conversation_style.promptSections` (merge sobre `DEFAULT_PROMPT_SECTIONS`) |
| `tools[].enabled` | colunas `can_*` (mapa abaixo) + `human_pause_enabled` |
| `tools[].instruction` | `conversation_style.toolInstructions[id]` `||` (`enabled` ? `def.defaultInstruction` : `""`) |
| `media` | `copilot_agent_documents` WHERE `file_type IN ('image','video')` AND (`description` OR `send_when`) |
| `links` | `[]` — **não persistido** (ver §3.3) |

Mapa flag→tool (de `playgroundToAgentPayload` + load path): `QUALIFICAR_LEAD`←`can_qualify_lead` ·
`AGENDAR_REUNIAO`←`can_schedule_meeting` · `MOVER_CARD`←`can_move_cards` ·
`TRANSFERIR_HUMANO`←`can_transfer_human` · `CRIAR_LEAD`←`can_create_lead` ·
`PREENCHER_CAMPOS`←`can_update_lead` · `ENVIAR_DOCUMENTO`←`can_send_document` ·
`TRANSFERIR_SZ_CHAT`←`can_transfer_sz_chat` · `PAUSAR_ATENDIMENTO_HUMANO`←`human_pause_enabled` ·
`CRIAR_CAMPO`←(default false). O mapa exato é pinado pelo golden test (§6), não pela memória.

### 3.3 Links são efêmeros (decisão de parity)

`data.links` é usado no compose mas **nunca é salvo** em `playgroundToAgentPayload` nem **recarregado**
no load path → no edit do Playground, `data.links = []`. Logo, para **paridade com o comportamento de
edit-save do Playground**, o reconstructor usa `links = []`. (Um `@linkId` literal em um section salvo
fica como texto cru — idêntico ao que o Playground faz no edit.) Sem necessidade de fonte de links.

### 3.4 Drift frontend↔Deno

Duas cópias do composer (Vite TS + Deno). Guard = **golden fixtures compartilhados** (§6): mesmo
conjunto de `(agent row → expected system_prompt)` exercitado por um teste Deno (`compose.test.ts`) e
um teste frontend (`buildSystemPrompt.test.ts`). Qualquer divergência de qualquer lado quebra o golden.
Mesmo padrão do parity test de enums do S7.

## 4. Surface (tools MCP)

- **R — `copilot.dump_prompt`** (já existe): retorna `sources.promptSections`. Mantida. (Opcional:
  alias `copilot.get_sections` se quisermos nome dedicado — default: reusar dump.)
- **U — `copilot.set_sections`** (nova, mutating):
  - Input: `{ agent_id, sections: { personality?, objective?, flow?, products?, instructions? },
    confirm_token? }`. Merge parcial sobre os sections atuais; string vazia limpa um section.
  - `plan()`: lê o agente (+ documents) → reconstrói ComposeInput com os sections novos mesclados →
    `composeSystemPrompt` → monta update dos 3 lugares + `prompt_hash:null`. Retorna plano com **diff
    dos sections** + preview do `system_prompt` compilado + `confirm_token`.
  - `apply()`: `update copilot_agents` (master JWT, RLS `master_ghost_all`). Single-table → sem
    transação cross-table (documents são só leitura).
  - `audit`: `auditMcpAction`, org da própria row (nunca arg).
- **Fix — `copilot.update_prompt`**: corrigir o schema `promptSections` de `array`→`object` + o gate
  `Array.isArray`→objeto. Continua sendo o escape-hatch de baixo nível (grava `system_prompt` cru). Não
  recompila — é proposital (caller dá o prompt final). `set_sections` é o caminho de alto nível.

## 5. Invariantes respeitadas

- **Prompt em 3 lugares:** `set_sections` grava `system_prompt` (recompilado) +
  `conversation_style.promptSections` (merge) + `custom_instructions` (cópia flat = mesmo composed,
  igual `sectionsToFlatText`). `prompt_hash=null` (nuke do cache legado). → fim do drift silencioso.
- **Runtime:** como `system_prompt` é recompilado, o efeito é imediato (cache LRU ~5min expira).
- **Não regride tools/mídia:** recompile fiel preserva os blocos FERRAMENTAS/MÍDIA (decisão "Fiel").
- **Incidente "UI save apaga FAQs":** não recorre — `set_sections` toca SÓ os 3 campos de prompt; não
  faz delete-all em FAQs/kanban/followup (essas coleções nem são lidas).
- **RLS:** master JWT sob `master_ghost_all_copilot_agents` (FOR ALL). `copilot_agents` já tem write de
  master em prod (a confirmar no S1 do plano via `db.read_sql pg_policies`). Sem RPC, sem service_role.
- **ALLOW_MUTATIONS=true** já em prod (lead.restore/copilot.update_prompt/cron.toggle visíveis).
- **finalized_at:** não tocado (editamos agente existente; não cria rascunho fantasma).

## 6. Testes

- **Unit `compose.test.ts`:** cada bloco (sections vazias/cheias, tool enabled/disabled, mídia
  com/sem description, @mention de tool/doc), ordem, omissão de blocos vazios.
- **Golden parity (`fixtures/*.json`):** N agentes-fixture → `expected_system_prompt`. Exercitado por
  Deno (`compose`) **e** frontend (`buildSystemPrompt`). Pin dos dois lados.
- **`reconstruct.test.ts`:** mapa flag→tool, merge de promptSections, filtro de mídia, instruction
  fallback, links=[].
- **Tool (deno):** dry-run mint de confirm_token (sem write); confirm aplica; merge parcial; agente
  inexistente → erro; schema fix do update_prompt.
- **Smoke prod (pós-deploy, via JSON-RPC):** `set_sections` dry-run num agente real (ex.: Bia
  `30b7e803` ou agente de teste Milennials), confere `system_prompt` compilado == esperado; aplica num
  agente de teste; `dump_prompt` confirma os 3 lugares; reverte. Mesmo método do deploy S7.

## 7. Fatias

- **S1** — `compose.ts` + `tools-catalog.ts` + unit + **golden parity** (frontend + Deno). Sem tool, sem
  deploy. Prova o compilador fiel. (TDD.)
- **S2** — `reconstruct.ts` + testes (mapa flag→tool pinado).
- **S3** — `copilot.set_sections` na tool + fix do schema de `update_prompt` + testes deno. Registrar no
  TOOLS array do `index.ts`.
- **S4** — deploy dev → smoke → **deploy prod** (autorização CTO) → smoke prod → reconectar MCP.

Branch de `main` (S7 + `torque-mcp` vivem em `origin/main`; a working tree atual está em outra feature).

## 8. Decisões tomadas

1. **v1 patch**, não v2 (CTO).
2. **Recompile fiel** (5 sections + tools + mídia + links + @mentions), não sections-only (CTO).
3. **Escopo = R+U** dos 5 sections em agente existente; create-de-agente fora.
4. Surface = nova `copilot.set_sections` (alto nível, recompila) + fix do bug de schema do
   `update_prompt` (mantido como escape-hatch cru).
5. Links tratados como `[]` (efêmeros — paridade com edit-save do Playground).

## 9. Detalhes a confirmar no plano (TDD força)

- Mapa exato flag→`PLAYGROUND_TOOLS` (pinado pelo golden, não pela memória).
- `custom_instructions`: hoje o Playground grava `sectionsToFlatText` (= composed). Confirmar que
  `set_sections` replica isso (e não o `{dos}` JSON do `update_prompt`, que é outro formato). Decisão:
  `set_sections` grava o composed (paridade Playground); não usa o wrapper `{dos}`.
- Política RLS viva de `copilot_agents` em prod (confirmar master FOR ALL no S1 do plano).
