# Agendamento de Mensagens WhatsApp

**Data:** 2026-03-29
**Status:** Aprovado
**Inspiração:** Clint Digital

## Resumo

Permitir que vendedores agendem mensagens WhatsApp (texto + mídia) para serem enviadas automaticamente em data/hora específica. A feature integra-se no chat, no drawer do lead, e nos kanban cards — sem criar rotas novas. O vendedor é notificado quando a mensagem é enviada ou falha.

## Requisitos

### Funcional

1. Vendedor escreve mensagem (texto e/ou mídia) e escolhe quando enviar
2. Opções rápidas de agendamento: "Amanhã 9h", "Em 2 dias 9h", "Próxima segunda 9h", "Em 1 semana 9h"
3. Calendar picker + time input para controle total
4. Suporte a texto, imagem, vídeo, áudio e documento
5. 3 pontos de entrada: chat WhatsApp, LeadDetailDrawer, kanban card actions
6. Banner inline no chat mostrando mensagens agendadas do contato com opção de cancelar/editar
7. Filtro "Com agendamento" nos pipes/kanbans
8. Badge Clock nos kanban cards com agendamento pendente
9. Notificação in-app ao vendedor quando mensagem é enviada ou falha
10. Retry automático até 3x com backoff de 2 min em caso de falha

### Não-funcional

- Mensagem agendada enviada com precisão de ~1 minuto (cron a cada 1 min)
- RLS: membro vê apenas agendamentos da sua organização
- Membros não-admin veem apenas seus próprios agendamentos

---

## Data Model

### Tabela: `scheduled_user_messages`

```sql
CREATE TABLE public.scheduled_user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES team_members(id),
  whatsapp_instance_id UUID REFERENCES whatsapp_instances(id),
  message_content TEXT,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'document')),
  media_filename TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_or_media CHECK (message_content IS NOT NULL OR media_url IS NOT NULL)
);

-- Worker: pegar pendentes eficientemente
CREATE INDEX idx_scheduled_user_messages_worker
  ON scheduled_user_messages (scheduled_at)
  WHERE status = 'scheduled';

-- Listar por lead (banner inline no chat)
CREATE INDEX idx_scheduled_user_messages_lead
  ON scheduled_user_messages (lead_id, status);

-- Listar por membro (meus agendamentos)
CREATE INDEX idx_scheduled_user_messages_member
  ON scheduled_user_messages (created_by, status);

-- RLS
ALTER TABLE scheduled_user_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org scheduled messages"
  ON scheduled_user_messages FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can insert own org scheduled messages"
  ON scheduled_user_messages FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can update own scheduled messages"
  ON scheduled_user_messages FOR UPDATE
  USING (created_by IN (
    SELECT id FROM team_members WHERE user_id = auth.uid()
  ));
```

---

## Backend

### Edge Function: `process-scheduled-user-messages`

**Trigger:** pg_cron a cada 1 minuto (`* * * * *`)

**Fluxo:**

```
1. SELECT * FROM scheduled_user_messages
   WHERE status = 'scheduled' AND scheduled_at <= NOW()
   ORDER BY scheduled_at LIMIT 20

2. Para cada row:
   a. UPDATE status = 'sending' (lock otimista)
   b. Resolver instância WhatsApp:
      - Usa whatsapp_instance_id da row
      - Fallback: instância default da organização
   c. Detectar backend (SZ.chat vs Evolution API) pelo instance
   d. Enviar mensagem:
      - Texto: evolution-api-proxy → /message/sendText/{instance}
      - Mídia: evolution-api-proxy → /message/sendMedia/{instance}
      - Áudio: evolution-api-proxy → /message/sendWhatsAppAudio/{instance}
      - Reutiliza outbound-sender.ts para humanização e typing indicators
   e. Se sucesso:
      - UPDATE status = 'sent', sent_at = NOW()
      - INSERT em whatsapp_messages (histórico do chat)
      - INSERT notificação para created_by (type: 'scheduled_message_sent')
      - Log ação no lead (action: 'scheduled_message_sent')
   f. Se falha:
      - retry_count += 1
      - Se retry_count < 3: status = 'scheduled', scheduled_at += 2 min
      - Se retry_count >= 3: status = 'failed', error_message = erro
      - INSERT notificação para created_by (type: 'scheduled_message_failed')
```

### pg_cron Setup

```sql
-- Migration: adicionar cron job
INSERT INTO cron_config (function_name, function_url, cron_secret)
VALUES ('process-scheduled-user-messages', '<FUNCTION_URL>', '<SECRET>');

SELECT cron.schedule(
  'process-scheduled-user-messages',
  '* * * * *',
  $$ SELECT net.http_post(...) $$
);
```

Segue o mesmo pattern de `process-outbound-dispatches` e `process-followup-automations`.

### Notificações

Insere na tabela de alertas/notificações existente (mesmo sistema do `AlertsDropdown`):

- **Sucesso:** `{ type: 'scheduled_message_sent', title: 'Mensagem agendada enviada', description: 'Mensagem para {lead_name} enviada com sucesso', link: '/chat?contact={phone}' }`
- **Falha:** `{ type: 'scheduled_message_failed', title: 'Falha no envio agendado', description: 'Não foi possível enviar para {lead_name}. Verifique a conexão.', link: '/chat?contact={phone}' }`

---

## UI Components

### `ScheduleMessageModal`

Componente reutilizável. Props:

```typescript
interface ScheduleMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
  instanceName?: string;
  initialMessage?: string;       // pré-preenchido do input do chat
  initialMediaFile?: File;       // pré-preenchido se selecionou mídia
  editingId?: string;            // se editando agendamento existente
}
```

**Layout:**

```
┌─────────────────────────────────────────────┐
│  Agendar mensagem para {leadName}       [X] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────┐  [📎]  │
│  │ Escreva a mensagem...           │        │
│  │                                 │        │
│  └─────────────────────────────────┘        │
│                                             │
│  [preview de mídia se houver]               │
│                                             │
│  Quando enviar:                             │
│  [Amanhã 9h] [Em 2 dias] [Seg 9h] [1 sem]  │
│                                             │
│  ┌──────────────┐ ┌────────┐                │
│  │ 📅 29/03/2026 │ │ 14:00  │                │
│  └──────────────┘ └────────┘                │
│                                             │
│  ⏰ Será enviada em 29 mar 2026 às 14:00    │
│                                             │
├─────────────────────────────────────────────┤
│                    [Cancelar]  [⚡ Agendar]  │
└─────────────────────────────────────────────┘
```

**Validações:**
- Data/hora não pode ser no passado
- Mínimo 1 minuto no futuro
- Precisa ter `message_content` ou mídia (pelo menos um)
- Mídia: upload para Supabase Storage bucket `media` antes de salvar

**Design (hm-design):**
- Modal `sm:max-w-md`
- Textarea com `bg-muted rounded-lg` — mesmo estilo do chat
- Quick buttons: `text-xs px-3 py-1.5 rounded-full border` — mesmo pattern dos suggestion chips do Oráculo
- Calendar: reutiliza `Calendar` component do shadcn
- Time input: `Input type="time"`
- Indicador de data: `stat-card-label` style (11px uppercase)
- Botão Agendar: `gradient-primary text-white font-semibold`
- Preview de mídia: thumbnail 80px rounded-lg para imagens, pill com filename para docs

### Pontos de Entrada

#### 1. Chat WhatsApp

Na barra de input, adicionar botão `Clock` à esquerda do Send:
- Visível quando há texto digitado
- Click: abre `ScheduleMessageModal` com `initialMessage` preenchido
- Após agendar: limpa input, toast "Mensagem agendada para {data}"

```
[📎] [textarea...........................] [🕐] [➤]
```

#### 2. LeadDetailDrawer

Na aba Contexto, ao lado do `ScheduleFollowUpButton` existente, adicionar botão:
- `Clock` icon + "Agendar mensagem"
- Estilo: mesmo pattern do ScheduleFollowUpButton (Button variant outline, size sm)

#### 3. Kanban Card Actions

No `DropdownMenu` (⋮) de cada card, adicionar item:
- `Clock` icon + "Agendar mensagem"
- Posição: após as ações existentes, antes de "Remover"

### Banner Inline no Chat

Quando o contato selecionado tem `scheduled_user_messages` com `status = 'scheduled'`:

```
┌───────────────────────────────────────────────┐
│ 🕐 2 mensagens agendadas          [Ver ▾]    │
└───────────────────────────────────────────────┘
```

- Click em "Ver" expande lista:
  - Cada item: preview do texto (truncado 50 chars) + data/hora + [Cancelar] [Editar]
  - Cancelar: `UPDATE status = 'cancelled'`
  - Editar: abre `ScheduleMessageModal` com `editingId`

**Estilo:** Banner com `bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-sm` — sutil, não intrusivo.

### Filtro nos Pipes

Nos pipes (WhatsApp, Confirmação, Propostas, Custom), adicionar opção de filtro:
- Dropdown/toggle: "Com agendamento" com ícone Clock
- Filtra cards que têm `JOIN scheduled_user_messages` com `status = 'scheduled'`
- Posição: junto aos filtros existentes (origem, responsável, etc.)

### Badge nos Kanban Cards

Nos cards que têm mensagens agendadas pendentes, adicionar badge:
- Ícone `Clock` tamanho `w-3 h-3` com `text-primary/70`
- Posição: junto aos badges existentes (tags, calor, AI status)
- Tooltip: "X mensagem(ns) agendada(s)"

---

## Hooks

### `useScheduledMessages(leadId?: string)`

```typescript
// Query mensagens agendadas por lead ou por membro
const { data, isLoading } = useQuery({
  queryKey: ['scheduled-messages', leadId],
  queryFn: () => supabase
    .from('scheduled_user_messages')
    .select('*')
    .eq('lead_id', leadId)
    .eq('status', 'scheduled')
    .order('scheduled_at'),
});
```

### `useCreateScheduledMessage()`

```typescript
// Mutation para criar agendamento
const mutation = useMutation({
  mutationFn: async (data: {
    leadId: string;
    phoneNumber: string;
    messageContent?: string;
    mediaFile?: File;
    scheduledAt: Date;
    instanceId?: string;
  }) => {
    // 1. Upload mídia se houver
    // 2. INSERT em scheduled_user_messages
    // 3. Log ação no lead
  },
  onSuccess: () => {
    queryClient.invalidateQueries(['scheduled-messages']);
    toast.success('Mensagem agendada');
  },
});
```

### `useCancelScheduledMessage()`

```typescript
// Mutation para cancelar
const mutation = useMutation({
  mutationFn: (id: string) =>
    supabase.from('scheduled_user_messages')
      .update({ status: 'cancelled' })
      .eq('id', id),
});
```

### `useUpdateScheduledMessage()`

```typescript
// Mutation para editar (data/hora, conteúdo)
const mutation = useMutation({
  mutationFn: (data: { id: string; messageContent?: string; scheduledAt?: Date }) =>
    supabase.from('scheduled_user_messages')
      .update({ message_content: data.messageContent, scheduled_at: data.scheduledAt })
      .eq('id', data.id)
      .eq('status', 'scheduled'), // só edita se ainda não foi enviada
});
```

### `useLeadsWithScheduledMessages(orgId: string)`

```typescript
// Para filtro nos pipes: retorna set de lead_ids com agendamentos pendentes
const { data: leadIdsWithSchedule } = useQuery({
  queryKey: ['leads-with-scheduled', orgId],
  queryFn: () => supabase
    .from('scheduled_user_messages')
    .select('lead_id')
    .eq('organization_id', orgId)
    .eq('status', 'scheduled'),
  select: (data) => new Set(data.map(r => r.lead_id)),
});
```

---

## Arquivos a criar/modificar

### Criar:
- `supabase/migrations/YYYYMMDD_scheduled_user_messages.sql` — tabela + indexes + RLS + cron
- `supabase/functions/process-scheduled-user-messages/index.ts` — edge function worker
- `src/hooks/useScheduledMessages.ts` — hooks de query/mutation
- `src/components/chat/ScheduleMessageModal.tsx` — modal de agendamento
- `src/components/chat/ScheduledMessagesBanner.tsx` — banner inline no chat

### Modificar:
- `src/components/chat/WhatsAppChat.tsx` — botão Clock no input, banner no chat
- `src/components/leads/LeadDetailDrawer.tsx` — botão "Agendar mensagem"
- `src/components/leads/LeadCard.tsx` — badge Clock + item no dropdown
- `src/components/kanban/KanbanCard.tsx` — badge Clock + item no dropdown
- `src/pages/PipeWhatsapp.tsx` — filtro "Com agendamento"
- `src/pages/PipeConfirmacao.tsx` — filtro "Com agendamento"
- `src/pages/PipePropostas.tsx` — filtro "Com agendamento"
- `src/components/notifications/AlertsDropdown.tsx` — novo tipo de notificação

---

## Fora de escopo

- Templates pré-definidos (pode ser feature futura)
- Agendamento recorrente (ex: toda segunda às 9h)
- Agendamento por IA/Copilot (usa `outbound_dispatch_log` existente)
- Rota/página dedicada de agendamentos
- Filtro no chat sidebar (lista de contatos)
