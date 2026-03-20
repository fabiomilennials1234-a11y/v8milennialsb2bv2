# Transfer Human — 7 Correções + Filtro no Chat

**Data:** 2026-03-19
**Status:** Aprovado
**Abordagem:** C (Híbrida — execução imediata + fila para side-effects)

---

## Problema

O `transfer_to_human` do Copilot funciona end-to-end mas tem 7 problemas identificados:

1. **Latência ~1min** — transferência vai para fila assíncrona; AI pode responder durante o gap
2. **Idempotência quebrada** — key `transfer_human_{leadId}` bloqueia transferências repetidas
3. **Sem estado visual diferenciado** — "IA desativada" e "transferido pelo Copilot" são iguais no frontend
4. **Motivo não exibido** — `reason` salvo no payload mas nunca mostrado ao vendedor
5. **Notificação condicional** — só notifica se `notifyUserId` configurado na automação
6. **Sem distinção Copilot vs Humano** — mensagens outgoing sem identificação de autor
7. **Sem contexto ao retomar** — agente retoma sem saber que houve intervenção humana

Feature adicional: filtro "Aguardando humano" no chat.

---

## Decisões de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Execução da transferência | Imediata inline + fila para side-effects | Latência zero, sem duplicação |
| Notificação fallback | `responsible_id` → `team_members.user_id`, senão todos ativos da org | `responsible_id` já existe (migration 2026-08-05) |
| Tracking de autor | `sent_by_ai BOOLEAN DEFAULT false` em `whatsapp_messages` | Simples, binário, sem overengineering |
| Mensagens antigas | Ficam como `false` (human) | Retroatividade não é viável nem necessária |
| State ao reativar IA | Reset para `QUALIFYING` | Estado `ACTIVE` não existe no enum; `QUALIFYING` é o estado genérico ativo |
| Handler existente | `executeTransferHuman` mantido intacto | Usado por webhook-orchestrator e automation paths |

---

## Seção 1: Backend — Transferência Imediata + Fila de Notificação

### 1.1 Nova função exportada em `_shared/ai-action-executor.ts`

```typescript
export async function immediateTransferHuman(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ success: boolean; error?: string }>
```

Responsabilidades:
- `leads` UPDATE: `ai_disabled = true`, `ai_disabled_at = NOW()` WHERE `id = leadId`
- `conversations` UPDATE: `state = 'WAITING_HUMAN'` WHERE `lead_id = leadId`
- Retorna resultado. Sem notificação, sem lead_history.

### 1.2 Chamada imediata em `agent-engine.ts`

No `processMessage()`, entre `processLLMResponse()` e `enqueueToolAction()`:

```
if (actionToExecute?.action === 'TRANSFER_HUMAN') {
  await immediateTransferHuman(supabase, leadId);
  // Enfileirar apenas side-effects
  await enqueueAiAction(supabase, {
    organizationId,
    leadId,
    conversationId,
    actionType: 'transfer_to_human_notify',
    payload: { lead_id: leadId, reason: actionToExecute.params.reason },
    idempotencyKey: `transfer_human_notify_${leadId}_${minuteTs}`,
  });
  // Pular enqueueToolAction normal para TRANSFER_HUMAN
}
```

### 1.3 Novo handler `transfer_to_human_notify` em `ai-action-executor.ts`

Router switch:
```typescript
case "transfer_to_human_notify":
  result = await executeTransferHumanNotify(supabase, payload, organization_id, lead_id);
  break;
```

Implementação:
1. Busca `leads.responsible_id` WHERE `id = leadId`
2. Se `responsible_id` existe → join `team_members.user_id` → insere `notifications` para esse user
3. Se `responsible_id` null → busca todos `team_members` WHERE `organization_id = orgId AND is_active = true AND user_id IS NOT NULL` → insere `notifications` para cada um
4. Notification payload: `type: 'transfer_to_human'`, `title: 'Lead precisa de atendimento humano'`, `description: '{leadName}: {reason}'`, `link: '/pipe-whatsapp'`
5. Insere `lead_history`: `action: 'transfer_to_human'`, `source: 'copilot'`, `metadata: { reason }`

### 1.4 History mapping atualizado

```typescript
transfer_to_human_notify: {
  action: "transfer_to_human",
  descriptionFn: (p) => `Copilot transferiu: ${p.reason || 'sem motivo informado'}`,
  source: "copilot",
},
```

### 1.5 Idempotência corrigida

```typescript
case 'transfer_to_human_notify':
  return `transfer_human_notify_${leadId}_${ts}`; // ts = Math.floor(Date.now() / 60_000)
```

### 1.6 Handler existente `executeTransferHuman` — sem alteração

Continua funcionando para webhook-orchestrator e automation_need_human paths.

---

## Seção 2: Migração — `sent_by_ai`

### 2.1 Nova migração SQL

```sql
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by_ai BOOLEAN DEFAULT false;

CREATE INDEX idx_whatsapp_messages_sent_by_ai
  ON public.whatsapp_messages(sent_by_ai) WHERE sent_by_ai = true;
```

### 2.2 Onde setar `sent_by_ai = true`

No fluxo de `agent-message`, ao persistir a resposta do LLM em `whatsapp_messages`, incluir `sent_by_ai: true` no INSERT.

---

## Seção 3: Frontend — Badge, Motivo, Distinção de Mensagens, Toggle Reset

### 3.1 Badge contextual no chat header (`WhatsAppChat.tsx`)

Ao lado do toggle de IA, exibir badge baseado no estado da conversa:

| Condição | Badge | Ícone | Cor |
|----------|-------|-------|-----|
| `conversation.state === 'WAITING_HUMAN'` | "Aguardando atendimento humano" | `UserPlus` | amber |
| `ai_disabled && state !== 'WAITING_HUMAN'` | "IA desativada" | `BotOff` | muted |
| IA ativa | sem badge | — | — |

Dados: `useConversationHistory` já retorna `conversation` com `state`. Consumir `history?.conversation?.state`.

### 3.2 Motivo da transferência inline no chat

Buscar `lead_history` WHERE `lead_id = ? AND action = 'transfer_to_human'` e renderizar como card inline na timeline, posicionado cronologicamente entre mensagens:

- Background: `bg-amber-50`, borda esquerda `border-l-2 border-amber-400`
- Ícone: `UserPlus` amber
- Título: "Transferido para humano"
- Subtítulo: `metadata.reason`
- Timestamp: `formatDistanceToNow(created_at)`

### 3.3 Distinção Copilot vs Humano (`MessageBubble`)

Para mensagens outgoing:
- `sent_by_ai === true` → Label acima da bolha: ícone `Bot` (cor primary) + "Copilot" (text-[10px])
- `sent_by_ai === false` → Sem label (comportamento atual)

Dados em `useConversationHistory`:
- Quando source é `whatsapp_messages`: passar `sent_by_ai` do registro
- Quando source é `conversation_messages` com `role === 'assistant'`: inferir `sent_by_ai = true`

### 3.4 Toggle "reativar IA" com reset de estado (`useLeads.ts`)

Quando `disabled = false` (reativando IA), adicionar ao `mutationFn`:

1. UPDATE `conversations.state = 'QUALIFYING'` WHERE `lead_id = leadId` (reset do WAITING_HUMAN)
2. INSERT `lead_history`: `action: 'ai_reactivated'`, `source: 'manual'`, `metadata: { reactivated_by: userId }`

---

## Seção 4: Contexto de Intervenção Humana + Filtro no Chat

### 4.1 Contexto para o agente ao retomar (`agent-engine.ts`)

Na montagem do prompt (método que constrói `sections[]`), antes das capabilities dinâmicas:

1. Query: `lead_history WHERE lead_id = ? AND action = 'transfer_to_human' ORDER BY created_at DESC LIMIT 1`
2. Se registro existe e `created_at` < 24h atrás, injetar seção:

```
## CONTEXTO IMPORTANTE
Esta conversa foi transferida para um vendedor humano há X minutos.
Motivo original da transferência: {reason}
O vendedor interveio e devolveu a conversa para você.
Continue naturalmente, sem repetir perguntas já feitas.
```

Custo: 1 query extra, executada apenas quando lead está ativo (ai_disabled = false).

### 4.2 Filtro "Aguardando humano" no chat (`WhatsAppChat.tsx`)

Novo toggle ao lado do "Com lead" existente:

- Label: "Aguardando humano"
- Ícone: `UserPlus` amber
- Badge com contagem de conversas nesse estado
- Quando ativo: filtra contatos onde `conversations.state = 'WAITING_HUMAN'`

Implementação: query separada para buscar `lead_id`s com `conversations.state = 'WAITING_HUMAN'` e filtrar client-side a lista de contatos. Reusa realtime subscription existente para manter atualizado.

---

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/agent-message/agent-engine.ts` | Chamada imediata de transfer, contexto no prompt, idempotência |
| `supabase/functions/_shared/ai-action-executor.ts` | `immediateTransferHuman()`, handler `transfer_to_human_notify`, history mapping |
| `supabase/functions/_shared/ai-queue.ts` | Sem alteração |
| `supabase/migrations/YYYYMMDD_add_sent_by_ai.sql` | Nova coluna `sent_by_ai` |
| `src/components/chat/WhatsAppChat.tsx` | Badge de estado, filtro "Aguardando humano", label Copilot em mensagens |
| `src/hooks/useConversationHistory.ts` | Passar `sent_by_ai`, buscar `lead_history` para timeline |
| `src/hooks/useLeads.ts` | Reset `conversations.state` ao reativar IA, inserir lead_history |
| `src/components/notifications/AlertsDropdown.tsx` | Sem alteração (já consome notifications corretamente) |

## Deploy

```bash
supabase functions deploy agent-message --project-ref jsjsmuncfkbsbzqzqhfq
supabase functions deploy process-ai-actions --project-ref jsjsmuncfkbsbzqzqhfq
```

Migration aplicada via `supabase db push` ou dashboard.

## Critérios de Sucesso

1. Agente decide transferir → `ai_disabled = true` imediatamente, sem esperar worker
2. Idempotência usa timestamp por minuto — múltiplas transferências possíveis
3. Badge amber "Aguardando atendimento humano" aparece no chat quando `state = WAITING_HUMAN`
4. Motivo da transferência aparece como card inline na timeline do chat
5. Notificação sempre enviada — `responsible_id` do lead ou todos os team_members ativos
6. Mensagens do Copilot têm ícone Bot + "Copilot", mensagens humanas sem label
7. Toggle "reativar IA" reseta `conversations.state` para `QUALIFYING` e injeta contexto no agente
8. Filtro "Aguardando humano" no chat filtra conversas nesse estado
9. TypeScript 0 erros
