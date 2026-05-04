# Agenda Interna

## O que e

Calendario interno do Torque CRM que agrega 4 fontes de eventos em uma view unificada: meetings (internos), follow-ups, mensagens agendadas e reunioes do pipe de confirmacao. Google Calendar aparece como overlay opcional para quem tem integracao ativa.

Substitui a pagina anterior que era apenas mascara do Google Calendar.

## Como funciona

### Fluxo de dados

```
[meetings table]                ─┐
[follow_ups table]              ─┤─→ RPC get_agenda_events ─→ useAgendaEvents hook ─→ Agenda.tsx
[scheduled_user_messages table] ─┤
[pipe_confirmacao table]        ─┘
                                     useCalendarEvents (Google) ─→ overlay opcional
```

### Arquivos chave

| Tipo | Path |
|------|------|
| Pagina | `src/pages/Agenda.tsx` |
| Componentes | `src/components/agenda/` (8 arquivos) |
| Hook unificado | `src/hooks/useAgendaEvents.ts` |
| Hook CRUD meetings | `src/hooks/useMeetings.ts` |
| RPC | `get_agenda_events` (migration `20260504000001`) |
| Migration | `supabase/migrations/20260504000001_create_meetings.sql` |
| Edge fn API | `supabase/functions/meeting-webhook/index.ts` |
| Config | `supabase/config.toml` (meeting-webhook entry) |

### Componentes extraidos

| Componente | Responsabilidade |
|------------|-----------------|
| `AgendaTopBar.tsx` | Navegacao, filtros por fonte, view switcher, status Google |
| `TimeGrid.tsx` | Grade dia/semana com linhas de hora e indicador tempo atual |
| `MonthView.tsx` | Grid mensal com event pills |
| `TimeGridEvent.tsx` | Card de evento no time grid |
| `MonthEventPill.tsx` | Pill compacta no month view |
| `EventDetailPopover.tsx` | Popover multi-fonte com acoes contextuais |
| `CreateMeetingDialog.tsx` | Dialog criacao de meeting interno |
| `agenda-helpers.ts` | Funcoes puras, constantes, tipos, layout de overlap |

## Regras de negocio

- **Multi-fonte**: Agenda mostra meetings + follow_ups + scheduled_messages + pipe_confirmacao unificados
- **Cores por fonte**: meeting=gold, follow_up=emerald, scheduled_message=blue, pipe_confirmacao=violet, google=Google blue
- **Filtros**: Cada fonte pode ser ligada/desligada independentemente via toggles
- **Google overlay**: So aparece se usuario tem Google Calendar conectado. Eventos duplicados (com google_event_id) sao deduplicados
- **CRUD meetings**: Apenas meetings internos podem ser criados/editados/deletados pela UI. Follow-ups, msgs agendadas e pipe_confirmacao sao readonly na agenda
- **Participantes**: Meetings suportam multiplos participantes (team_members) com status RSVP
- **API externa**: `meeting-webhook` aceita POST com API key (scope `meeting:write`) para criacao programatica. Idempotencia via `external_ref`
- **Permissoes**: Rota protegida por `agenda.view` feature permission

## Edge cases

- Follow-up sem `due_date` → nao aparece na agenda
- Scheduled message com status `cancelled`/`failed`/`sent` → nao aparece
- Pipe confirmacao sem `meeting_date` → nao aparece
- Meeting com `google_event_id` → Google overlay duplicate filtrado
- API webhook com `external_ref` duplicado → retorna meeting existente (201, idempotente)
- Lead lookup por telefone no webhook → normaliza telefone antes de buscar

## Areas frageis

- **Copilot `schedule_meeting`**: Acao do copilot ainda insere em `pipe_confirmacao`. Futuro: migrar para inserir em `meetings` diretamente
- **Google Calendar sync**: One-way read only (Google → overlay). Meetings internos NAO criam eventos no Google automaticamente (futuro)
- **Multi-tenancy**: RPC filtra por `organization_id`. RLS em meetings e meeting_participants

## Historico

- 2026-05-04 — Feature criada: migration meetings + meeting_participants + RPC get_agenda_events + edge fn meeting-webhook + hooks + refactor Agenda.tsx de monolito Google-only para agenda interna multi-fonte com componentes extraidos
- 2026-05-04 — Agenda ativada na navegacao top (TopNavigation + Sidebar). Empty state removido — agenda sempre mostra grade mesmo sem eventos
