# Spec — Gatilho "Quando enviar" para documentos (PDF) no Copilot v1

**Data:** 2026-06-05
**BC:** copilot
**Tipo:** feature pequena (UI + edge-fn tool)
**Origem:** estende `copilot-media-knowledge-base` (que trouxe `description`/`send_when` só pra mídia).

## Problema

Copilot v1 **já envia PDF** via tool `send_document` (`_shared/actions/send-document.ts`),
disparado pelo agente em `agent-message`. Mas o gatilho de envio de PDF depende só
do `summary` auto-gerado pelo LLM (`process-agent-document`). Não há controle
explícito do operador sobre **quando** o agente deve mandar o PDF.

Mídia (imagem/vídeo) já tem esse controle: campos "Descrição" + "Quando enviar"
na UI, persistidos em `copilot_agent_documents.description` / `.send_when`.
Documento (PDF/DOC/TXT) não — os campos são escondidos pelo gate `isMedia`.

Adicionalmente: hoje os campos só aparecem no **upload novo**. Documento já
existente (mídia inclusa) não tem edição de metadata — pra mudar "quando enviar"
é preciso re-subir o arquivo.

## Escopo (B)

Expor `description` + `send_when` para documentos **e** permitir editar metadata
de documentos já existentes (resolve a limitação pra doc e mídia de uma vez).

## Dados (sem mudança)

`copilot_agent_documents` já tem `file_type`, `description`, `send_when`
(migration `20260905000050_media_knowledge_base`). Nenhuma migration nova.

## Mudanças

### REQ-01 — UI: campos de metadata para documentos
`src/modules/copilot/components/playground/PlaygroundKnowledge.tsx`

- Remover o gate `isMedia` que esconde "Descrição" + "Quando enviar" na lista de
  docs pendentes (upload novo). Mostrar para `document` também.
  - Para `document`: "Descrição" é **opcional** (summary já vem do LLM); "Quando
    enviar" é o campo central. Ajustar placeholders ao contexto de documento.
- Microcopy por tipo: doc não precisa de "Descrição do conteúdo" obrigatória —
  rotular como "Descrição (opcional)".

### REQ-02 — UI: editar metadata de documento existente
`PlaygroundKnowledge.tsx` (bloco `existingDocuments`)

- Hoje existente é read-only (só deletar). Adicionar edição inline de
  `description` + `send_when` para docs já no banco.
- Persistir via novo hook `useUpdateAgentDocument` (debounce no blur/save —
  não salvar a cada keystroke).
- Vale para doc **e** mídia (existente de mídia também ganha edição).

### REQ-03 — Hook de update
`src/modules/copilot/hooks/useAgentDocuments.ts`

- Novo `useUpdateAgentDocument` espelhando `useUpdateCopilotAgentAudio`:
  - input `{ documentId, agentId, updates: Partial<Pick<AgentDocument, "description" | "send_when">> }`
  - `update` em `copilot_agent_documents` + `updated_at`
  - invalidar `["agent_documents", agentId]`
- Exportar no barrel `src/modules/copilot/index.ts`.
- Decisão: editar `send_when`/`description` de **documento** NÃO re-dispara
  `process-agent-document` (summary do PDF é do conteúdo, não do gatilho). O
  gatilho chega no agente via REQ-04, independente do summary. Para **mídia**,
  manter comportamento atual (summary = description+send_when); avaliar se a
  edição de mídia exige reprocess — se sim, engenheiro decide reprocess on-update
  só para `file_type != 'document'`.

### REQ-04 — Tool send_document expõe o gatilho
`supabase/functions/agent-message/engine/build-tools.ts`

- No bloco `send_document`, adicionar `send_when` (e `description`) ao `select`.
- Em cada linha de doc na descrição da tool, anexar quando presente:
  `— Enviar quando: {send_when}`.
- Não clobberar o `summary` (continua sendo o entendimento de conteúdo). O
  `send_when` é gatilho explícito adicional.

## Fora de escopo

- Migration (colunas existem).
- `useUploadAgentDocument` (já passa metadata genérico — zero mudança).
- `executeSendDocument` (agnóstico de tipo).
- `process-agent-document` (PDF segue pipeline LLM normal).
- Copilot v2 (esta feature é v1, isolada do rebuild).

## Arquivos tocados

| Arquivo | Mudança |
|---------|---------|
| `src/modules/copilot/components/playground/PlaygroundKnowledge.tsx` | REQ-01 + REQ-02 |
| `src/modules/copilot/hooks/useAgentDocuments.ts` | REQ-03 hook update |
| `src/modules/copilot/index.ts` | export hook |
| `supabase/functions/agent-message/engine/build-tools.ts` | REQ-04 gatilho na tool |

## Testes

- Unit: `useUpdateAgentDocument` (mutation + invalidate).
- Unit: `buildDynamicTools` — send_document inclui "Enviar quando" quando
  `send_when` presente; ausente não quebra.
- Manual: subir PDF com "quando enviar" → status ready → lead aciona contexto →
  agente envia PDF no gatilho certo. Editar existente → reflete na tool.

## Segurança

- RLS de `copilot_agent_documents` já scoped por `organization_id` — update herda.
  Confirmar policy de UPDATE existe (não só INSERT/DELETE) antes de mergear.
- Sem PII nova exposta. `send_when` é texto do operador.

## Deploy

- Default: branch nova + push. Dev only.
- Edge fn `agent-message` exige deploy (REQ-04). Não deployar prod sem pedido
  explícito do CTO.
