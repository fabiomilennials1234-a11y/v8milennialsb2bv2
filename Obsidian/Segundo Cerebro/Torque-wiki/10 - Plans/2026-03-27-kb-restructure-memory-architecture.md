---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-27-kb-restructure-memory-architecture.md
---

# Knowledge Base Restructure - Memory Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the copilot's knowledge base from a passive prompt dump into an active memory system - the agent DECIDES to consult it, retrieves ONLY relevant evidence, and answers based on real data.

**Architecture:** Replace "dump all KB content into system prompt" with a `search_knowledge` tool the LLM calls on demand. The prompt stays lean (~instruction only). When the LLM detects a question about products/pricing/policies, it calls the tool, gets exact evidence, then formulates a precise answer. This requires a multi-turn LLM flow: first call → tool execution → second call with results.

**Tech Stack:** Supabase Edge Functions (Deno), pgvector, OpenRouter API, existing `match_document_chunks` + `match_faqs` RPCs.

---

## Diagnostic: Why the Current Architecture Fails

### The Numbers Tell the Story

| Agent | Base Prompt | KB Dumped | Total Sent | Problem |
|-------|------------|-----------|------------|---------|
| Luiza | 18,889 ch | 4,346 ch | 23,235 ch | KB is 18% of a massive prompt - LLM drowns it out |
| Leo | 21,746 ch | 5,941 ch | 27,687 ch | Same - KB lost in noise |
| Others | 15-20K ch | 0 ch | 15-20K ch | No KB at all |

### Root Causes

1. **KB content dumped into an already huge prompt** - The system prompt has 15-20K chars of BANT methodology, personality rules, split rules, qualification scripts. Adding 4K of product info at the end gets ignored by the LLM.

2. **No active consultation mechanism** - The LLM never DECIDES to look at the KB. It's just... there in the prompt. If the LLM doesn't parse that section carefully, it invents answers.

3. **RAG retrieval is passive** - The semantic search runs BEFORE the LLM call. The results are appended to the prompt. But the LLM doesn't know these results came from a search and doesn't treat them as authoritative.

4. **No separation between prompt and knowledge** - Everything is one blob of text. The LLM can't distinguish "instructions on how to behave" from "facts about products."

### What Should Happen Instead

```
User: "Quais produtos voces tem para saude bucal?"
  ↓
Agent thinks: "This is about products → I need to search my knowledge base"
  ↓
Agent calls: search_knowledge("saude bucal pets")
  ↓
Tool returns: "PLAQUE-FREE: auxiliar contra mau hálito, tártaro e placa bacteriana..."
  ↓
Agent responds (grounded in evidence): "Temos o Plaque-Free, que atua no controle do mau hálito, tártaro e placa bacteriana. Ele também tem prebióticos para saúde intestinal."
```

---

## New Architecture: 5 Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: STORAGE                                           │
│  Supabase Storage (agent-documents bucket)                  │
│  Original files: PDF, DOCX, images → for sending to leads  │
└──────────────────────────┬──────────────────────────────────┘
                           │ upload triggers
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 2: EXTRACTION (process-agent-document)               │
│  PDF → Gemini multimodal  │  Images → GPT-4o Vision        │
│  DOCX → ZIP/XML parse     │  TXT/CSV → direct read         │
│  Output: clean text stored in content column                │
└──────────────────────────┬──────────────────────────────────┘
                           │ text extracted
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 3: INDEXED KNOWLEDGE (copilot_agent_document_chunks) │
│  Chunks (1800ch) + embeddings (1536d pgvector)              │
│  Searchable via match_document_chunks RPC                   │
│  + match_faqs RPC for FAQ entries                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ queried at runtime
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 4: OPERATIONAL MEMORY (agent-engine runtime)         │
│  Tool: search_knowledge(query) → returns chunks + file refs │
│  Tool: send_document(document_id) → sends file to lead     │
│  LLM calls tools actively, NOT passive prompt injection     │
│  Multi-turn: call LLM → tool exec → call LLM with results  │
└──────────────────────────┬──────────────────────────────────┘
                           │ evidence-based response
┌──────────────────────────▼──────────────────────────────────┐
│  Layer 5: RESPONSE WITH EVIDENCE                            │
│  Agent answers grounded in retrieved chunks                 │
│  Can cite specific products, prices, specs                  │
│  Can send original file if lead requests                    │
│  Admits when info not found - never hallucinates            │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `supabase/functions/agent-message/agent-engine.ts` | Remove KB dump from prompt, add `search_knowledge` tool, implement multi-turn tool flow |
| Modify | `supabase/functions/test-copilot-chat/index.ts` | Add `search_knowledge` simulation for Playground |
| No change | `supabase/functions/process-agent-document/index.ts` | Extraction pipeline (already fixed) |
| No change | `supabase/functions/_shared/embeddings.ts` | Chunking + embedding (already working) |
| No change | `supabase/functions/_shared/ai-action-executor.ts` | send_document action (already working) |

**Key insight:** Only 2 files need changes. The extraction, chunking, and storage layers are already correct. The problem is entirely in Layer 4 (how the agent-engine uses the knowledge).

---

## Task 1: Remove KB Dump from System Prompt

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

The current `buildDynamicPrompt` dumps all document content into the system prompt. Remove this and replace with a lightweight instruction.

- [ ] **Step 1: Replace KB injection section in buildDynamicPrompt**

In `agent-engine.ts`, find the section `1.5 KNOWLEDGE BASE` (around line 1641) and replace the entire block:

```typescript
    // CURRENT (REMOVE):
    // if (documentSummaries && documentSummaries.length > 0) {
    //   sections.push("# INFORMACOES QUE VOCE DOMINA...");
    //   ... dumps all content ...
    // }
```

Replace with:

```typescript
    // 1.5 KNOWLEDGE BASE - lightweight instruction only
    // Real KB content is retrieved dynamically via search_knowledge tool
    if (documentSummaries && documentSummaries.length > 0) {
      const docNames = documentSummaries.map(d => d.file_name.trim()).filter(Boolean).join(', ');
      sections.push("");
      sections.push("# BASE DE CONHECIMENTO");
      sections.push("");
      sections.push(`Voce tem acesso a uma base de conhecimento com ${documentSummaries.length} documento(s): ${docNames || 'documentos da empresa'}.`);
      sections.push("REGRA CRITICA: Antes de responder QUALQUER pergunta sobre produtos, precos, servicos, especificacoes, politicas ou catalogo, voce DEVE usar a ferramenta search_knowledge para consultar a base.");
      sections.push("NAO responda de memoria. NAO invente. SEMPRE consulte primeiro.");
      sections.push("Se a busca nao retornar resultados, diga: 'Vou verificar essa informacao e te retorno.'");
      sections.push("Se o lead pedir para receber um documento/catalogo, use send_document.");
      sections.push("");
    }
```

- [ ] **Step 2: Also replace the semantic context section**

The semantic context was a pre-flight RAG that dumped results into the prompt. Remove it - the tool will handle this now.

Find the section `1.6 SEMANTIC CONTEXT` and replace:

```typescript
    // REMOVE the entire semanticContext injection block.
    // The search_knowledge tool now handles all KB retrieval dynamically.
    // (Keep the parameter in the function signature for backward compatibility,
    //  but don't inject it into the prompt)
```

- [ ] **Step 3: Stop loading full content in loadDocumentSummaries**

The function currently loads full 30K-char content. Now we only need file names for the prompt instruction. Change `loadDocumentSummaries` to load only `file_name`:

```typescript
  private async loadDocumentSummaries(agentId: string): Promise<Array<{file_name: string; summary: string}>> {
    try {
      const { data, error } = await this.supabase
        .from('copilot_agent_documents')
        .select('file_name')
        .eq('agent_id', agentId)
        .eq('status', 'ready');

      if (error) {
        console.warn('[AgentEngine] Error loading KB file list:', error.message);
        return [];
      }

      console.log('[AgentEngine] KB docs available:', data?.length || 0);
      return (data || []).map(d => ({ file_name: d.file_name, summary: '' }));
    } catch (e) {
      console.warn('[AgentEngine] Failed to load KB list:', e);
      return [];
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "refactor(kb): remove content dump from prompt, add lightweight KB instruction"
```

---

## Task 2: Add `search_knowledge` Tool Definition

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

Add the `search_knowledge` tool to `buildDynamicTools` so the LLM can call it.

- [ ] **Step 1: Add tool definition in buildDynamicTools**

In `buildDynamicTools` method, add the `search_knowledge` tool. This should be added BEFORE all other tools (first tool = highest visibility for the LLM):

```typescript
    // Tool: Consultar base de conhecimento (PRIMEIRO tool - alta prioridade)
    // Disponivel quando o agente tem documentos na KB
    try {
      const { data: docCount } = await this.supabase
        .from('copilot_agent_documents')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', capabilities.id)
        .eq('status', 'ready');

      if (docCount && docCount.length > 0) {
        tools.unshift({
          name: 'search_knowledge',
          description: 'Consulta a base de conhecimento da empresa para buscar informacoes sobre produtos, servicos, precos, politicas, especificacoes e qualquer dado comercial. OBRIGATORIO usar antes de responder perguntas sobre esses temas. Retorna trechos relevantes dos documentos da empresa.',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Pergunta ou termo de busca. Ex: "saude bucal pets", "preco omega", "politica de troca"',
              },
            },
            required: ['query'],
          },
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to check KB for search_knowledge tool:', e);
    }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(kb): add search_knowledge tool definition"
```

---

## Task 3: Implement Multi-Turn Tool Execution for search_knowledge

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

This is the core change. When the LLM calls `search_knowledge`, we need to:
1. Execute the RAG search inline (NOT enqueue to async worker)
2. Feed results back to the LLM as a tool response
3. Make a SECOND LLM call so the agent can formulate an evidence-based answer
4. Process the second response normally (may contain action tools)

- [ ] **Step 1: Create executeSearchKnowledge method**

Add this method to the AgentEngine class:

```typescript
  /**
   * Executa busca na base de conhecimento inline (nao enfileirada).
   * Retorna trechos relevantes + referencia a arquivos.
   */
  private async executeSearchKnowledge(query: string, agentId: string): Promise<string> {
    try {
      const apiKey = Deno.env.get('OPENROUTER_API_KEY');
      if (!apiKey) return 'Erro: API key nao configurada.';

      const queryEmbedding = await generateEmbedding(query, apiKey);
      if (!queryEmbedding || queryEmbedding.length === 0) return 'Nao foi possivel processar a busca.';

      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      const parts: string[] = [];

      // Buscar chunks relevantes (mais resultados, threshold mais baixo)
      const { data: chunks } = await (this.supabase as any)
        .rpc('match_document_chunks', {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: 8,
          similarity_threshold: 0.5,
        });

      if (chunks && chunks.length > 0) {
        parts.push('=== INFORMACOES ENCONTRADAS NA BASE DE CONHECIMENTO ===\n');
        for (const chunk of chunks as Array<{content: string; similarity: number; document_id: string}>) {
          parts.push(chunk.content);
          parts.push('');
        }
      }

      // Buscar FAQs relevantes
      const { data: faqs } = await (this.supabase as any)
        .rpc('match_faqs', {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: 4,
          similarity_threshold: 0.55,
        });

      if (faqs && faqs.length > 0) {
        parts.push('=== PERGUNTAS FREQUENTES RELACIONADAS ===\n');
        for (const faq of faqs as Array<{question: string; answer: string}>) {
          parts.push(`P: ${faq.question}\nR: ${faq.answer}`);
          parts.push('');
        }
      }

      // Listar documentos disponiveis para envio
      const { data: docs } = await this.supabase
        .from('copilot_agent_documents')
        .select('id, file_name')
        .eq('agent_id', agentId)
        .eq('status', 'ready');

      if (docs && docs.length > 0) {
        parts.push('=== DOCUMENTOS DISPONIVEIS PARA ENVIO ===');
        for (const doc of docs) {
          parts.push(`- "${doc.file_name.trim()}" (id: ${doc.id}) - use send_document para enviar`);
        }
      }

      if (parts.length === 0) {
        return 'Nenhuma informacao relevante encontrada na base de conhecimento para esta busca.';
      }

      return parts.join('\n');
    } catch (e) {
      console.error('[AgentEngine] search_knowledge error:', e);
      return 'Erro ao consultar a base de conhecimento.';
    }
  }
```

- [ ] **Step 2: Modify the LLM calling flow to support multi-turn**

In the `processMessage` method, after the first LLM call and response processing, add logic to handle `search_knowledge` as an inline tool:

Find the section after `processLLMResponse` (around line 200-210) and replace the response processing + action enqueuing block with a loop that handles inline tools:

```typescript
    // 7. Call LLM - with multi-turn for inline tools (search_knowledge)
    console.log('[AgentEngine] Step 7: Calling LLM...');
    let currentMessages = [...allMessages];
    let finalResponse: any = null;
    let attempts = 0;
    const MAX_TOOL_TURNS = 3; // Prevent infinite loops

    while (attempts < MAX_TOOL_TURNS) {
      attempts++;
      const openRouterMessages = this.openRouter.convertMessages(currentMessages, systemPrompt);
      const openRouterTools = tools.length > 0 ? this.openRouter.convertTools(tools) : undefined;

      const response = await this.openRouter.chat({
        model,
        messages: openRouterMessages,
        tools: openRouterTools,
        tool_choice: openRouterTools ? 'auto' : undefined,
        max_tokens: 1024,
        temperature,
      });

      const { nextState: ns, actionToExecute: action, assistantMessage: msg } = await this.processLLMResponse(
        response, conversation, capabilities
      );

      // Check if the LLM called search_knowledge (inline tool)
      if (action?.action === 'SEARCH_KNOWLEDGE' && action.params?.query) {
        console.log(`[AgentEngine] search_knowledge called: "${action.params.query}"`);
        const searchResult = await this.executeSearchKnowledge(
          action.params.query as string,
          capabilities.id
        );

        // Add the tool call + result to conversation for next turn
        currentMessages.push({ role: 'assistant', content: msg || '', tool_calls: response.choices?.[0]?.message?.tool_calls });
        currentMessages.push({
          role: 'tool',
          tool_call_id: response.choices?.[0]?.message?.tool_calls?.[0]?.id || 'search_kb',
          content: searchResult,
        });

        console.log(`[AgentEngine] search_knowledge returned ${searchResult.length} chars, calling LLM again...`);
        continue; // Make another LLM call with the search results
      }

      // Not an inline tool - this is the final response
      finalResponse = { nextState: ns, actionToExecute: action, assistantMessage: msg };
      break;
    }

    if (!finalResponse) {
      finalResponse = { nextState: conversation.state, actionToExecute: null, assistantMessage: 'Desculpe, houve um problema ao consultar as informacoes.' };
    }

    const { nextState, actionToExecute, assistantMessage } = finalResponse;
```

NOTE: This replaces the existing single LLM call + processLLMResponse. The existing code from `const response = await this.openRouter.chat(...)` through `const { nextState, actionToExecute, assistantMessage }` gets replaced by this loop.

- [ ] **Step 3: Add search_knowledge to mapToolToAction**

```typescript
    'search_knowledge': 'SEARCH_KNOWLEDGE',
```

- [ ] **Step 4: Handle SEARCH_KNOWLEDGE in enqueueToolAction to NOT enqueue it**

In `enqueueToolAction`, add `SEARCH_KNOWLEDGE` to the list of non-enqueueable actions:

```typescript
    // SEARCH_KNOWLEDGE: handled inline, not enqueued
    if (action.action === 'SEARCH_KNOWLEDGE') {
      return { success: true, queued: false, message: 'Handled inline' };
    }
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(kb): implement search_knowledge as inline multi-turn tool"
```

---

## Task 4: Update test-copilot-chat for Playground Preview

**Files:**
- Modify: `supabase/functions/test-copilot-chat/index.ts`

The Playground needs to simulate the KB tool for preview. Since the test endpoint is simpler (no tool execution loop), we'll inject KB content directly into the prompt for the preview - this is acceptable for testing.

- [ ] **Step 1: Update the KB injection in test-copilot-chat**

The current code already loads KB content. Keep it, but reframe the injection to match the new architecture's instruction style:

```typescript
          if (kbContent) {
            systemPrompt += `\n\n# BASE DE CONHECIMENTO\n\nVoce tem acesso a uma base de conhecimento. No ambiente de producao, voce usaria a ferramenta search_knowledge. Neste preview, o conteudo ja esta disponivel abaixo:\n\n${kbContent}\n\nUse estas informacoes para responder com precisao. Cite nomes de produtos e detalhes exatamente como estao acima. Se nao encontrar a informacao, diga que vai verificar.`;
          }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/test-copilot-chat/index.ts
git commit -m "feat(kb): update Playground preview to match new KB architecture"
```

---

## Task 5: Fix OpenRouter Tool Response Format

**Files:**
- Modify: `supabase/functions/agent-message/openrouter-client.ts`

The multi-turn flow requires sending tool responses back to the LLM. The OpenRouter client's `convertMessages` method needs to handle `role: 'tool'` messages.

- [ ] **Step 1: Check and update convertMessages**

Verify that `convertMessages` passes through `tool` role messages correctly. If it filters them out, add support:

```typescript
    // In convertMessages, ensure tool messages are passed through:
    // { role: 'tool', tool_call_id: '...', content: '...' }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/agent-message/openrouter-client.ts
git commit -m "fix(kb): ensure tool response messages pass through OpenRouter client"
```

---

## Task 6: Deploy and Validate

- [ ] **Step 1: Deploy to PROD and DEV**

```bash
supabase functions deploy agent-message --no-verify-jwt
supabase functions deploy test-copilot-chat --no-verify-jwt
```

- [ ] **Step 2: Reprocess documents to ensure chunks are fresh**

- [ ] **Step 3: Test with Luiza/VitrineVET**

Test these scenarios:
1. "Quais produtos voces tem?" → Agent should call search_knowledge, then cite exact products
2. "O que e o Plaque Free?" → Agent should search, find the chunk, cite ingredients
3. "Me manda o catalogo" → Agent should use send_document
4. "Qual o horario de atendimento?" → Agent should search, find nothing, say "vou verificar"
5. "Oi, tudo bem?" → Agent should NOT call search_knowledge (not a product question)

---

## How the New Flow Works

### Before (dump all):
```
System prompt (18K) + KB content (4K) + RAG chunks (6K) + history = 30K+ tokens
→ LLM overwhelmed → ignores KB → invents answer
```

### After (tool-based retrieval):
```
System prompt (18K) + KB instruction (200ch) + history
→ LLM sees question about product
→ LLM calls search_knowledge("saude bucal")
→ Tool returns 3 relevant chunks (2K)
→ LLM gets second call with evidence
→ LLM answers: "O Plaque-Free atua no controle do mau halito..." (grounded)
```

### When the Agent Consults the KB:
- Questions about products, pricing, specs → ALWAYS search
- Questions about policies, processes → ALWAYS search
- General greeting / small talk → NO search
- Follow-up on already discussed topic → MAY search if new detail needed

### Limitations:
- Large PDFs (>3.5MB) still can't be processed via multimodal
- Multi-turn adds ~1-2 seconds latency per KB consultation
- Maximum 3 tool turns per message (prevents loops)
- Playground preview still uses direct injection (no real tool execution)

### Recommended Approach:
**Option 5: Hybrid - memory + search + attachments + evidence**

This is the implemented approach. The KB serves as:
1. **Indexed memory** - chunks with embeddings for semantic search
2. **On-demand retrieval** - LLM actively calls search_knowledge
3. **Document library** - original files available for sending
4. **Evidence layer** - responses grounded in retrieved chunks
5. **Lightweight prompt** - no content dump, just instruction to search


## Links relacionados

- [[Produtos]]

- [[OpenRouter Setup]]

- [[Copilot]]

- [[00 - INDEX]]
