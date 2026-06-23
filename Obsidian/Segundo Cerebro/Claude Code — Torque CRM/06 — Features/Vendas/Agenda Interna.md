---
type: feature
title: Agenda Interna
status: active
created: 2026-04-12
updated: 2026-06-23
tags: [uncategorized]
related: []
owner: gabriel
---

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
| Edge fn sync→Google | `supabase/functions/meeting-calendar-sync/index.ts` |
| Helpers evento Google | `supabase/functions/_shared/google-calendar-events-api.ts` |
| Trigger sync→Google | `supabase/migrations/20261128000000_meetings_google_calendar_sync.sql` |
| Config | `supabase/config.toml` (meeting-webhook + meeting-calendar-sync) |

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
- **Sync Torque → Google (bidirecional)**: Ao criar/editar/excluir um meeting, se o `created_by` tem Google conectado, o trigger `trg_meetings_google_sync_*` dispara `meeting-calendar-sync` (pg_net), que reflete a operacao no Google Calendar do criador e grava `google_event_id`/`meet_link` de volta. Combinado com o overlay (Google → Torque), a agenda fica espelhada nos dois lados. Sem Google conectado, o meeting fica so interno (no-op)
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
- **Google Calendar sync (bidirecional desde 2026-06-23)**: Google → Torque via overlay (read-only, ao vivo); Torque → Google via trigger `trg_meetings_google_sync_*` + edge fn `meeting-calendar-sync`. ⚠️ ANTI-LOOP: o write-back de `google_event_id`/`meet_link` NAO re-dispara o Google porque o trigger so reage a colunas relevantes (title/description/location/start_at/end_at/all_day/color). Mexer nessa lista exige re-auditar o loop. ⚠️ `created_by` referencia `team_members(id)`, mapeado para `team_members.user_id` antes de buscar o token em `google_calendar_tokens`. ⚠️ ATIVACAO: requer linha `meeting_calendar_sync_url` em `cron_config` por ambiente; sem ela o trigger so loga warning
- **Sync de leads (legado)**: o trigger `trg_leads_google_calendar_sync` (compromisso_date) chama `google-calendar-events` com service key como Bearer, que cai no `authenticateUser()` e retorna 401 — ou seja, esse caminho provavelmente nao funciona. Re-checar/migrar para o padrao do `meeting-calendar-sync` no futuro
- **Multi-tenancy**: RPC filtra por `organization_id`. RLS em meetings e meeting_participants

## Historico

- 2026-05-04 — Feature criada: migration meetings + meeting_participants + RPC get_agenda_events + edge fn meeting-webhook + hooks + refactor Agenda.tsx de monolito Google-only para agenda interna multi-fonte com componentes extraidos
- 2026-05-04 — Agenda ativada na navegacao top (TopNavigation + Sidebar). Empty state removido — agenda sempre mostra grade mesmo sem eventos
- 2026-06-23 — Sync bidirecional Torque → Google: trigger `trg_meetings_google_sync_*` em meetings + edge fn `meeting-calendar-sync` + helpers `_shared/google-calendar-events-api.ts`. Meetings criados/editados/excluidos no Torque agora refletem no Google Calendar do criador (se conectado). Reverso ja existia via overlay. Dedup por google_event_id (ja existente) evita duplicata. Frontend inalterado (`get_agenda_events` ja retornava google_event_id)
