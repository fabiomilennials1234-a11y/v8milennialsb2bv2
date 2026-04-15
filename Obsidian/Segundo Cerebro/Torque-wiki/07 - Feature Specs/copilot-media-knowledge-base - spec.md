---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/copilot-media-knowledge-base/spec.md
---

# Copilot Media Knowledge Base

## Problema

O knowledge base do Copilot só aceita documentos de texto (PDF, DOCX, TXT). O usuário quer enviar imagens (tabela de preços, infográficos, cases) e vídeos (demo, tutorial) para o lead via WhatsApp, de forma automática e contextual.

## Solução

Estender o knowledge base para aceitar imagens e vídeos. Usar `generateMultimodalEmbedding` (Gemini Embedding 2, já implementado) para embedar os arquivos diretamente - sem extração de texto. Cada mídia recebe uma descrição + instrução de quando enviar. O copilot usa essa informação + busca semântica para decidir automaticamente o que enviar.

## Requisitos

### REQ-01: Novos campos na tabela `copilot_agent_documents`

```sql
ALTER TABLE copilot_agent_documents
  ADD COLUMN file_type TEXT NOT NULL DEFAULT 'document',  -- 'document' | 'image' | 'video'
  ADD COLUMN description TEXT,                             -- Descrição do conteúdo
  ADD COLUMN send_when TEXT;                               -- Instrução de quando enviar
```

- `file_type`: classifica o arquivo. Default `document` para retrocompat.
- `description`: texto livre descrevendo o conteúdo da mídia.
- `send_when`: instrução em linguagem natural de quando o copilot deve enviar.

### REQ-02: Upload de mídia no Playground

Estender `PlaygroundKnowledge` para:
- Aceitar: `.png`, `.jpg`, `.jpeg`, `.mp4`, `.mov` (além dos atuais)
- Ao detectar imagem/vídeo: mostrar campos **Descrição** e **Quando enviar**
- Preview thumbnail para imagens
- Indicador de tipo (badge: Imagem / Vídeo / Documento)
- Limite: 20MB por arquivo (limite do Gemini embedding inline)

### REQ-03: Pipeline de processamento (process-agent-document)

Modificar o edge function para tratar mídia diferente:

**Se `file_type === 'image'` ou `file_type === 'video'`:**
1. Skip text extraction (sem GPT-4o)
2. Gerar embedding multimodal direto: `generateMultimodalEmbedding(bytes, mimeType)`
3. Salvar embedding como chunk único em `copilot_agent_document_chunks` (chunk_index=0, content=description)
4. Usar `description` como content do chunk (para exibição nos resultados de busca)
5. Salvar `summary` = description (reusa o campo existente)
6. Status: `ready`

**Se `file_type === 'document'` (atual):**
- Pipeline inalterado (GPT-4o → text extraction → chunking → embedding de texto)

### REQ-04: Busca semântica retorna mídia

O `match_document_chunks` já funciona com qualquer vetor no mesmo espaço. Quando a busca retorna um chunk de mídia, o agent-engine precisa:
- Identificar que o documento de origem é mídia (`file_type = 'image'` ou `'video'`)
- Incluir na resposta de `search_knowledge`: além do texto, listar mídia disponível para envio
- O `send_document` tool já envia arquivos - estender para enviar mídia com o MIME type correto

### REQ-05: Seção de mídia no prompt

No `buildSystemPrompt` do Playground, quando há documentos de tipo `image` ou `video` com `description` e `send_when`:

```
# MÍDIA DISPONÍVEL PARA ENVIAR

## [imagem] Tabela de Preços 2026
Descrição: Tabela completa com planos e comparativo
Quando enviar: Quando o lead perguntar sobre preço ou pedir proposta

## [vídeo] Demo do Produto - 2 min  
Descrição: Demonstração das principais funcionalidades
Quando enviar: Quando o lead demonstrar interesse mas não entender o produto
```

### REQ-06: Persistência de description/send_when

Ao salvar/fazer upload de documentos no Playground:
- Passar `description` e `send_when` junto com o upload
- O edge function `process-agent-document` recebe e salva esses campos
- Na UI de edição, carregar de volta para exibir

## Limitaçoes Gemini Embedding 2 (referência)

| Tipo | Formatos | Limite |
|------|----------|--------|
| Imagem | PNG, JPEG | 20MB inline |
| Vídeo | MP4, MOV | ~120s sem áudio, ~80s com áudio |
| PDF direto | PDF | 6 páginas (mas mantemos extração de texto) |

## Fora de Escopo

- Streaming de vídeo inline no chat
- Compressão/otimização de mídia
- OCR de imagens (usa embedding multimodal direto)
- Migração de documentos existentes

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/XXXXXX_media_knowledge_base.sql` | Nova migration: file_type, description, send_when |
| `supabase/functions/process-agent-document/index.ts` | Condicional: mídia → embedding direto, documento → pipeline atual |
| `src/components/copilot/playground/PlaygroundKnowledge.tsx` | Upload de mídia + campos descrição/quando enviar |
| `src/components/copilot/playground/types.ts` | Estender KnowledgeDocument com file_type, description, send_when |
| `src/components/copilot/playground/CopilotPlayground.tsx` | Seção mídia no buildSystemPrompt |
| `src/hooks/useAgentDocuments.ts` | Passar metadata (description, send_when, file_type) no upload |
| `supabase/functions/agent-message/agent-engine.ts` | Estender search_knowledge e send_document pra mídia |


## Links relacionados

- [[MOC - Arquitetura]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
