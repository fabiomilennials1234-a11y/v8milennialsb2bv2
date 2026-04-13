---
tags:
  - claude-code
  - feature
  - torque-crm
  - comunicacao
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Mensagens Agendadas

## O que faz

Agendar mensagens WhatsApp para envio em data/hora especifica. Suporta texto, imagens, video, audio e documentos. Background job processa a fila a cada minuto.

## Regras de negocio

- Status lifecycle: `scheduled` → `sending` → `sent` / `failed`
- Retry ate 3 vezes em caso de falha
- Media uploaded pro Supabase Storage antes do agendamento
- Cron roda a cada 1 minuto via pg_cron + pg_net
- Se `scheduled_at` ja passou, envia no proximo ciclo do cron

## Como o usuario usa

1. No chat, clica no icone de agendar mensagem
2. Escolhe data e hora no date/time picker
3. Escreve mensagem ou anexa midia (imagem, video, audio, documento)
4. Confirma agendamento
5. Ve banner inline com mensagens pendentes para aquele lead
6. Pode editar conteudo/horario ou cancelar antes do envio

## Edge cases

- Se WhatsApp instance estiver offline, mensagem fica como `failed`
- Se lead nao tem telefone, nao permite agendar
- Cancelar uma mensagem que ja esta em `sending` nao garante que nao sera enviada
- Media files ficam no Storage mesmo apos cancelamento

---

## Como funciona (tecnico)

### Componentes

- `src/components/chat/ScheduleMessageModal.tsx` — Modal com date/time picker e upload de midia
- `src/components/chat/ScheduledMessagesBanner.tsx` — Banner inline mostrando pendentes com acoes expand/collapse, edit, cancel

### Hooks

- `src/hooks/useScheduledMessages.ts`:
  - `useScheduledMessagesForLead(leadId)` — queryKey: `["scheduled-messages", leadId]`, filtra status='scheduled'
  - `useLeadsWithScheduledMessages()` — Retorna Set<lead_id> para filtrar pipes
  - `useCreateScheduledMessage()` — Upload media + insert row
  - `useCancelScheduledMessage()` — Atualiza status para 'cancelled'
  - `useUpdateScheduledMessage()` — Atualiza conteudo e/ou horario
  - `useMyScheduledMessages()` — Lista mensagens do usuario atual (ou org se admin)

### Edge Functions

- `process-scheduled-user-messages` — Cron 1 min. Busca WHERE status='scheduled' AND scheduled_at <= now(). Envia via `evolution-api-proxy` ou `sz-chat-send`. Atualiza status.

### Tabelas

- `scheduled_user_messages` — id, organization_id, lead_id, phone_number, created_by, whatsapp_instance_id, message_content, media_url, media_type, media_filename, scheduled_at, status, sent_at, error_message, retry_count, created_at

### Fluxo de dados

```
Usuario agenda mensagem
  → Upload media pro Storage (se houver)
    → INSERT scheduled_user_messages (status=scheduled)
      → pg_cron 1 min → edge function
        → Busca pendentes (scheduled_at <= now)
          → UPDATE status=sending
            → Envia via Evolution API / SZ.Chat
              → UPDATE status=sent (ou failed + retry_count++)
```

---

## Historico de mudancas

## Links relacionados

- [[Chat WhatsApp]]
- [[WhatsApp Evolution]]
- [[SZ Chat]]
