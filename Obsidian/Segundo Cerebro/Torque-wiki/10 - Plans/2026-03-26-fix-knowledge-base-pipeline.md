---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-26-fix-knowledge-base-pipeline.md
---

# Fix Knowledge Base Pipeline - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the copilot knowledge base so uploaded documents (PDFs, catalogs) are actually readable, searchable, and sendable to leads -- stopping the copilot from hallucinating catalog content.

**Architecture:** The current pipeline sends PDF content as raw base64 text to the LLM instead of using multimodal API, producing garbage summaries and broken embeddings. The fix separates extraction into a proper multimodal call, stores the full extracted text, generates accurate summaries and chunks from real content, adds a `send_document` tool so the copilot can forward files to leads, and strengthens prompt instructions to prevent hallucination.

**Tech Stack:** Supabase Edge Functions (Deno), pgvector, OpenRouter API (Gemini multimodal), Evolution API (WhatsApp media), PostgreSQL migrations.

---

## Root Cause Diagnosis

### Bug 1: PDF extraction sends base64 as plain text (CRITICAL)
**File:** `supabase/functions/process-agent-document/index.ts:84-88`
```typescript
// BROKEN: sends base64 as plain text, not multimodal content
textContent = `[PDF Document: ${doc.file_name}]\n\nConteudo base64...\n${base64.substring(0, 50000)}`;
```
The LLM receives raw base64 characters as text. It cannot decode this. The "summary" is either hallucinated or garbage.

### Bug 2: Chunks contain base64, not text (CRITICAL)
**File:** `supabase/functions/process-agent-document/index.ts:204`
The chunking function receives `textContent` which for PDFs is `[PDF Document: ...]\n\n{base64_garbage}`. All chunks and embeddings in `copilot_agent_document_chunks` are of base64 noise, not natural language. Semantic search will never match user questions.

### Bug 3: No raw content storage
`copilot_agent_documents` has no `content` column. Extracted text is discarded after summary generation, making reprocessing impossible without re-downloading.

### Bug 4: No tool to send documents to leads
The copilot cannot forward files. `sendWhatsAppMedia` exists in `campaign-rule-dispatch` but is not exposed as an agent tool. When a lead asks for a catalog, the copilot can only describe it (poorly).

### Bug 5: Evolution webhook ignores media in agent responses
The response from `agent-message` only carries `message` (text). There's no `media_attachments` field, and `evolution-webhook` doesn't handle document sending from agent responses.

### Bug 6: Weak knowledge base prompt instructions
The prompt says "use as source of reference" but doesn't mandate refusing to answer when info isn't found. The copilot fills gaps with hallucination.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/20260827000000_add_document_content_column.sql` | Add `content` column to store extracted text |
| Modify | `supabase/functions/process-agent-document/index.ts` | Fix PDF extraction (multimodal), store raw content, fix chunking source |
| Modify | `supabase/functions/agent-message/agent-engine.ts` | Add `send_document` tool, strengthen KB prompt, handle media in response |
| Modify | `supabase/functions/_shared/ai-action-executor.ts` | Add `send_document` action executor |
| Modify | `supabase/functions/evolution-webhook/index.ts` | Handle media attachments from agent response |

---

## Task 1: Add `content` Column to Document Table

**Files:**
- Create: `supabase/migrations/20260827000000_add_document_content_column.sql`

- [ ] **Step 1: Create migration file**

```sql
-- =============================================================
-- Migration: Add content column to copilot_agent_documents
-- Stores the full extracted text from documents for:
--   1. Accurate chunking/embedding (RAG)
--   2. Re-processing without re-downloading
--   3. Direct content access by agent engine
-- =============================================================

-- Add content column for raw extracted text
ALTER TABLE public.copilot_agent_documents
  ADD COLUMN IF NOT EXISTS content TEXT DEFAULT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.copilot_agent_documents.content IS
  'Full extracted text content from the document. Used as source for summary generation, chunking, and embedding. NULL means extraction not yet run or failed.';
```

- [ ] **Step 2: Verify migration syntax**

Run: `grep -c 'ADD COLUMN' supabase/migrations/20260827000000_add_document_content_column.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260827000000_add_document_content_column.sql
git commit -m "feat(kb): add content column to copilot_agent_documents for raw text storage"
```

---

## Task 2: Fix PDF Text Extraction with Multimodal API

**Files:**
- Modify: `supabase/functions/process-agent-document/index.ts`

This is the most critical fix. The current code sends base64 as plain text. We need to:
1. Send PDF as multimodal content to the LLM for full text extraction (not summary)
2. Store the extracted text in the new `content` column
3. Generate summary from extracted text (separate step)
4. Feed extracted text (not base64) to the chunking pipeline

- [ ] **Step 1: Replace PDF extraction block (lines 82-92)**

Replace the entire text extraction section with a multimodal approach. The key change: for PDFs, send as `image_url` with `data:application/pdf;base64,...` data URI, and request FULL TEXT EXTRACTION (not a summary).

In `supabase/functions/process-agent-document/index.ts`, replace:
```typescript
    // 4. Extrair texto do documento
    let textContent = "";

    if (doc.mime_type === "application/pdf") {
      // Para PDFs, enviar como base64 para o LLM processar
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      textContent = `[PDF Document: ${doc.file_name}]\n\nConteúdo base64 do PDF (o LLM deve extrair o texto):\n${base64.substring(0, 50000)}`;
    } else {
      // Para texto/markdown/csv, ler diretamente
      textContent = await fileData.text();
    }
```

With:
```typescript
    // 4. Extrair texto do documento
    let textContent = "";
    const arrayBuffer = await fileData.arrayBuffer();

    if (doc.mime_type === "application/pdf") {
      // PDFs: usar API multimodal do LLM para extrair texto real
      const bytes = new Uint8Array(arrayBuffer);
      // Encode base64 in chunks to avoid call stack overflow on large files
      let base64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        base64 += btoa(String.fromCharCode(...bytes.slice(i, i + CHUNK)));
      }

      const extractionResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
          "X-Title": "V8 Millennials - PDF Text Extraction",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-preview",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Extraia TODO o texto deste documento PDF de forma completa e fiel. Regras:
- Transcreva TODO o conteudo visivel, incluindo tabelas, listas de produtos, precos, especificacoes
- Mantenha a estrutura: titulos, subtitulos, bullet points, tabelas
- Para tabelas, use formato markdown (|coluna1|coluna2|)
- NAO resuma, NAO omita, NAO interprete - apenas transcreva fielmente
- Se houver imagens com texto (OCR), transcreva o texto visivel
- Responda APENAS com o texto extraido, sem comentarios adicionais`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:application/pdf;base64,${base64}`,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 16000,
        }),
      });

      if (!extractionResponse.ok) {
        const errText = await extractionResponse.text();
        console.error("[process-agent-document] PDF extraction API error:", errText);
        // Fallback: try reading as text (some PDFs have embedded text layer)
        try {
          const fallbackText = new TextDecoder().decode(arrayBuffer);
          // Filter out binary garbage - keep only printable chars
          const printable = fallbackText.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
          if (printable.length > 100) {
            textContent = printable;
          }
        } catch { /* ignore fallback failure */ }
      } else {
        const extractResult = await extractionResponse.json();
        textContent = extractResult.choices?.[0]?.message?.content || "";
      }
    } else {
      // Para texto/markdown/csv/docx, ler diretamente
      textContent = new TextDecoder().decode(arrayBuffer);
    }
```

- [ ] **Step 2: Fix the content validation and summary generation**

Replace the content validation + summary generation block. The key changes:
1. Save extracted text in the `content` column
2. Generate summary FROM extracted text (not from base64)
3. The summary LLM call now receives actual readable text

In `supabase/functions/process-agent-document/index.ts`, replace:
```typescript
    if (!textContent || textContent.trim().length < 10) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Document content too short or empty", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Document content too short" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Buscar contexto do agente para o resumo ser relevante
```

With:
```typescript
    if (!textContent || textContent.trim().length < 10) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Document content too short or empty. The PDF may be image-only without readable text.", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Document content too short" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4.5. Salvar conteudo extraido no banco (coluna content)
    await supabase
      .from("copilot_agent_documents")
      .update({ content: textContent.substring(0, 500000), updated_at: new Date().toISOString() })
      .eq("id", documentId);

    // 5. Buscar contexto do agente para o resumo ser relevante
```

- [ ] **Step 3: Fix the truncation for summary generation**

Replace:
```typescript
    // Truncar conteúdo para não estourar tokens
    const truncatedContent = textContent.substring(0, 30000);
```

With:
```typescript
    // Truncar conteudo extraido para caber no contexto do LLM (nao mais base64)
    const truncatedContent = textContent.substring(0, 50000);
```

- [ ] **Step 4: Fix the chunking source - use real text, not base64**

Replace:
```typescript
    // 8. Item #5 RAG: gerar chunks + embeddings do conteúdo original
    //    (fire-and-forget: não bloqueia o retorno ao usuário)
    generateAndStoreChunkEmbeddings(
      supabase,
      OPENROUTER_API_KEY,
      documentId,
      doc.agent_id,
      doc.organization_id,
      textContent.substring(0, 60000) // max 60k chars para chunking
    ).catch(e => console.warn("[process-agent-document] Chunk embeddings failed (non-fatal):", e));
```

With:
```typescript
    // 8. RAG: gerar chunks + embeddings do conteudo EXTRAIDO (texto real, nao base64)
    //    (fire-and-forget: nao bloqueia o retorno ao usuario)
    generateAndStoreChunkEmbeddings(
      supabase,
      OPENROUTER_API_KEY,
      documentId,
      doc.agent_id,
      doc.organization_id,
      textContent.substring(0, 100000) // max 100k chars para chunking (agora e texto real)
    ).catch(e => console.warn("[process-agent-document] Chunk embeddings failed (non-fatal):", e));
```

- [ ] **Step 5: Verify the complete file compiles correctly**

Read through the entire modified file to check for syntax errors, unclosed brackets, or import issues.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/process-agent-document/index.ts
git commit -m "fix(kb): proper PDF text extraction via multimodal API instead of raw base64

BREAKING FIX: PDFs were being sent as raw base64 text to the LLM,
producing garbage summaries and broken embeddings. Now uses Gemini's
multimodal API to extract real text content including OCR for scanned docs.
Also stores full extracted text in content column for reprocessing."
```

---

## Task 3: Add `send_document` Tool to Agent Engine

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

The copilot needs a tool to send documents from the knowledge base to leads via WhatsApp. This requires:
1. A tool definition in `buildDynamicTools`
2. Adding the tool to `mapToolToAction` and `determineNextState`
3. Adding the action type to `ACTION_MAP` in `enqueueToolAction`
4. Listing available documents in the tool description so the LLM knows what it can send

- [ ] **Step 1: Add document loading for tool description**

In `agent-engine.ts`, inside the `buildDynamicTools` method (after the existing tool definitions, around line 2172 - after the `transfer_to_human` tool), add the `send_document` tool:

```typescript
    // Tool: Enviar documento da base de conhecimento ao lead via WhatsApp
    // Carrega lista de documentos disponíveis para mostrar ao LLM
    try {
      const { data: agentDocs } = await this.supabase
        .from('copilot_agent_documents')
        .select('id, file_name, summary')
        .eq('agent_id', capabilities.id)
        .eq('status', 'ready');

      if (agentDocs && agentDocs.length > 0) {
        const docList = agentDocs
          .map((d: { id: string; file_name: string; summary: string | null }) =>
            `- "${d.file_name}" (id: ${d.id})${d.summary ? ` - ${d.summary.substring(0, 80)}...` : ''}`
          )
          .join('\n');

        tools.push({
          name: 'send_document',
          description: `Envia um documento/arquivo da base de conhecimento para o lead via WhatsApp. Use quando o lead pedir um catalogo, proposta, tabela de precos, ou qualquer documento disponivel.\n\nDocumentos disponiveis:\n${docList}`,
          input_schema: {
            type: 'object',
            properties: {
              document_id: {
                type: 'string',
                description: 'ID do documento a enviar (use os IDs listados acima)',
              },
              caption: {
                type: 'string',
                description: 'Mensagem curta que acompanha o arquivo (opcional, max 200 chars)',
              },
            },
            required: ['document_id'],
          },
        });
      }
    } catch (e) {
      console.warn('[AgentEngine] Failed to load documents for send_document tool:', e);
    }
```

- [ ] **Step 2: Add send_document to mapToolToAction**

In `agent-engine.ts`, inside the `mapToolToAction` method (around line 2484), add the mapping:

```typescript
      'send_document': 'SEND_DOCUMENT',
```

Add this line inside the `mapping` object, after `'transfer_sz_chat': 'TRANSFER_SZ_CHAT'`.

- [ ] **Step 3: Add send_document to ACTION_MAP in enqueueToolAction**

In `agent-engine.ts`, inside the `enqueueToolAction` method's `ACTION_MAP` object (around line 2528), add:

```typescript
      'SEND_DOCUMENT': 'send_document',
```

Add this line inside the `ACTION_MAP` object, after `'TRANSFER_SZ_CHAT': 'transfer_sz_chat'`.

- [ ] **Step 4: Add send_document to the response return type**

In `agent-engine.ts`, in the `processMessage` method's return object (around line 300), add a `media_attachments` field so the evolution-webhook knows to send a file:

Replace:
```typescript
    // 14. Return Response
    return {
      message: cleanMessage,
      messages: messageParts.length > 1 ? messageParts : undefined,
      state: nextState,
      action_executed: actionToExecute?.action,
      execution_result: executionResult,
```

With:
```typescript
    // 14. Return Response
    // Se a acao foi SEND_DOCUMENT, incluir media_attachments na resposta
    let mediaAttachments: Array<{ type: string; document_id: string; caption?: string }> | undefined;
    if (actionToExecute?.action === 'SEND_DOCUMENT' && actionToExecute.params) {
      mediaAttachments = [{
        type: 'document',
        document_id: actionToExecute.params.document_id as string,
        caption: (actionToExecute.params.caption as string) || undefined,
      }];
    }

    return {
      message: cleanMessage,
      messages: messageParts.length > 1 ? messageParts : undefined,
      media_attachments: mediaAttachments,
      state: nextState,
      action_executed: actionToExecute?.action,
      execution_result: executionResult,
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "feat(kb): add send_document tool so copilot can forward files to leads"
```

---

## Task 4: Add `send_document` Action Executor

**Files:**
- Modify: `supabase/functions/_shared/ai-action-executor.ts`

This implements the actual document sending via Evolution API when the copilot uses the `send_document` tool.

- [ ] **Step 1: Add the case to the switch in executeAiAction**

In `supabase/functions/_shared/ai-action-executor.ts`, inside the `switch (action_type)` block (around line 221, before the `default:` case), add:

```typescript
    case "send_document":
      result = await executeSendDocument(supabase, payload, organization_id, lead_id);
      break;
```

- [ ] **Step 2: Add the history mapping for send_document**

In `supabase/functions/_shared/ai-action-executor.ts`, inside the `ACTION_HISTORY_MAP` object (around line 78), add:

```typescript
  send_document: {
    action: "document_sent",
    descriptionFn: (payload) =>
      `Documento "${payload.file_name || 'arquivo'}" enviado ao lead via WhatsApp`,
    source: "agent",
  },
```

- [ ] **Step 3: Implement the executeSendDocument function**

Add this function at the end of the file (before the last closing bracket or after the last existing `execute*` function):

```typescript
// ── Send Document to Lead via WhatsApp ───────────────────────────────────────

async function executeSendDocument(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  const documentId = payload.document_id as string;
  const caption = payload.caption as string | undefined;

  if (!documentId) {
    return { success: false, error: "document_id is required" };
  }
  if (!leadId) {
    return { success: false, error: "lead_id is required to send document" };
  }

  // 1. Buscar documento e metadados
  const { data: doc, error: docError } = await supabase
    .from("copilot_agent_documents")
    .select("id, file_name, file_path, mime_type, organization_id")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .single();

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message || "not found"}` };
  }

  // 2. Gerar URL assinada (valida por 1 hora)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("agent-documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { success: false, error: `Failed to generate signed URL: ${signedUrlError?.message || "unknown"}` };
  }

  // 3. Buscar telefone do lead e instancia WhatsApp
  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) {
    return { success: false, error: "Lead has no phone number" };
  }

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (!instance?.instance_name) {
    return { success: false, error: "No active WhatsApp instance found" };
  }

  // 4. Enviar via Evolution API
  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return { success: false, error: "Evolution API not configured" };
  }

  let phone = lead.phone.replace(/\D/g, "");
  if (!phone.startsWith("55")) phone = "55" + phone;

  const sendBody: Record<string, unknown> = {
    number: phone,
    mediatype: "document",
    media: signedUrlData.signedUrl,
    fileName: doc.file_name,
  };
  if (caption) sendBody.caption = caption;

  try {
    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendMedia/${instance.instance_name}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
        body: JSON.stringify(sendBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Evolution API error: HTTP ${response.status}: ${errorText}` };
    }

    const sendResult = await response.json();

    // 5. Registrar mensagem de saida
    await supabase.from("whatsapp_messages").insert({
      organization_id: organizationId,
      message_id: sendResult.key?.id || `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      remote_jid: `${phone}@s.whatsapp.net`,
      phone_number: phone,
      direction: "outgoing",
      message_type: "document",
      content: caption || `[Documento: ${doc.file_name}]`,
      media_url: signedUrlData.signedUrl,
      status: "sent",
      timestamp: new Date().toISOString(),
      sent_by_ai: true,
    }).catch(e => console.warn("[executeSendDocument] Failed to log outgoing message:", e));

    return {
      success: true,
      message: `Documento "${doc.file_name}" enviado com sucesso`,
      data: { file_name: doc.file_name, message_id: sendResult.key?.id },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send document: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ai-action-executor.ts
git commit -m "feat(kb): implement send_document action executor via Evolution API"
```

---

## Task 5: Handle Media Attachments in Evolution Webhook

**Files:**
- Modify: `supabase/functions/evolution-webhook/index.ts`

The evolution-webhook needs to handle `media_attachments` from the agent response to send documents alongside the text reply.

- [ ] **Step 1: Update triggerAgentMessage return type and parsing**

In `supabase/functions/evolution-webhook/index.ts`, update the `triggerAgentMessage` function to also return media attachments. Replace:

```typescript
    return { success: true, message: result.message };
```

With:

```typescript
    return {
      success: true,
      message: result.message,
      media_attachments: result.media_attachments,
    };
```

- [ ] **Step 2: Update the return type**

In the same function, update the return type from:
```typescript
): Promise<{ success: boolean; message?: string; error?: string }> {
```
To:
```typescript
): Promise<{ success: boolean; message?: string; error?: string; media_attachments?: Array<{ type: string; document_id: string; caption?: string }> }> {
```

Also update the error return to include the new field type by adding `media_attachments: undefined` or leaving it as-is (TypeScript will handle the optional field).

- [ ] **Step 3: Add media sending logic after text message sending**

In the section where `agentResult.success && agentResult.message` is handled (around line 1245, right before the `} else if (!agentResult.success)` block), add media attachment handling:

```typescript
            // Enviar documentos anexados pelo copilot (send_document tool)
            if (agentResult.media_attachments && agentResult.media_attachments.length > 0) {
              for (const attachment of agentResult.media_attachments) {
                if (attachment.type === 'document' && attachment.document_id) {
                  console.log("[Evolution Webhook] Sending document attachment:", attachment.document_id);
                  // O envio real e feito pelo ai-action-executor via fila
                  // Aqui apenas logamos que o agente solicitou o envio
                  console.log("[Evolution Webhook] Document send queued via ai-action-executor for:", attachment.document_id);
                }
              }
            }
```

Note: The actual document sending happens through the `ai-action-executor` queue. The evolution-webhook just logs that the agent requested it. The `send_document` action in the queue handles the full flow (signed URL + Evolution API sendMedia).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/evolution-webhook/index.ts
git commit -m "feat(kb): handle media_attachments from agent response in evolution webhook"
```

---

## Task 6: Strengthen Knowledge Base Prompt Instructions

**Files:**
- Modify: `supabase/functions/agent-message/agent-engine.ts`

The prompt must enforce that the copilot uses ONLY knowledge base content when answering product/catalog questions and admits ignorance when content isn't found.

- [ ] **Step 1: Replace the knowledge base section prompt**

In `agent-engine.ts`, replace the knowledge base injection block (around lines 1630-1643):

```typescript
    if (documentSummaries && documentSummaries.length > 0) {
      sections.push("");
      sections.push("# BASE DE CONHECIMENTO CORPORATIVO");
      sections.push("");
      sections.push("Use as informaçoes abaixo como fonte de referência para responder perguntas do lead. Estas foram extraídas de documentos oficiais da empresa.");
      sections.push("");
      documentSummaries.forEach((doc, index) => {
        sections.push(`## Documento ${index + 1}: ${doc.file_name}`);
        sections.push(doc.summary);
        sections.push("");
      });
      sections.push("**IMPORTANTE:** Quando usar informaçoes dos documentos, não mencione 'segundo o documento' - fale como se fosse conhecimento natural da empresa.");
      sections.push("");
    }
```

With:

```typescript
    if (documentSummaries && documentSummaries.length > 0) {
      sections.push("");
      sections.push("# BASE DE CONHECIMENTO CORPORATIVO");
      sections.push("");
      sections.push("Abaixo estao resumos dos documentos oficiais da empresa. Use estas informacoes como FONTE DE VERDADE para responder perguntas sobre produtos, servicos, precos, catalogos e especificacoes.");
      sections.push("");
      documentSummaries.forEach((doc, index) => {
        sections.push(`## Documento ${index + 1}: ${doc.file_name}`);
        sections.push(doc.summary);
        sections.push("");
      });
      sections.push("**REGRAS OBRIGATORIAS DA BASE DE CONHECIMENTO:**");
      sections.push("1. Quando o lead perguntar sobre produtos, precos, especificacoes ou servicos, responda SOMENTE com informacoes que estejam nos documentos acima ou no contexto semantico abaixo.");
      sections.push("2. Se a informacao NAO estiver nos documentos, diga honestamente: 'Nao tenho essa informacao especifica no momento. Posso encaminhar seu pedido para um especialista.' NAO INVENTE dados, precos ou produtos.");
      sections.push("3. Catalogo = fonte de verdade. Nunca crie itens, precos ou especificacoes que nao existam nos documentos.");
      sections.push("4. Fale naturalmente, sem mencionar 'segundo o documento' ou 'de acordo com o catalogo'.");
      sections.push("5. Se o lead pedir o documento/catalogo/arquivo, use a ferramenta send_document para enviar o arquivo original.");
      sections.push("");
    }
```

- [ ] **Step 2: Strengthen the semantic context prompt**

In `agent-engine.ts`, replace the semantic context injection block (around lines 1662-1669):

```typescript
    if (semanticContext && semanticContext.trim().length > 0) {
      sections.push("");
      sections.push("# CONTEXTO SEMÂNTICO RELEVANTE (recuperado por similaridade)");
      sections.push("As informaçoes abaixo foram selecionadas automaticamente por serem relevantes à pergunta atual do lead.");
      sections.push(semanticContext);
      sections.push("**IMPORTANTE:** Use este contexto como referência, mas responda de forma natural, sem mencionar que recuperou essas informaçoes.");
      sections.push("");
    }
```

With:

```typescript
    if (semanticContext && semanticContext.trim().length > 0) {
      sections.push("");
      sections.push("# CONTEXTO DETALHADO (recuperado por similaridade com a pergunta)");
      sections.push("As informacoes abaixo sao trechos EXATOS dos documentos da empresa, selecionados por relevancia a pergunta atual.");
      sections.push(semanticContext);
      sections.push("**REGRA:** Priorize estas informacoes detalhadas sobre os resumos acima. Cite dados especificos (precos, medidas, modelos) quando disponiveis aqui. Responda naturalmente sem mencionar a fonte.");
      sections.push("");
    }
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/agent-message/agent-engine.ts
git commit -m "fix(kb): strengthen prompt to prevent hallucination and mandate knowledge base as source of truth"
```

---

## Task 7: Update Supabase Types for New Column

**Files:**
- Modify: `src/integrations/supabase/types.ts` (if auto-generated, just verify; if manual, update)

- [ ] **Step 1: Check if types are auto-generated**

Run: `head -5 src/integrations/supabase/types.ts`

If the file says "auto-generated" or similar, run the Supabase type generation command. If manually maintained, add the `content` field.

- [ ] **Step 2: Add content field to copilot_agent_documents type**

In the `copilot_agent_documents` Row/Insert/Update types, add:
```typescript
content: string | null
```

- [ ] **Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: update types for copilot_agent_documents.content column"
```

---

## Task 8: Reprocess Existing Documents (One-Time Script)

**Files:**
- No files to commit - this is a runtime operation

Existing documents in the database have broken summaries and garbage embeddings. They need to be reprocessed with the new extraction pipeline.

- [ ] **Step 1: After deploying the code changes, trigger reprocessing**

The UI already has a "reprocess" button per document in `KnowledgeBaseStep.tsx`. For bulk reprocessing, run this SQL to reset all documents to `pending` status:

```sql
-- Reset all ready/error documents to pending for reprocessing
-- Run this AFTER deploying the new process-agent-document function
UPDATE public.copilot_agent_documents
SET status = 'pending', summary = NULL, content = NULL, error_message = NULL, updated_at = NOW()
WHERE status IN ('ready', 'error');

-- Clear old broken chunks (will be regenerated)
DELETE FROM public.copilot_agent_document_chunks
WHERE document_id IN (
  SELECT id FROM public.copilot_agent_documents WHERE status = 'pending'
);
```

Then trigger reprocessing for each document via the edge function (can be done from the UI or via API call per document).

- [ ] **Step 2: Verify reprocessing**

After reprocessing, verify:
```sql
-- Check documents have real content now
SELECT id, file_name, status,
  LENGTH(content) as content_length,
  LENGTH(summary) as summary_length
FROM public.copilot_agent_documents
WHERE status = 'ready';

-- Check chunks contain real text (not base64)
SELECT c.id, LEFT(c.content, 100) as preview, c.chunk_index
FROM public.copilot_agent_document_chunks c
JOIN public.copilot_agent_documents d ON d.id = c.document_id
WHERE d.status = 'ready'
LIMIT 10;
```

Expected: `content` contains readable text; chunks contain actual sentences/paragraphs, not base64.

---

## Deployment Order

1. Deploy migration (Task 1) - adds `content` column
2. Deploy edge functions (Tasks 2-6) - all at once
3. Run reprocessing (Task 8) - resets and re-extracts all documents
4. Verify end-to-end flow

## Remaining Limitations

After this fix:
- **PDF size limit**: Gemini has a context window limit; very large PDFs (100+ pages) may still be truncated. Consider splitting large PDFs.
- **Image-only PDFs**: OCR quality depends on Gemini's vision capabilities. Very low quality scans may still fail.
- **Embedding model**: Uses `text-embedding-3-small` (1536 dims). Upgrading to `text-embedding-3-large` could improve retrieval accuracy but would require re-creating all embeddings.
- **Similarity thresholds**: Fixed at 0.72 for chunks, 0.75 for FAQs. May need tuning per use case.
- **Single document per send**: The `send_document` tool sends one document at a time. Multiple documents require multiple tool calls.


## Links relacionados

- [[Produtos]]

- [[Webhooks]]

- [[SZ Chat]]

- [[OpenRouter Setup]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
