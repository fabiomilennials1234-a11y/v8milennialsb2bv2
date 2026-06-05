# 2026-06-05 — Copilot v1: gatilho "Quando enviar" para documentos (PDF)

## Mudanças

- **Copilot / Knowledge Base**: documentos (PDF/DOC/TXT) agora têm os campos
  **Descrição** + **Quando enviar** no Playground — antes só mídia (imagem/vídeo)
  tinha. Para documento, Descrição é opcional (summary vem do LLM); "Quando enviar"
  é o gatilho central.
- **Edição inline de metadata de doc/mídia já salvos**: a lista de documentos
  existentes deixou de ser read-only — `description`/`send_when` editáveis,
  persistidos no blur via novo `useUpdateAgentDocument`.
- **Tool `send_document`**: passa a expor `[Enviar quando: …]` por documento na
  descrição da tool (`build-tools.ts`), dando ao agente gatilho explícito sem
  clobberar o `summary` (que descreve o conteúdo).
- **Fix latente**: documento já salvo aparecia duas vezes no Playground (em
  `data.documents` para prompt/mention + em `existingDocs`); a lista pendente
  agora filtra `existingId`, eliminando o double-render. Para mídia, os campos
  editáveis na lista pendente não persistiam (handleSave só sobe `pending+file`)
  — agora a edição vive na lista de existentes, persistida de fato.
- **Segurança (RLS)**: `copilot_agent_documents` ganhou `WITH CHECK` na policy
  UPDATE (`org_members_update_agent_documents`) — antes só tinha `USING`, abrindo
  brecha de escalada de tenant ao habilitar UPDATE pela UI.

## Decisão técnica — reprocess

- **Documento**: editar `description`/`send_when` **não** re-dispara
  `process-agent-document`. O summary do PDF vem do conteúdo do arquivo, não do
  gatilho; o gatilho chega ao agente direto pela tool `send_document`.
- **Mídia**: editar `description`/`send_when` **re-dispara** `process-agent-document`
  (`reprocessMedia: true`) porque, para mídia, summary + embeddings derivam desses
  campos (`process-agent-document/index.ts:302-339`). Sem reprocess, summary/chunks
  ficariam stale.

## Arquivos tocados

- `supabase/migrations/20260605120000_harden_agent_documents_update_rls.sql` — WITH CHECK na UPDATE policy.
- `supabase/functions/agent-message/engine/build-tools.ts` — `send_when` no select + `[Enviar quando: …]` na descrição da tool.
- `src/modules/copilot/hooks/useAgentDocuments.ts` — `useUpdateAgentDocument` (persist + reprocess condicional).
- `src/modules/copilot/index.ts` — export do hook.
- `src/modules/copilot/components/playground/PlaygroundKnowledge.tsx` — campos pra documento + edição inline de existentes + filtro `existingId` (fix double-render).
- `src/modules/copilot/components/playground/CopilotPlayground.tsx` — wiring `onUpdateExisting` + sync de estado local.
- `tests/unit/use-update-agent-document.test.ts`, `tests/unit/build-tools-send-document.test.ts` — cobertura.

## Testes

- `npx vitest run` (2 arquivos novos): **2 passed (2) · 5 passed (5)**.
- `npm run build`: **✓ built in 29.25s** (exit 0).
- `eslint` nos arquivos tocados: **0 errors, 19 warnings** (todas pré-existentes — `any`/exhaustive-deps legados).
- tsc: projeto é baseline-red pré-existente (CI sem gate de tsc); **0 erros novos nos arquivos tocados**.

## Follow-ups

- Prompt preview de mídia: a edição de existente sincroniza `data.documents`
  localmente, mas a query `copilot_agent_for_edit` não é invalidada (evita reset
  do form). Aceitável; reavaliar se causar confusão.
- Deploy: edge fn `agent-message` (REQ-04) + migration RLS pendentes de deploy —
  **dev only**, prod só com pedido explícito do CTO.

## Specs

- `.specs/features/copilot-pdf-send-trigger/spec.md`
