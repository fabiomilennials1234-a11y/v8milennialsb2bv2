# 2026-06-10 — Observabilidade do fluxo "marcar reunião"

## Contexto

Usuário da org **Basic4u** reportou "erro ao adicionar reunião". Diagnóstico (query
read-only em prod) provou que o banco está **saudável** para a org: pipeline
`confirmacao` existe (`3bafc8d5-…`), stage `reuniao_marcada` existe (position 0),
flag `merged_opportunity_funnel` OFF (org padrão), RLS de INSERT padrão, nenhum
trigger de `pipeline_entries` faz RAISE no insert. **O insert da reunião não falha
no banco** — o erro real estava sendo engolido por catches genéricos no frontend,
impossibilitando o diagnóstico.

## Mudanças

- **pipelines**: catches do fluxo de reunião agora mostram a mensagem técnica real
  (toast `description`) + capturam no Sentry com contexto. Sem mudança na lógica de
  insert — só observabilidade.

## Arquivos tocados

- `src/shared/errors.ts` — **novo**. Helper `getErrorMessage(error)` extrai a causa
  legível de `PostgrestError` (message/details/hint/code), `Error`, string ou shape
  desconhecido. Reutilizável em qualquer catch cego.
- `src/modules/pipelines/components/legacy/confirmacao/AddMeetingModal.tsx` — catch
  do `handleSubmit` mostra `description` com erro real + `Sentry.captureException`
  (tags `feature:pipelines / add-meeting-failed`, extra `leadId/status`).
- `src/modules/pipelines/pages/PipeWhatsapp.tsx` — catch do `onSuccess` pós-agenda
  (mover card) idem.
- `src/modules/pipelines/components/kanban/SetMeetingDateModal.tsx` — `save()` no
  funil mergeado tinha `mutate` **sem `onError`** (falha silenciosa); adicionado
  `onError` com toast + Sentry.
- `tests/unit/shared-errors.test.ts` — **novo**. 9 casos do helper.

## Decisões

- Título do toast mantido amigável ("Erro ao adicionar reunião") + causa técnica no
  `description` — não assusta o usuário mas dá o sinal pro suporte/dev.

## Follow-ups

- **PENDENTE**: capturar o erro real do usuário Basic4u (com a versão deployada, o
  toast/Sentry agora mostram a causa). Hipóteses ainda abertas: `updateLead` (RLS no
  `pre_sale_responsible_id` quando SDR muda) ou `usePipelineId("confirmacao")` null
  em runtime (org context não pronto → throw "Pipeline confirmacao not found").
- Mesmo padrão de catch cego provavelmente existe em outros fluxos — candidato a
  varredura futura usando `getErrorMessage`.
