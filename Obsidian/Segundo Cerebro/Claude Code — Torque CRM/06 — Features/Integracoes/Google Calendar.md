---
tags:
  - claude-code
  - feature
  - torque-crm
  - integracoes
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Google Calendar

## O que faz

Sync Google Calendar com CRM. OAuth 2.0 connect, push notifications via watch channel, event cache sync, compromisso_date sync com leads. Microservico Python separado para OAuth e API calls.

## Regras de negocio

- Watch channel expira e precisa renovacao automatica
- Events cacheados em google_calendar_events_cache
- Se event tem lead_id em extendedProperties, sync compromisso_date no lead
- Sharing permite delegar calendarios entre team members
- Microservico Python separado (`services/google-calendar-service/`)

## Como o usuario usa

1. Configuracoes → Google Calendar → Conectar
2. OAuth redirect → autoriza acesso
3. Eventos sincronizam automaticamente
4. Pagina Agenda mostra eventos do calendario
5. Pode compartilhar calendario com membros do time

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Agenda.tsx` — Pagina de calendario
- `src/components/settings/GoogleCalendarSettings.tsx` — Connect/disconnect
- `src/components/settings/GoogleCalendarSharingSettings.tsx` — Sharing

### Hooks

- `useGoogleCalendar()` — Status, events, connect, disconnect
- `useGoogleCalendarSharing()` — Gerencia sharing

### Edge Functions

- `google-calendar-connect` — Inicia OAuth (gera URL)
- `google-calendar-callback` — Troca code por tokens, subscribes watch channel
- `google-calendar-events` — Fetch e cache de eventos
- `google-calendar-disconnect` — Revoke token, stop watch
- `google-calendar-webhook` — Push notifications do Google (sync event → cache → lead compromisso_date)
- `google-calendar-sharing` — Add/remove shared calendars

### Microservico

- `services/google-calendar-service/` — Python + Docker
- Proxy via vite.config.ts: `/api/calendar-service` → `localhost:8000`

### Tabelas

- `google_calendar_tokens` — access_token, refresh_token, token_expires_at, google_email, is_active
- `google_calendar_events_cache` — summary, start, end, status, meet_link, lead_id, origin
- `google_calendar_subscriptions` — channel_id, resource_id, expiration_time

---

## Historico de mudancas

## Links relacionados

- [[Pipe Confirmacao]]
- [[Configuracoes]]
