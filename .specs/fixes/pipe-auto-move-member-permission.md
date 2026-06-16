# fix: auto-move de etapa por data travado para membro

**Issue:** #764
**Tipo:** bug (Pipe Confirmação)
**Origem:** incidente Basic4u — lead Dr. Luiz Dias preso em `confirmar_d1` com reunião no dia (2026-06-11). Move aplicado manualmente em prod.

## Problema

`autoUpdateStatuses` (`src/modules/pipelines/pages/PipeConfirmacao.tsx`) recalcula `stage_key` pela `meeting_date` e chama `updatePipeConfirmacao.mutateAsync({ status })`. `useUpdatePipeConfirmacao` trata mudança de status como movimentação manual e exige `move_pipe_record`. Membro não tem → mutação lança → `catch` só `console.error` → etapa nunca corrige. Auto-move é no-op silencioso para membro.

## Fix

Auto-move por data = transição de sistema, não ação manual → não deve gatear em `move_pipe_record`.

1. **(preferida)** Recálculo server-side: cron/edge function ou trigger em `pipeline_entries` reavaliando `stage_key` por `meeting_date`, independente de quem abriu o board.
2. **Curto prazo:** flag `isSystemAutoMove` em `useUpdatePipeConfirmacao` que bypassa a checagem `move_pipe_record` (transição determinística por data).

## Aceite

- Reunião hoje → card em `confirmacao_no_dia` para o membro sem depender de admin abrir o board.
- Sem regressão no gate de drag-drop manual.
- Teste: membro sem `move_pipe_record` + reunião hoje → etapa recalculada.

## Arquivos

- `src/modules/pipelines/pages/PipeConfirmacao.tsx`
- `src/modules/pipelines/hooks/legacy/usePipeConfirmacao.ts`
- (opção 1) edge function / pg_cron + trigger em `pipeline_entries`
