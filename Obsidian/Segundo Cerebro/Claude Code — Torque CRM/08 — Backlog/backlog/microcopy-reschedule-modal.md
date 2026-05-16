---
type: backlog
title: Microcopy do RescheduleModal
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---



# Microcopy do RescheduleModal

## Problema

`ConfirmacaoContext.tsx` agora detecta erro `"Sem permissão"` e troca o toast genérico pela mensagem amigável:

> "Você pode editar a data sem mudar a etapa do funil. Para mover entre etapas, peça permissão a um admin."

`RescheduleModal.tsx` (full-form de reagendamento) ainda usa toast genérico. Member que tenta reagendar e bate no gate `move_pipe_record` recebe apenas "Sem permissão para mover registros no pipe" — sem orientação.

## Tarefa

- [ ] Aplicar o mesmo tratamento de erro do `ConfirmacaoContext` no `RescheduleModal`.
- [ ] Validar com UX se a copy precisa ser ajustada para o contexto de reagendamento full-form (pode ter tom mais detalhado).
- [ ] Considerar extrair helper `formatPermissionError(error)` reutilizável entre os dois (e futuros).

## Critérios de aceite

- Member sem `move_pipe_record` que clica "Reagendar" recebe mensagem amigável + orientação.
- Sem regressão no path de erro real (DB error, network).
- Helper extraído (se decidido) com 100% cobertura unit.
