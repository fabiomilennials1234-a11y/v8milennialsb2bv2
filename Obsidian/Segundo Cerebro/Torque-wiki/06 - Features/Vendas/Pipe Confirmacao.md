---
tags:
  - claude-code
  - feature
  - torque-crm
  - vendas
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Pipe Confirmacao

## O que faz

Kanban de confirmacao de reuniao. Stages baseadas em dias ate a reuniao (D-5, D-3, D-2, D-1). Auto-move baseado em meeting_date vs data atual usando calendar days.

## Regras de negocio

- Status computado automaticamente por diferenca de dias (calendar days, nao 24h)
- Stages: reuniao_marcada → confirmar_d5 → d3 → d2 → d1 → confirmacao_no_dia → remarcar → compareceu → perdido
- Follow-ups automaticos em D-5, D-3, D-1
- Integra com Google Calendar para sync de eventos
- Overdue configuravel por org (`organization_settings.confirmacao_overdue_days`)

## Como o usuario usa

1. Lead chega automaticamente do pipe_whatsapp (stage agendado)
2. Admin agenda reuniao (AddMeetingModal)
3. Sistema auto-move o lead conforme dias passam
4. Equipe confirma presenca ou remarca
5. Se compareceu → pode mover para pipe_propostas

## Edge cases

- Reuniao no passado mostra como overdue
- Remarcar reseta o countdown
- Lead sem meeting_date fica stuck em reuniao_marcada

---

## Como funciona (tecnico)

### Componentes

- `src/pages/PipeConfirmacao.tsx` - Pagina principal
- `src/components/confirmacao/AddMeetingModal.tsx` - Agendar reuniao
- `src/components/confirmacao/RescheduleModal.tsx` - Remarcar
- `src/components/confirmacao/CompareceuModal.tsx` - Confirmar presenca
- `src/components/confirmacao/MeetingTimeline.tsx` - Timeline visual do countdown
- `src/components/confirmacao/ConfirmacaoStats.tsx` - Stats por periodo
- `src/components/confirmacao/ConfirmacaoFilters.tsx` - Filtros (origem, urgencia)

### Hooks

- `usePipeConfirmacao.ts` - queryKey: `["pipe_confirmacao", orgId]`, join com leads e meeting dates
- `useOrganizationSettings.ts` - Config de overdue_days
- `useStageWorkflows.ts` - Badges de workflows
- `usePipelineStages.ts` - Stages configuradas

### Edge Functions

- `webhook-confirmacao` - Webhook de agendamento
- `process-followup-automations` - Cron 5 min, gera follow-ups D-X automaticos
- `google-calendar-events` - Sync de eventos do Google Calendar

### Tabelas

- `pipe_confirmacao` - status, meeting_date, lead_id, organization_id
- `leads` - Dados do lead
- `follow_ups` - Follow-ups automaticos gerados (D-5, D-3, D-1)
- `meeting_confirmations` - Tracking de presenca

### Fluxo de dados

```
Lead agendado no pipe_whatsapp
  → INSERT pipe_confirmacao (meeting_date definido)
    → Cada dia: status computado por diff(meeting_date, today)
      → process-followup-automations cria follow-ups nos dias D-5/D-3/D-1
        → Equipe confirma ou remarca
          → Compareceu → pode mover para pipe_propostas
```

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Webhooks]]

- [[WhatsApp Evolution]]

- [[Pipe WhatsApp]]
- [[Pipe Propostas]]
- [[Google Calendar]]
- [[Follow-ups]]
