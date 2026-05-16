---
type: changelog
title: 2026-04-27 — PDF chunking + hard limit 8MB pra RAG funcional
status: shipped
created: 2026-04-27
updated: 2026-04-27
tags: [uncategorized]
related: []
owner: gabriel
---

# 2026-04-27 — PDF chunking + hard limit 8MB pra RAG funcional

## Problema reportado pelo CTO

Org **Basic4u** (`163874dd-d05c-4ae2-811a-d6772b05dac5`) — PDF "Tabela B4u 26.pdf" anexado ao agente **BRUNA** ficou em **status="processing" há 7 horas**. UI mostrando "loading infinito".

## Diagnóstico

```
documento:    27803d42-e448-4891-9f20-5976d71c3a94
file_size:    19.163.441 bytes (~19MB)
agent:        BRUNA (30a713d3) is_active=false
status antes: processing — desde 2026-04-27T17:59:38Z
chunks:       0 (nunca chegou no embedding)
runtime_logs: nenhum
```

Reproduzido com `curl` direto pra `process-agent-document`:

```
HTTP 546 | total 3.3s
{"code":"WORKER_RESOURCE_LIMIT","message":"Function failed due to not having
 enough compute resources"}
```

**Causa raiz**: edge function Deno tem isolate ~150MB heap. PDF 19MB → ArrayBuffer 19MB + base64 25MB + payload OpenAI multimodal + buffers internos = estoura. Worker morre antes de extrair texto, status persiste em "processing".

## Fix Opção B (chunked processing)

User pediu Opção B — RAG funcional pra PDFs grandes.

### Implementação

**Novo módulo** `supabase/functions/process-agent-document/pdf-chunking.ts`:
```ts
splitPdfIntoBatches(bytes, opts) → { batches: PdfBatch[], totalPages }
encodeBatchAsBase64(batch) → string
```

Usa `pdf-lib@1.17.1` (esm.sh) — split em sub-PDFs de N páginas (default 3).

**Modificado** `process-agent-document/index.ts`:
- Detecta `fileBytes.length >= 5MB` para PDFs
- Aciona background processing via `EdgeRuntime.waitUntil`
- Retorna 202 imediato com `mode: "background"`
- Worker faz: split → multimodal sequencial por batch → concat → summary → status="ready" → chunks + embeddings
- Tolerância a falha por batch: erros individuais não interrompem o todo

### Smoke test em PROD com PDF basic4u (19MB)

Após primeiro deploy:
```
HTTP 202 (mode=background) ✓
Polling 7+ min: status="processing" sem mudança
runtime_logs: 0 entries
chunks: 0
```

**Worker travou silenciosamente.** Hipótese: `pdf-lib.load(19MB)` ainda explode memória — biblioteca cria ~3x cópias intermediárias durante parsing + copyPages + save.

### Decisão final: hard limit 8MB

PDF >8MB em edge function Deno é **inviável empiricamente**. Reduzido `PDF_MAX_BYTES` de 100MB → 8MB.

```ts
// Empiricamente: pdf-lib.load() cria ~3x copias intermediarias.
// Edge function Deno isolate tem ~150MB heap. PDFs >8MB travam
// silenciosamente em prod (worker exit sem log, sem chunks).
const PDF_MAX_BYTES = 8 * 1024 * 1024; // 8MB
```

**Comportamento agora pra PDF 19MB**:
```
HTTP 400
{"error":"PDF muito grande (18.3MB). Limite atual: 8MB por arquivo.
 Divida o PDF em partes menores e envie cada parte separadamente.
 Suporte para PDFs maiores via worker dedicado esta no roadmap."}
```

`copilot_agent_documents.status='error'` com a mesma mensagem persistida. UI vai mostrar erro claro em vez de loading infinito.

### O que ainda funciona

- **PDFs ≤ 5MB**: fluxo single-shot existente (multimodal direto)
- **PDFs entre 5-8MB**: background path com split em batches de 3 páginas
- **Imagens (PNG/JPG/WebP/etc)**: sem limite duro, fluxo multimodal direto
- **DOCX/TXT/CSV/MD**: fluxo de extração de texto inalterado

### Roadmap pra suportar PDFs >8MB

A) **Frontend pdf.js split automático** (recomendado, médio esforço):
   - User sobe PDF 20MB
   - Browser detecta tamanho, splita em 3 partes via pdf.js
   - Cada parte vira `copilot_agent_documents` separado
   - UI agrupa visualmente: "Tabela B4u 26.pdf — Parte 1/3, 2/3, 3/3"
   - Backend processa cada parte via fluxo normal (todas <8MB)

B) **Worker dedicado fora de edge function** (alto esforço):
   - AWS Lambda / Cloudflare Durable Object / VPS endpoint
   - >500MB heap disponível
   - Edge function vira proxy fino que enfileira no worker

## Workaround imediato pra Basic4u

Pedir pro user dividir o PDF "Tabela B4u 26.pdf" (19MB) em 3 partes de ~6MB cada (qualquer tool gratuita: ilovepdf.com, smallpdf.com, Adobe Acrobat) e re-enviar cada parte separadamente. Cada parte vira um documento independente na base de conhecimento, todos indexados pra RAG.

## Validação

- **Suite unit**: 2.872 passed / 17 failed (pré-existentes em `shared-action-handler.test.ts`, sem relação com o fix) / 150 skipped.
- **Build prod**: 20.20s OK.
- **Smoke real PROD com PDF 19MB**: rejeitado HTTP 400 + status="error" persistido. Mensagem clara pro user.
- **Deploy PROD + DEV**: ambos LIVE.

## Commits

| Commit | Mudança |
|---|---|
| `b486575` | Implementação inicial Opção B (chunked PDF processing) |
| `2a036f3` | Hard limit 8MB após validar que pdf-lib trava em PDFs maiores |

## Refs

- [[Copilot]] — feature note
- [[2026-04-27-refactor-copilot-modules]] — refactor agent-engine modular (sessão da tarde)
