# Copilot 5 prompt-sections via MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editar os 5 prompt-sections de um copilot v1 pelo torque-mcp e ter efeito real no runtime, recompilando `system_prompt` server-side de forma fiel ao Playground.

**Architecture:** Engine pura compartilhada (`_shared/copilot-prompt/`): `compose` (porta Deno do `buildSystemPrompt` do Playground) + `reconstruct` (row do agente → input do compose) + `tools-catalog` (port dos PLAYGROUND_TOOLS). Tool `copilot.set_sections` faz merge parcial dos sections → recompila → grava os 3 lugares + `prompt_hash=null` via `runMutation` (dry-run→confirm→audit). Anti-drift por golden fixtures exercitadas nos dois lados (Deno + frontend).

**Tech Stack:** Deno (edge functions) + `deno test`; TypeScript/Vite + Vitest (frontend); Supabase (`copilot_agents`, RLS master); torque-mcp JSON-RPC.

**Spec:** `.specs/features/copilot-prompt-sections-mcp/DESIGN.md`

**Branch:** `feat/copilot-prompt-sections-mcp` de `origin/main` (worktree dedicado — a working tree principal está noutra feature). torque-mcp + Playground vivem em `origin/main`.

---

## File Structure

```
supabase/functions/_shared/copilot-prompt/
├── tools-catalog.ts        # TOOLS_CATALOG: {id,name,defaultInstruction}[] (port de PLAYGROUND_TOOLS)
├── tools-catalog.test.ts
├── compose.ts              # ComposeInput + composeSystemPrompt() (porta pura do Playground)
├── compose.test.ts         # unit + golden
├── reconstruct.ts          # agentRowToComposeInput(agent, documents) -> ComposeInput
├── reconstruct.test.ts
├── fixtures/
│   └── compose-goldens.json # [{name, input: ComposeInput, expected: string}] — fonte única
├── index.ts                # barrel
supabase/functions/torque-mcp/tools/
├── copilot.ts              # + copilotSetSectionsTool; fix schema de update_prompt
├── copilot.test.ts         # + testes set_sections + schema fix
supabase/functions/torque-mcp/index.ts   # registra copilotSetSectionsTool no TOOLS

src/modules/copilot/lib/
├── compose-system-prompt.ts       # extração do buildSystemPrompt/resolveMentions (frontend)
├── compose-system-prompt.test.ts  # golden (mesmas fixtures via copy)
src/modules/copilot/components/playground/CopilotPlayground.tsx  # usa o lib extraído
```

**Shared contract (igual nos dois lados):**

```ts
export interface ComposePromptSections {
  personality: string;
  objective: string;
  flow: string;
  products?: string;
  instructions: string;
}
export interface ComposeToolState { id: string; enabled: boolean; instruction: string }
export interface ComposeDoc {
  id: string; name: string;
  fileType: "image" | "video" | "document";
  description?: string; sendWhen?: string;
}
export interface ComposeLink { id: string; alias: string; url: string }
export interface ComposeInput {
  promptSections: ComposePromptSections;
  tools: ComposeToolState[];   // per-agent state; nomes/defaults vêm do TOOLS_CATALOG
  documents: ComposeDoc[];     // todos os docs (mention resolution + filtro de mídia interno)
  links: ComposeLink[];        // sempre [] em v1
}
```

---

## Task 1: tools-catalog.ts (port de PLAYGROUND_TOOLS)

**Files:**
- Create: `supabase/functions/_shared/copilot-prompt/tools-catalog.ts`
- Test: `supabase/functions/_shared/copilot-prompt/tools-catalog.test.ts`
- Source of truth: `src/modules/copilot/components/playground/types.ts` (`PLAYGROUND_TOOLS`)

- [ ] **Step 1: Escrever o catálogo (copy verbatim de `{id,name,defaultInstruction}`)**

Copiar os 10 entries de `PLAYGROUND_TOOLS` — só os campos `id`, `name`, `defaultInstruction`, **na mesma ordem** (a ordem importa: define a ordem dos blocos `## tool` no prompt). Ids: `QUALIFICAR_LEAD`, `AGENDAR_REUNIAO`, `MOVER_CARD`, `TRANSFERIR_HUMANO`, `CRIAR_LEAD`, `PREENCHER_CAMPOS`, `TRANSFERIR_SZ_CHAT`, `ENVIAR_DOCUMENTO`, `CRIAR_CAMPO`, `PAUSAR_ATENDIMENTO_HUMANO`.

```ts
// supabase/functions/_shared/copilot-prompt/tools-catalog.ts
// PORT de src/modules/copilot/components/playground/types.ts PLAYGROUND_TOOLS.
// Só {id,name,defaultInstruction}. Ordem = ordem dos blocos no prompt. Guard: tools-catalog.test.ts.
export interface CatalogTool { id: string; name: string; defaultInstruction: string }

export const TOOLS_CATALOG: readonly CatalogTool[] = [
  { id: "QUALIFICAR_LEAD", name: "Qualificar Lead", defaultInstruction:
    "Conforme o lead compartilha informacoes durante a conversa (nome, empresa, cargo, necessidade, orcamento, timeline), registre progressivamente — nao espere coletar tudo. Quando os campos obrigatorios estiverem completos, qualifique o lead automaticamente. Se claramente nao se encaixa no perfil ideal, desqualifique com motivo." },
  // ... AGENDAR_REUNIAO, MOVER_CARD, TRANSFERIR_HUMANO, CRIAR_LEAD, PREENCHER_CAMPOS,
  //     TRANSFERIR_SZ_CHAT, ENVIAR_DOCUMENTO, CRIAR_CAMPO, PAUSAR_ATENDIMENTO_HUMANO
  //     (copiar defaultInstruction verbatim de types.ts)
] as const;

export const CATALOG_BY_ID: Record<string, CatalogTool> = Object.fromEntries(
  TOOLS_CATALOG.map((t) => [t.id, t]),
);
```

- [ ] **Step 2: Teste de invariantes do catálogo**

```ts
// tools-catalog.test.ts
import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { CATALOG_BY_ID, TOOLS_CATALOG } from "./tools-catalog.ts";

Deno.test("catalog has the 10 playground tools in order", () => {
  assertEquals(TOOLS_CATALOG.map((t) => t.id), [
    "QUALIFICAR_LEAD", "AGENDAR_REUNIAO", "MOVER_CARD", "TRANSFERIR_HUMANO", "CRIAR_LEAD",
    "PREENCHER_CAMPOS", "TRANSFERIR_SZ_CHAT", "ENVIAR_DOCUMENTO", "CRIAR_CAMPO",
    "PAUSAR_ATENDIMENTO_HUMANO",
  ]);
});
Deno.test("every tool has non-empty name + defaultInstruction", () => {
  for (const t of TOOLS_CATALOG) {
    if (!t.name.trim() || !t.defaultInstruction.trim()) throw new Error(`empty ${t.id}`);
  }
});
Deno.test("CATALOG_BY_ID indexes all", () => assertEquals(Object.keys(CATALOG_BY_ID).length, 10));
```

- [ ] **Step 3: Rodar — deve passar**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/tools-catalog.test.ts`
Expected: PASS (3 tests). Se falhar a ordem, corrigir o array.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/copilot-prompt/tools-catalog.ts supabase/functions/_shared/copilot-prompt/tools-catalog.test.ts
git commit -m "feat(copilot-prompt): port PLAYGROUND_TOOLS catalog to shared Deno module"
```

---

## Task 2: compose.ts (composeSystemPrompt — porta pura)

**Files:**
- Create: `supabase/functions/_shared/copilot-prompt/compose.ts`
- Test: `supabase/functions/_shared/copilot-prompt/compose.test.ts`
- Source of truth: `CopilotPlayground.tsx:91-184` (`resolveMentions` + `buildSystemPrompt`)

- [ ] **Step 1: Escrever teste de unidade (falha primeiro)**

```ts
// compose.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std/assert/mod.ts";
import { composeSystemPrompt, type ComposeInput } from "./compose.ts";

const base: ComposeInput = {
  promptSections: { personality: "Voce e a Ana.", objective: "Qualificar.", flow: "1. Saudar",
    products: "", instructions: "Nunca minta." },
  tools: [], documents: [], links: [],
};

Deno.test("compose: ordem e headers dos sections", () => {
  const out = composeSystemPrompt(base);
  assertEquals(out,
    "# PERSONALIDADE\n\nVoce e a Ana.\n\n" +
    "# OBJETIVO\n\nQualificar.\n\n" +
    "# FLUXO DE ATENDIMENTO\n\n1. Saudar\n\n" +
    "# INSTRUÇÕES\n\nNunca minta.");
});

Deno.test("compose: section vazia é omitida", () => {
  const out = composeSystemPrompt({ ...base, promptSections: { ...base.promptSections, objective: "  " } });
  assertEquals(out.includes("# OBJETIVO"), false);
});

Deno.test("compose: products entra antes de ferramentas", () => {
  const out = composeSystemPrompt({ ...base, promptSections: { ...base.promptSections, products: "Plano X" } });
  assertStringIncludes(out, "# PRODUTOS E SERVICOS\n\nPlano X");
});

Deno.test("compose: tool enabled vira bloco com instrução custom; default quando vazia", () => {
  const out = composeSystemPrompt({ ...base,
    tools: [{ id: "QUALIFICAR_LEAD", enabled: true, instruction: "" },
            { id: "AGENDAR_REUNIAO", enabled: true, instruction: "Use o link X" }] });
  assertStringIncludes(out, "# FERRAMENTAS DISPONÍVEIS");
  assertStringIncludes(out, "## Qualificar Lead\nConforme o lead compartilha"); // default
  assertStringIncludes(out, "## Agendar Reuniao\nUse o link X");                 // custom
});

Deno.test("compose: tool disabled não entra", () => {
  const out = composeSystemPrompt({ ...base, tools: [{ id: "QUALIFICAR_LEAD", enabled: false, instruction: "" }] });
  assertEquals(out.includes("# FERRAMENTAS"), false);
});

Deno.test("compose: mídia (image/video com desc ou sendWhen) entra; document não", () => {
  const out = composeSystemPrompt({ ...base, documents: [
    { id: "d1", name: "Catalogo.png", fileType: "image", description: "catalogo", sendWhen: "" },
    { id: "d2", name: "Manual.pdf", fileType: "document", description: "x" }] });
  assertStringIncludes(out, "# MÍDIA DISPONÍVEL PARA ENVIAR");
  assertStringIncludes(out, "## [imagem] Catalogo.png\nDescricao: catalogo");
  assertEquals(out.includes("Manual.pdf"), false);
});

Deno.test("compose: @mention de tool enabled vira instrução", () => {
  const out = composeSystemPrompt({ ...base,
    promptSections: { ...base.promptSections, flow: "Faca @QUALIFICAR_LEAD agora" },
    tools: [{ id: "QUALIFICAR_LEAD", enabled: true, instruction: "" }] });
  assertStringIncludes(out, 'Faca [usar ferramenta "Qualificar Lead"] agora');
});
```

- [ ] **Step 2: Rodar — deve falhar (módulo não existe)**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/compose.test.ts`
Expected: FAIL ("Module not found ./compose.ts").

- [ ] **Step 3: Implementar `compose.ts` (porta fiel)**

```ts
// supabase/functions/_shared/copilot-prompt/compose.ts
// PORTA PURA de CopilotPlayground.tsx buildSystemPrompt + resolveMentions. Guard: compose.test.ts + goldens.
import { CATALOG_BY_ID, TOOLS_CATALOG } from "./tools-catalog.ts";

export interface ComposePromptSections {
  personality: string; objective: string; flow: string; products?: string; instructions: string;
}
export interface ComposeToolState { id: string; enabled: boolean; instruction: string }
export interface ComposeDoc {
  id: string; name: string; fileType: "image" | "video" | "document";
  description?: string; sendWhen?: string;
}
export interface ComposeLink { id: string; alias: string; url: string }
export interface ComposeInput {
  promptSections: ComposePromptSections;
  tools: ComposeToolState[];
  documents: ComposeDoc[];
  links: ComposeLink[];
}

function stateById(tools: ComposeToolState[], id: string): ComposeToolState | undefined {
  return tools.find((t) => t.id === id);
}

/** Porta de resolveMentions (CopilotPlayground.tsx:91-115). */
function resolveMentions(text: string, input: ComposeInput): string {
  let resolved = text;
  for (const def of TOOLS_CATALOG) {
    const state = stateById(input.tools, def.id);
    const re = new RegExp(`@${def.id}`, "g");
    resolved = state?.enabled
      ? resolved.replace(re, `[usar ferramenta "${def.name}"]`)
      : resolved.replace(re, def.name);
  }
  for (const link of input.links) {
    resolved = resolved.replace(new RegExp(`@${link.id}`, "g"), `${link.alias} (${link.url})`);
  }
  for (const doc of input.documents) {
    resolved = resolved.replace(new RegExp(`@${doc.id}`, "g"), `[documento: ${doc.name}]`);
  }
  return resolved;
}

/** Porta de buildSystemPrompt (CopilotPlayground.tsx:122-184). */
export function composeSystemPrompt(input: ComposeInput): string {
  const parts: string[] = [];
  const s = input.promptSections;

  if (s.personality.trim()) parts.push(`# PERSONALIDADE\n\n${resolveMentions(s.personality.trim(), input)}`);
  if (s.objective.trim()) parts.push(`# OBJETIVO\n\n${resolveMentions(s.objective.trim(), input)}`);
  if (s.flow.trim()) parts.push(`# FLUXO DE ATENDIMENTO\n\n${resolveMentions(s.flow.trim(), input)}`);
  if (s.products?.trim()) parts.push(`# PRODUTOS E SERVICOS\n\n${resolveMentions(s.products.trim(), input)}`);

  const toolSections: string[] = [];
  for (const def of TOOLS_CATALOG) {
    const state = stateById(input.tools, def.id);
    if (!state?.enabled) continue;
    const instruction = state.instruction?.trim() || def.defaultInstruction;
    toolSections.push(`## ${def.name}\n${resolveMentions(instruction, input)}`);
  }
  if (toolSections.length > 0) parts.push(`# FERRAMENTAS DISPONÍVEIS\n\n${toolSections.join("\n\n")}`);

  const mediaDocs = input.documents.filter(
    (d) => (d.fileType === "image" || d.fileType === "video") && (d.description || d.sendWhen),
  );
  if (mediaDocs.length > 0) {
    const mediaSections = mediaDocs.map((d) => {
      const typeLabel = d.fileType === "image" ? "imagem" : "video";
      let section = `## [${typeLabel}] ${d.name}`;
      if (d.description) section += `\nDescricao: ${d.description}`;
      if (d.sendWhen) section += `\nQuando enviar: ${d.sendWhen}`;
      return section;
    });
    parts.push(`# MÍDIA DISPONÍVEL PARA ENVIAR\n\n${mediaSections.join("\n\n")}`);
  }

  if (s.instructions.trim()) parts.push(`# INSTRUÇÕES\n\n${resolveMentions(s.instructions.trim(), input)}`);

  if (input.links.length > 0) {
    let linkSection = "## Links disponiveis para enviar ao lead:\n";
    for (const link of input.links) linkSection += `- ${link.alias}: ${link.url}\n`;
    linkSection += "\nIMPORTANTE: Quando relevante, envie o link completo na mensagem para o lead poder clicar.";
    parts.push(linkSection);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/compose.test.ts`
Expected: PASS (todos). Ajustar até verde.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/copilot-prompt/compose.ts supabase/functions/_shared/copilot-prompt/compose.test.ts
git commit -m "feat(copilot-prompt): faithful Deno port of Playground system-prompt composer"
```

---

## Task 3: Golden fixtures + parity (Deno)

**Files:**
- Create: `supabase/functions/_shared/copilot-prompt/fixtures/compose-goldens.json`
- Modify: `supabase/functions/_shared/copilot-prompt/compose.test.ts`

- [ ] **Step 1: Gerar goldens a partir do composer (fonte única)**

Criar 3-5 fixtures cobrindo: (a) só sections, (b) sections + 2 tools (default + custom) + @mention, (c) sections + mídia image+video, (d) tudo combinado. Cada fixture = `{ name, input: ComposeInput, expected: string }`. Gerar `expected` rodando `composeSystemPrompt(input)` UMA vez (ex.: `deno eval`) e colando o output exato — vira o contrato pinado.

```json
[
  { "name": "sections-only",
    "input": { "promptSections": { "personality": "Voce e a Ana.", "objective": "Qualificar leads.", "flow": "1. Saudar\n2. Perguntar", "products": "", "instructions": "Nunca minta." }, "tools": [], "documents": [], "links": [] },
    "expected": "# PERSONALIDADE\n\nVoce e a Ana.\n\n# OBJETIVO\n\nQualificar leads.\n\n# FLUXO DE ATENDIMENTO\n\n1. Saudar\n2. Perguntar\n\n# INSTRUÇÕES\n\nNunca minta." }
]
```

- [ ] **Step 2: Teste golden (Deno) — adicionar a compose.test.ts**

```ts
import goldens from "./fixtures/compose-goldens.json" with { type: "json" };
Deno.test("compose: golden fixtures (parity contract)", () => {
  for (const g of goldens as Array<{ name: string; input: ComposeInput; expected: string }>) {
    assertEquals(composeSystemPrompt(g.input), g.expected, `golden mismatch: ${g.name}`);
  }
});
```

- [ ] **Step 3: Rodar — deve passar**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/compose.test.ts`
Expected: PASS incl. golden. (Se um golden foi colado errado, corrigir o JSON.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/copilot-prompt/fixtures/compose-goldens.json supabase/functions/_shared/copilot-prompt/compose.test.ts
git commit -m "test(copilot-prompt): golden parity fixtures for the composer"
```

---

## Task 4: Extrair composer do frontend + golden (anti-drift)

**Files:**
- Create: `src/modules/copilot/lib/compose-system-prompt.ts`
- Create: `src/modules/copilot/lib/compose-system-prompt.test.ts`
- Modify: `src/modules/copilot/components/playground/CopilotPlayground.tsx:88-191` (usar o lib)

- [ ] **Step 1: Escrever o lib do frontend (mesma lógica, input ComposeInput)**

Mover `resolveMentions` + `buildSystemPrompt` para o lib, com a MESMA assinatura `composeSystemPrompt(input: ComposeInput): string` e os MESMOS tipos do contrato (copiar a interface — TS frontend não importa Deno). Código idêntico ao de `compose.ts` (Task 2 Step 3), adaptado para `import`/`export` do frontend (sem mudança de lógica).

```ts
// src/modules/copilot/lib/compose-system-prompt.ts
export interface ComposePromptSections { personality: string; objective: string; flow: string; products?: string; instructions: string }
export interface ComposeToolState { id: string; enabled: boolean; instruction: string }
export interface ComposeDoc { id: string; name: string; fileType: "image" | "video" | "document"; description?: string; sendWhen?: string }
export interface ComposeLink { id: string; alias: string; url: string }
export interface ComposeInput { promptSections: ComposePromptSections; tools: ComposeToolState[]; documents: ComposeDoc[]; links: ComposeLink[] }
// TOOLS_CATALOG: reusar PLAYGROUND_TOOLS (id,name,defaultInstruction) de ../components/playground/types.ts
// composeSystemPrompt + resolveMentions: copiar de compose.ts (Task 2 Step 3) — lógica idêntica.
```

- [ ] **Step 2: Refatorar CopilotPlayground para usar o lib**

Em `CopilotPlayground.tsx`, substituir o `buildSystemPrompt(data)` local por: construir `ComposeInput` a partir de `PlaygroundData` (promptSections; tools = `PLAYGROUND_TOOLS.map(d => ({id:d.id, enabled: data.tools[d.id]?.enabled ?? false, instruction: data.tools[d.id]?.instruction ?? ""}))`; documents = `data.documents.map(...)`; links = `data.links`) e chamar `composeSystemPrompt(input)` do lib. `resolveMentions`/`buildSystemPrompt` locais removidos. `sectionsToFlatText` passa a chamar o lib também.

- [ ] **Step 3: Golden no frontend (mesmas fixtures)**

Copiar `compose-goldens.json` para `src/modules/copilot/lib/__fixtures__/compose-goldens.json` (cópia literal — os dois lados pinam o MESMO contrato).

```ts
// compose-system-prompt.test.ts
import { describe, it, expect } from "vitest";
import { composeSystemPrompt, type ComposeInput } from "./compose-system-prompt";
import goldens from "./__fixtures__/compose-goldens.json";
describe("composeSystemPrompt parity", () => {
  it.each(goldens as Array<{ name: string; input: ComposeInput; expected: string }>)(
    "golden $name", (g) => expect(composeSystemPrompt(g.input)).toBe(g.expected));
});
```

- [ ] **Step 4: Rodar frontend + smoke do Playground**

Run: `npm run test:unit -- compose-system-prompt`
Expected: PASS (goldens). Confere que o Playground ainda compila: `npm run build` (ou `npx tsc --noEmit` no módulo).

- [ ] **Step 5: Commit**

```bash
git add src/modules/copilot/lib/compose-system-prompt.ts src/modules/copilot/lib/compose-system-prompt.test.ts src/modules/copilot/lib/__fixtures__/compose-goldens.json src/modules/copilot/components/playground/CopilotPlayground.tsx
git commit -m "refactor(copilot): extract Playground prompt composer to lib + golden parity"
```

---

## Task 5: reconstruct.ts (agent row → ComposeInput)

**Files:**
- Create: `supabase/functions/_shared/copilot-prompt/reconstruct.ts`
- Test: `supabase/functions/_shared/copilot-prompt/reconstruct.test.ts`

> **Nota de fidelidade (deliberada):** o `enabled` de cada tool vem das flags `can_*` VIVAS do agente
> (correto/funcional), NÃO do load-path lossy do Playground (que hardcoda `PREENCHER_CAMPOS=true`,
> `ENVIAR_DOCUMENTO/TRANSFERIR_SZ_CHAT/CRIAR_CAMPO=false`). A parity do *composer* é no nível
> ComposeInput→string (Task 3), então não conflita. Trade-off documentado no DESIGN.md §3.2.

- [ ] **Step 1: Escrever teste (falha primeiro)**

```ts
// reconstruct.test.ts
import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { agentRowToComposeInput, mergeSections, type AgentRow } from "./reconstruct.ts";

const DEFAULT_SECTIONS = { personality: "", objective: "", flow: "", products: "", instructions: "" };

Deno.test("mergeSections: merge parcial sobre default + atual", () => {
  const cur = { ...DEFAULT_SECTIONS, personality: "A", objective: "B" };
  assertEquals(mergeSections(cur, { objective: "B2", flow: "F" }),
    { personality: "A", objective: "B2", flow: "F", products: "", instructions: "" });
});

Deno.test("reconstruct: flags can_* -> tools enabled (vivas, não load-lossy)", () => {
  const row: AgentRow = {
    conversation_style: { promptSections: { ...DEFAULT_SECTIONS, personality: "Ana" },
      toolInstructions: { AGENDAR_REUNIAO: "link X" } },
    can_qualify_lead: true, can_schedule_meeting: true, can_move_cards: false,
    can_transfer_human: false, can_create_lead: false, can_update_lead: true,
    can_send_document: true, can_transfer_sz_chat: false, human_pause_enabled: true,
  };
  const input = agentRowToComposeInput(row, []);
  const enabled = input.tools.filter((t) => t.enabled).map((t) => t.id).sort();
  assertEquals(enabled, ["AGENDAR_REUNIAO", "ENVIAR_DOCUMENTO", "PAUSAR_ATENDIMENTO_HUMANO",
    "PREENCHER_CAMPOS", "QUALIFICAR_LEAD"].sort());
  // instrução salva preservada; vazia fica "" (default aplicado no compose)
  assertEquals(input.tools.find((t) => t.id === "AGENDAR_REUNIAO")?.instruction, "link X");
  assertEquals(input.tools.find((t) => t.id === "QUALIFICAR_LEAD")?.instruction, "");
});

Deno.test("reconstruct: documents mapeados; links sempre []", () => {
  const row: AgentRow = { conversation_style: { promptSections: DEFAULT_SECTIONS } };
  const input = agentRowToComposeInput(row, [
    { id: "d1", file_name: "C.png", file_type: "image", description: "cat", send_when: null }]);
  assertEquals(input.documents, [{ id: "d1", name: "C.png", fileType: "image", description: "cat", sendWhen: "" }]);
  assertEquals(input.links, []);
});

Deno.test("reconstruct: promptSections ausente -> default 5 vazias", () => {
  const input = agentRowToComposeInput({ conversation_style: null }, []);
  assertEquals(input.promptSections, DEFAULT_SECTIONS);
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/reconstruct.test.ts`
Expected: FAIL ("Module not found").

- [ ] **Step 3: Implementar `reconstruct.ts`**

```ts
// supabase/functions/_shared/copilot-prompt/reconstruct.ts
import { TOOLS_CATALOG } from "./tools-catalog.ts";
import type { ComposeDoc, ComposeInput, ComposePromptSections, ComposeToolState } from "./compose.ts";

export const DEFAULT_PROMPT_SECTIONS: ComposePromptSections = {
  personality: "", objective: "", flow: "", products: "", instructions: "",
};

export interface AgentRow {
  conversation_style?: { promptSections?: Partial<ComposePromptSections>; toolInstructions?: Record<string, string> } | null;
  can_qualify_lead?: boolean; can_schedule_meeting?: boolean; can_move_cards?: boolean;
  can_transfer_human?: boolean; can_create_lead?: boolean; can_update_lead?: boolean;
  can_send_document?: boolean; can_transfer_sz_chat?: boolean; human_pause_enabled?: boolean;
}
export interface DocRow {
  id: string; file_name: string; file_type: string | null;
  description?: string | null; send_when?: string | null;
}

/** id da tool -> getter da flag viva. CRIAR_CAMPO não tem flag dedicada -> false. */
const FLAG_BY_TOOL: Record<string, (a: AgentRow) => boolean> = {
  QUALIFICAR_LEAD: (a) => a.can_qualify_lead === true,
  AGENDAR_REUNIAO: (a) => a.can_schedule_meeting === true,
  MOVER_CARD: (a) => a.can_move_cards === true,
  TRANSFERIR_HUMANO: (a) => a.can_transfer_human === true,
  CRIAR_LEAD: (a) => a.can_create_lead === true,
  PREENCHER_CAMPOS: (a) => a.can_update_lead === true,
  TRANSFERIR_SZ_CHAT: (a) => a.can_transfer_sz_chat === true,
  ENVIAR_DOCUMENTO: (a) => a.can_send_document === true,
  CRIAR_CAMPO: () => false,
  PAUSAR_ATENDIMENTO_HUMANO: (a) => a.human_pause_enabled !== false, // default true
};

export function mergeSections(
  current: ComposePromptSections,
  patch: Partial<ComposePromptSections>,
): ComposePromptSections {
  return { ...DEFAULT_PROMPT_SECTIONS, ...current, ...patch };
}

export function agentRowToComposeInput(agent: AgentRow, docs: DocRow[]): ComposeInput {
  const cs = agent.conversation_style ?? {};
  const promptSections = { ...DEFAULT_PROMPT_SECTIONS, ...(cs.promptSections ?? {}) };
  const toolInstr = cs.toolInstructions ?? {};
  const tools: ComposeToolState[] = TOOLS_CATALOG.map((def) => ({
    id: def.id,
    enabled: (FLAG_BY_TOOL[def.id] ?? (() => false))(agent),
    instruction: toolInstr[def.id] ?? "",
  }));
  const documents: ComposeDoc[] = docs.map((d) => ({
    id: d.id, name: d.file_name,
    fileType: (d.file_type === "image" || d.file_type === "video") ? d.file_type : "document",
    description: d.description ?? "", sendWhen: d.send_when ?? "",
  }));
  return { promptSections, tools, documents, links: [] };
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd supabase/functions && deno test _shared/copilot-prompt/reconstruct.test.ts`
Expected: PASS.

- [ ] **Step 5: Barrel + commit**

Criar `index.ts`:
```ts
export * from "./tools-catalog.ts";
export * from "./compose.ts";
export * from "./reconstruct.ts";
```
```bash
git add supabase/functions/_shared/copilot-prompt/reconstruct.ts supabase/functions/_shared/copilot-prompt/reconstruct.test.ts supabase/functions/_shared/copilot-prompt/index.ts
git commit -m "feat(copilot-prompt): reconstruct ComposeInput from agent row (live can_* flags)"
```

---

## Task 6: copilot.set_sections tool

**Files:**
- Modify: `supabase/functions/torque-mcp/tools/copilot.ts` (adicionar `copilotSetSectionsTool`)
- Test: `supabase/functions/torque-mcp/tools/copilot.test.ts`

- [ ] **Step 1: Escrever teste (falha primeiro)**

```ts
// copilot.test.ts — adicionar. Helpers: stub db com .from().select().eq().maybeSingle() + .update().eq()
import { copilotSetSectionsTool, buildSetSectionsUpdate } from "./copilot.ts";

Deno.test("buildSetSectionsUpdate: grava 3 lugares + prompt_hash null", () => {
  const cur = { promptSections: { personality: "A", objective: "", flow: "", products: "", instructions: "" } };
  const upd = buildSetSectionsUpdate({ personality: "A2" }, cur, [], {
    can_qualify_lead: false, human_pause_enabled: true,
  } as any);
  // system_prompt recompilado contém a nova personalidade
  if (!String(upd.system_prompt).includes("# PERSONALIDADE\n\nA2")) throw new Error("no recompile");
  // conversation_style.promptSections.personality mesclado
  if ((upd.conversation_style as any).promptSections.personality !== "A2") throw new Error("no merge");
  // custom_instructions == composed (mesmo texto)
  if (upd.custom_instructions !== upd.system_prompt) throw new Error("custom_instructions != composed");
  if (upd.prompt_hash !== null) throw new Error("prompt_hash not nulled");
});

Deno.test("set_sections: dry-run não escreve, retorna confirmToken + diff", async () => {
  const agent = { id: "a1", organization_id: "o1", name: "Bia",
    conversation_style: { promptSections: { personality: "A", objective: "", flow: "", products: "", instructions: "" } },
    can_qualify_lead: false, human_pause_enabled: true };
  let wrote = false;
  const db = makeStub({ agent, docs: [], onUpdate: () => { wrote = true; } });
  const res = JSON.parse((await copilotSetSectionsTool.handler(
    { agent_id: "a1", sections: { personality: "A2" } }, { db } as any)).content[0].text);
  if (res.dryRun !== true || !res.confirmToken) throw new Error("expected dry-run token");
  if (wrote) throw new Error("dry-run must not write");
});

Deno.test("set_sections: precisa de ao menos 1 section", async () => {
  const r = await copilotSetSectionsTool.handler({ agent_id: "a1", sections: {} }, { db: makeStub({}) } as any);
  if (!r.isError) throw new Error("expected error");
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd supabase/functions && deno test torque-mcp/tools/copilot.test.ts`
Expected: FAIL (símbolos não existem).

- [ ] **Step 3: Implementar `copilotSetSectionsTool` + `buildSetSectionsUpdate`**

Adicionar a `copilot.ts` (reusa `runMutation` + `auditMcpAction` já importados):

```ts
import { agentRowToComposeInput, mergeSections, DEFAULT_PROMPT_SECTIONS } from "../../_shared/copilot-prompt/index.ts";
import { composeSystemPrompt, type ComposePromptSections } from "../../_shared/copilot-prompt/index.ts";

const SECTION_KEYS = ["personality", "objective", "flow", "products", "instructions"] as const;
const SET_SECTIONS_COLS =
  "id,organization_id,name,conversation_style,can_qualify_lead,can_schedule_meeting,can_move_cards," +
  "can_transfer_human,can_create_lead,can_update_lead,can_send_document,can_transfer_sz_chat,human_pause_enabled";

/** Recompila system_prompt fiel + monta update dos 3 lugares + prompt_hash null. */
export function buildSetSectionsUpdate(
  patch: Partial<ComposePromptSections>,
  currentStyle: Record<string, unknown> | null,
  docs: Parameters<typeof agentRowToComposeInput>[1],
  agentRow: Parameters<typeof agentRowToComposeInput>[0],
): Record<string, unknown> {
  const cs = (currentStyle ?? {}) as { promptSections?: Partial<ComposePromptSections> };
  const merged = mergeSections({ ...DEFAULT_PROMPT_SECTIONS, ...(cs.promptSections ?? {}) }, patch);
  const input = { ...agentRowToComposeInput({ ...agentRow, conversation_style: { ...cs, promptSections: merged } }, docs) };
  const systemPrompt = composeSystemPrompt(input);
  return {
    system_prompt: systemPrompt,
    custom_instructions: systemPrompt, // = sectionsToFlatText (paridade Playground)
    conversation_style: { ...(currentStyle ?? {}), promptSections: merged },
    prompt_hash: null,
  };
}

export const copilotSetSectionsTool: ToolDef = {
  name: "copilot.set_sections",
  description:
    "Edit any of a Copilot agent's 5 UI prompt sections (personality|objective|flow|products|" +
    "instructions), recompile system_prompt faithfully (tools+media), write all 3 storage places + " +
    "null prompt_hash so it takes effect at runtime. Partial merge; empty string clears a section. " +
    "Dry-run shows diff + confirm_token; re-call with confirm_token to apply.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Copilot agent UUID" },
      sections: {
        type: "object",
        description: "Partial: any of personality|objective|flow|products|instructions (string).",
        properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, { type: "string" }])),
        additionalProperties: false,
      },
      confirm_token: { type: "string" },
    },
    required: ["agent_id", "sections"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const agentId = String(args.agent_id);
    const raw = (args.sections ?? {}) as Record<string, unknown>;
    const patch: Partial<ComposePromptSections> = {};
    for (const k of SECTION_KEYS) if (typeof raw[k] === "string") (patch as Record<string, string>)[k] = raw[k] as string;
    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text", text: "Provide at least one of: " + SECTION_KEYS.join(", ") }], isError: true };
    }

    const res = await runMutation({
      plan: async () => {
        const { data: agent, error } = await db.from("copilot_agents").select(SET_SECTIONS_COLS)
          .eq("id", agentId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!agent) throw new Error("No copilot agent found.");
        const { data: docs } = await db.from("copilot_agent_documents")
          .select("id,file_name,file_type,description,send_when").eq("agent_id", agentId);
        const cur = (agent.conversation_style as { promptSections?: Partial<ComposePromptSections> }) ?? {};
        const update = buildSetSectionsUpdate(patch, agent.conversation_style as Record<string, unknown>, docs ?? [], agent);
        return {
          action: "set_sections", agent_id: agentId, name: agent.name,
          organization_id: agent.organization_id,
          changed: Object.keys(patch),
          sections_before: { ...DEFAULT_PROMPT_SECTIONS, ...(cur.promptSections ?? {}) },
          sections_after: (update.conversation_style as { promptSections: unknown }).promptSections,
          system_prompt_preview: String(update.system_prompt).slice(0, 1200),
          update,
        };
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "copilot.set_sections",
          org_id: String((plan as { organization_id?: unknown }).organization_id ?? ""),
          target_type: "copilot_agent", target_id: agentId, params: args, plan, confirm_token: token,
        }),
      apply: async (_i, plan) => {
        const { error } = await db.from("copilot_agents")
          .update((plan as { update: Record<string, unknown> }).update).eq("id", agentId);
        if (error) throw new Error(error.message);
        return { updated: agentId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd supabase/functions && deno test torque-mcp/tools/copilot.test.ts`
Expected: PASS. (Implementar o `makeStub` helper no test se ainda não existir — db chainable que devolve agent/docs e captura update.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/torque-mcp/tools/copilot.ts supabase/functions/torque-mcp/tools/copilot.test.ts
git commit -m "feat(torque-mcp): copilot.set_sections — edit 5 prompt sections + faithful recompile"
```

---

## Task 7: Fix do schema de update_prompt (array→object)

**Files:**
- Modify: `supabase/functions/torque-mcp/tools/copilot.ts` (`copilotUpdatePromptTool` + `buildPromptUpdate`)
- Test: `supabase/functions/torque-mcp/tools/copilot.test.ts`

- [ ] **Step 1: Teste — promptSections objeto é aceito e gravado**

```ts
Deno.test("update_prompt: promptSections object is written (was array bug)", () => {
  const upd = buildPromptUpdate({ promptSections: { personality: "X" } as unknown as undefined }, null);
  if (!(upd.conversation_style as any)?.promptSections) throw new Error("object promptSections dropped");
});
```

- [ ] **Step 2: Rodar — deve falhar (gate Array.isArray descarta objeto)**

Run: `cd supabase/functions && deno test torque-mcp/tools/copilot.test.ts -- --filter "object"`
Expected: FAIL.

- [ ] **Step 3: Corrigir schema + gate**

Em `copilotUpdatePromptTool.inputSchema.properties.promptSections`: trocar `{ type: "array", ... }` por `{ type: "object", description: "New conversation_style.promptSections (object: personality|objective|flow|products|instructions)" }`. No handler, trocar o gate `Array.isArray(args.promptSections) ? ... : undefined` por: `args.promptSections && typeof args.promptSections === "object" && !Array.isArray(args.promptSections) ? args.promptSections : undefined`. `PromptSectionsInput.promptSections` continua `unknown`.

- [ ] **Step 4: Rodar — deve passar**

Run: `cd supabase/functions && deno test torque-mcp/tools/copilot.test.ts`
Expected: PASS (todos, incl. os antigos de update_prompt).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/torque-mcp/tools/copilot.ts supabase/functions/torque-mcp/tools/copilot.test.ts
git commit -m "fix(torque-mcp): copilot.update_prompt promptSections schema array->object"
```

---

## Task 8: Registrar a tool no servidor

**Files:**
- Modify: `supabase/functions/torque-mcp/index.ts`

- [ ] **Step 1: Importar + registrar**

No import de `./tools/copilot.ts`, adicionar `copilotSetSectionsTool`. No array `TOOLS`, adicionar `copilotSetSectionsTool` (junto dos mutating, depois de `copilotUpdatePromptTool`). É mutating (`readonly:false`) → só visível com `ALLOW_MUTATIONS=true` (já true em prod).

- [ ] **Step 2: Type-check do servidor**

Run: `cd supabase/functions && deno check torque-mcp/index.ts`
Expected: sem erros novos (só o pré-existente de `_shared/sentry.ts` se houver, igual baseline).

- [ ] **Step 3: Rodar a suíte Deno inteira do torque-mcp**

Run: `cd supabase/functions && deno test torque-mcp/ _shared/copilot-prompt/`
Expected: PASS (toda a suíte + a nova).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/torque-mcp/index.ts
git commit -m "feat(torque-mcp): register copilot.set_sections in TOOLS"
```

---

## Task 9: Deploy + smoke (dev → prod) — ops, autorização CTO p/ prod

**Files:** nenhum (operacional). Espelha o runbook do deploy do S7.

- [ ] **Step 1: PR + merge** (arquiteto) — branch `feat/copilot-prompt-sections-mcp` → `main`. CI verde (deno + vitest).

- [ ] **Step 2: Deploy dev**

Run (de worktree em main pós-merge): `SUPABASE_ACCESS_TOKEN=$(grep -oE 'sbp_[A-Za-z0-9_]+' .env.development | head -1) supabase functions deploy torque-mcp --project-ref bcfadphgsibjzivtbjvc`

- [ ] **Step 3: Smoke dev (JSON-RPC)** — `tools/list` mostra `copilot.set_sections`; `set_sections` dry-run num agente de teste dev → confere `system_prompt_preview`; aplica → `dump_prompt` confirma os 3 lugares; reverte (set_sections de volta).

- [ ] **Step 4: Deploy prod (autorização explícita do CTO)**

Run: `SUPABASE_ACCESS_TOKEN=... supabase functions deploy torque-mcp --project-ref jsjsmuncfkbsbzqzqhfq`

- [ ] **Step 5: Smoke prod** — confirmar `master_ghost_all` write em `copilot_agents` (via `db.read_sql pg_policies`); `set_sections` dry-run num agente real (ex.: Bia `30b7e803`), conferir preview; aplicar num agente de teste Milennials, `dump_prompt` confirma, reverter. Reconectar MCP no Claude (`/mcp`) p/ ver a tool nativa.

---

## Self-Review (preenchido)

- **Spec coverage:** compose fiel (T2) ✓ · reconstruct (T5) ✓ · tool set_sections R+U+clear (T6) ✓ · 3 lugares + prompt_hash null (T6) ✓ · golden anti-drift 2 lados (T3,T4) ✓ · fix schema update_prompt (T7) ✓ · registro (T8) ✓ · deploy+smoke (T9) ✓ · links=[] (T5) ✓ · invariante "não apaga FAQs" (set_sections só toca 3 campos, T6) ✓.
- **Placeholders:** Task 1 e Task 4 referenciam "copiar verbatim de types.ts" — é instrução precisa com guard (golden/parity test), não hand-wave. Demais tasks têm código completo.
- **Type consistency:** `ComposeInput`/`composeSystemPrompt`/`ComposePromptSections` idênticos entre compose.ts (T2), reconstruct.ts (T5) e tool (T6). `agentRowToComposeInput(agent, docs)` assinatura consistente T5↔T6. `buildSetSectionsUpdate` definido e testado em T6.
- **Aberto p/ execução:** confirmar no T5/T6 se `copilot_agent_documents` usa coluna `send_when` (assumido); o teste de reconstruct pina. Confirmar policy master FOR ALL viva em prod no T9 Step 5 (baixo risco — update_prompt já escreve como master hoje).
