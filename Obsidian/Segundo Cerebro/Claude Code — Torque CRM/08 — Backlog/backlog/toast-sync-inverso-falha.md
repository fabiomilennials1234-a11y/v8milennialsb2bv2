---
type: backlog
title: Toast/Sentry quando sync inverso falha
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# Toast/Sentry quando sync inverso falha

## Problema

`useUpdateLead` propaga `compromisso_date → pipe_confirmacao.meeting_date` em modo best-effort. Se o UPDATE falhar (erro de rede, RLS, conflito), o hook hoje só chama `console.warn` — silenciosamente.

Resultado: usuário acha que "salvou" o lead, mas o pipe ficou desatualizado. Discrepância invisível operacional.

## Tarefa

- [ ] Em caso de falha do sync inverso:
  - [ ] Toast informativo: _"Lead atualizado, mas a data não chegou ao funil de Confirmação. Tente abrir o card e salvar de novo."_
  - [ ] Sentry breadcrumb com `lead_id`, `organization_id`, código do erro.
  - [ ] Não falhar a mutation principal — sync é best-effort por design.
- [ ] Considerar retry automático com backoff (1 tentativa, 500ms).
- [ ] Documentar comportamento em [[Pipe Confirmacao]].

## Critérios de aceite

- Falha de sync inverso fica visível ao usuário sem bloquear a operação principal.
- Sentry recebe sinal pra alertar caso a taxa cresça anormalmente.
- Test unit cobre os 3 caminhos: success, falha-com-retry-success, falha-final.

## Notas

Cuidado pra não criar barulho excessivo no Sentry — se o sync inverso bater consistentemente, é sinal de bug estrutural (RLS quebrada, FK ausente) e vale subir prioridade pra HIGH.
