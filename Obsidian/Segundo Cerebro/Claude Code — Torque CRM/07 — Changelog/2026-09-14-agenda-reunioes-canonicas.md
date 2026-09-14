---
title: Reuniões canônicas e presença na agenda
created: 2026-09-14
status: draft
type: changelog
---

Reuniões passam a ser contabilizadas pela agenda em `meetings`. O escritor de eventos
por mudança de etapa é desanexado; agendamento explícito mantém adaptador para os
editores de data existentes. API, Copilot, workflow e Cal.com usam a mesma tabela.
Presença fica restrita a reuniões. Corrigido estado do popover ao trocar evento.

Migração reconcilia histórico sem inventar falta nem repetir eventos de automação.
Implementação e ensaio concluídos; publicação em produção depende de autorização.
Detalhes: `docs/agenda-canonical-meetings.md`.
