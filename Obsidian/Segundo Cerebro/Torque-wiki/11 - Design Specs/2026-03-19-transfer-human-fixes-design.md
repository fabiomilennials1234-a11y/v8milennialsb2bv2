---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-19-transfer-human-fixes-design.md
---

# Transfer Human - 7 Correçoes + Filtro no Chat

**Data:** 2026-03-19
**Status:** Aprovado
**Abordagem:** C (Híbrida - execução imediata + fila para side-effects)

---

## Problema

O `transfer_to_human` do Copilot funciona end-to-end mas tem 7 problemas identificados:

1. **Latência ~1min** - transferência vai para fila assíncrona; AI pode responder durante o gap
2. **Idempotência quebrada** - key `transfer_human_{leadId}` bloqueia transferências repetidas
3. **Sem estado visual diferenciado** - "IA desativada" e "transferido pelo Copilot" são iguais no frontend
4. **Motivo não exibido** - `reason` salvo no payload mas nunca mostrado ao vendedor
5. **Notificação condicional** - só notifica se `notifyUserId` configurado na automação
6. **Sem distinção Copilot vs Humano** - mensagens outgoing sem identificação de autor
7. **Sem contexto ao retomar** - agente retoma sem saber que houve intervenção humana

Feature adicional: filtro "Aguardando humano" no chat.

---

## Decisoes de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Execução da transferência | Imediata inline + fila para side-effects | Latência zero, sem duplicação |
| Notificação fallback | `responsible_id` → `team_members.user_id`, senão todos ativos da org | `responsible_id` já existe (migration 2026-08-05) |
| Tracking de autor | `sent_by_ai BOOLEAN DEFAULT false` em `whatsapp_messages` | Simples, binário, sem overengineering |
| Mensagens antigas | Ficam como `false` (human) | Retroatividade não é viável nem necessária |
| State ao reativar IA | Reset para `QUALIFYING` | Estado `ACTIVE` não existe no enum; `QUALIFYING` é o estado genérico ativo |
| Handler existente | `executeTransferHuman` mantido intacto | Usado por webhook-orchestrator e automation paths |
| History source value | `source: 'agent'` (não 'copilot') | CHECK constraint em lead_history.source só permite: manual, agent, automation, system |

---

## Seção 1: Backend - Transferência Imediata + Fila de Notificação

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

Nota: `determineNextState()` já retorna `WAITING_HUMAN` para `transfer_to_human`, então `updateConversationState()` (que roda depois no fluxo normal) escreverá WAITING_HUMAN novamente - redundante mas inofensivo, serve como safety net.

Se `immediateTransferHuman` falhar, logar o erro e continuar o fluxo normal (a mensagem de despedida do agente ainda deve ser enviada). O worker processará o fallback via fila.

### 1.2 Chamada imediata em `agent-engine.ts`

No `processMessage()`, entre `processLLMResponse()` e `enqueueToolAction()`:

```
if (actionToExecute?.action === 'TRANSFER_HUMAN') {
  const transferResult = await immediateTransferHuman(supabase, leadId);
  if (!transferResult.success) {
    console.warn('[AgentEngine] Immediate transfer failed, will rely on queue:', transferResult.error);
  }
  // Enfileirar apenas side-effects (notificação + lead_history)
  await enqueueAiAction(supabase, {
    organizationId,
    leadId,
    conversationId,
    actionType: 'transfer_to_human_notify',
    payload: { lead_id: leadId, reason: actionToExecute.params.reason },
    idempotencyKey: `transfer_human_notify_${leadId}_${minuteTs}`,
  });
  // Pular enqueueToolAction para TRANSFER_HUMAN (já executado imediatamente)
  // MAS: updateConversationState, logDecision, enqueueAutomationActions
  // continuam rodando normalmente no fluxo subsequente do processMessage()
}
```

**Importante:** Apenas `enqueueToolAction` é bypassado para `TRANSFER_HUMAN`. Todos os passos subsequentes do `processMessage()` continuam normalmente:
- `updateConversationState()` - salva a mensagem de despedida do agente, incrementa turn_count, escreve state (WAITING_HUMAN via determineNextState, redundante com o imediato)
- `logDecision()` - registra a decisão do agente
- `enqueueAutomationActions()` - processa automaçoes configuradas (onNeedHuman)

### 1.3 Novo handler `transfer_to_human_notify` em `ai-action-executor.ts`

Router switch:
```typescript
case "transfer_to_human_notify":
  result = await executeTransferHumanNotify(supabase, payload, organization_id, lead_id);
  break;
```

Implementação:
1. Busca `leads` WHERE `id = leadId` → obtém `responsible_id`, `name`, `company`
2. Se `responsible_id` existe → busca `team_members` WHERE `id = responsible_id AND user_id IS NOT NULL` → insere `notifications` para `team_members.user_id`
3. Se `responsible_id` null → busca todos `team_members` WHERE `organization_id = orgId AND is_active = true AND user_id IS NOT NULL` → insere `notifications` para cada `user_id`
4. Notification payload: `type: 'transfer_to_human'`, `title: 'Lead precisa de atendimento humano'`, `description: '{leadName}: {reason}'`, `link: '/pipe-whatsapp'`

Nota: a inserção em `lead_history` é feita pelo mecanismo genérico de history logging que já existe no `executeAiAction` (linhas 173-200 de ai-action-executor.ts), usando o history mapping abaixo. Não precisa de INSERT manual dentro de `executeTransferHumanNotify`.

### 1.4 History mapping atualizado

```typescript
transfer_to_human_notify: {
  action: "ai_toggled",
  descriptionFn: (p) => `Copilot transferiu: ${p.reason || 'sem motivo informado'}`,
  source: "agent",
},
```

Usa `action: "ai_toggled"` e `source: "agent"` para compatibilidade com o CHECK constraint existente em `lead_history.source` (valores permitidos: manual, agent, automation, system). A `metadata` do payload já carrega `{ reason }` para distinguir de outros toggles.

### 1.5 Idempotência corrigida

```typescript
case 'transfer_to_human_notify':
  return `transfer_human_notify_${leadId}_${ts}`; // ts = Math.floor(Date.now() / 60_000)
```

### 1.6 Handler existente `executeTransferHuman` - sem alteração

Continua funcionando para webhook-orchestrator e automation_need_human paths.

---

## Seção 2: Migração - `sent_by_ai`

### 2.1 Nova migração SQL

Filename: `supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql`

```sql
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by_ai BOOLEAN DEFAULT false;

CREATE INDEX idx_whatsapp_messages_sent_by_ai
  ON public.whatsapp_messages(sent_by_ai) WHERE sent_by_ai = true;
```

Mensagens existentes ficam como `false` (default). Apenas novas mensagens do Copilot serão marcadas.

### 2.2 Onde setar `sent_by_ai = true`

O INSERT em `whatsapp_messages` para respostas do agente acontece em `supabase/functions/evolution-webhook/index.ts`, **não** em `agent-engine.ts`. Dois sites de INSERT precisam de `sent_by_ai: true`:

1. **Linha ~1164** - resposta TTS (audio) do agente: adicionar `sent_by_ai: true` ao objeto do INSERT
2. **Linha ~1212** - resposta texto do agente: adicionar `sent_by_ai: true` ao objeto do INSERT

**NÃO** alterar:
- Linha ~1343 (MESSAGES_UPDATE event) - captura mensagens genéricas outgoing, pode ser humano ou dashboard
- `src/hooks/useWhatsAppChat.ts` (linhas 445, 651) - mensagens enviadas pelo frontend (humano)
- `supabase/functions/campaign-rule-dispatch/index.ts` - mensagens de campanha

Estes mantêm o default `false`.

---

## Seção 3: Frontend - Badge, Motivo, Distinção de Mensagens, Toggle Reset

### 3.1 Badge contextual no chat header (`WhatsAppChat.tsx`)

Ao lado do toggle de IA, exibir badge baseado no estado da conversa:

| Condição | Badge | Ícone | Cor |
|----------|-------|-------|-----|
| `conversation.state === 'WAITING_HUMAN'` | "Aguardando atendimento humano" | `UserPlus` | amber |
| `ai_disabled && state !== 'WAITING_HUMAN'` | "IA desativada" | `BotOff` | muted |
| IA ativa | sem badge | - | - |

Dados: `useConversationHistory` já retorna `conversation` com `state` (via `select(*)` na tabela conversations, linha 78-83). Consumir `history?.conversation?.state`. Sem query adicional.

Imports necessários: `UserPlus` e `BotOff` de `lucide-react` (UserPlus já está importado no AlertsDropdown, verificar se precisa importar no WhatsAppChat).

### 3.2 Motivo da transferência inline no chat

**Query:** Adicionar ao `useConversationHistory` uma query para `lead_history` WHERE `lead_id = ? AND action = 'ai_toggled' AND metadata->>'reason' IS NOT NULL`, retornando `{ id, action, description, metadata, created_at }`.

**Merge na timeline:** O hook já retorna `allMessages` como array com `timestamp`. Criar tipo union `TimelineItem = MessageItem | TransferEvent`. Intercalar `lead_history` entries no array por `created_at` vs `timestamp` das mensagens. O componente renderiza `TransferEvent` como card inline:

- Background: `bg-amber-50 dark:bg-amber-950/20`, borda esquerda `border-l-2 border-amber-400`
- Ícone: `UserPlus` amber
- Título: "Transferido para humano"
- Subtítulo: `metadata.reason`
- Timestamp: `formatDistanceToNow(created_at)`

### 3.3 Distinção Copilot vs Humano (`MessageBubble`)

Para mensagens outgoing:
- `sent_by_ai === true` → Label acima da bolha: ícone `Bot` (cor primary) + "Copilot" (text-[10px])
- `sent_by_ai === false` → Sem label (comportamento atual)

**Plumbing de dados em `useConversationHistory`:**

1. Atualizar interface `WhatsAppMessage` para incluir `sent_by_ai: boolean | null`
2. O `select("*")` existente (linha 125) já retornará `sent_by_ai` após a migração
3. No mapeamento de `allMessages`:
   - Branch `whatsapp_messages` (linhas 144-151): incluir `sent_by_ai: m.sent_by_ai ?? false`
   - Branch `conversation_messages` (linhas 137-143): inferir `sent_by_ai: m.role === 'assistant'`
4. O tipo unificado de mensagem no array `allMessages` deve incluir `sent_by_ai: boolean`

### 3.4 Toggle "reativar IA" com reset de estado (`useLeads.ts`)

Quando `disabled = false` (reativando IA), adicionar ao `mutationFn` após o UPDATE em leads:

1. UPDATE `conversations.state = 'QUALIFYING'` WHERE `lead_id = leadId` (reset do WAITING_HUMAN)
2. INSERT `lead_history`: `action: 'ai_reactivated'`, `source: 'manual'`, `metadata: { reactivated_by: userId }`

**RLS:** A tabela `conversations` permite UPDATE por usuários autenticados que são admins, responsáveis pela conversa, ou quando a conversa não tem responsável atribuído (`assigned_to`). Para a maioria dos casos de uso isso é suficiente. Se o UPDATE falhar por RLS (usuário não-admin sem permissão), logar o erro silenciosamente - o toggle de ai_disabled no lead ainda funciona, apenas o state da conversation não reseta. O agente tratará isso gracefully ao receber a próxima mensagem.

---

## Seção 4: Contexto de Intervenção Humana + Filtro no Chat

### 4.1 Contexto para o agente ao retomar (`agent-engine.ts`)

Na montagem do prompt (método que constrói `sections[]`), antes das capabilities dinâmicas:

1. Query: `lead_history WHERE lead_id = ? AND action = 'ai_toggled' AND metadata->>'reason' IS NOT NULL ORDER BY created_at DESC LIMIT 1`
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

**Contexto:** O chat UI usa `whatsapp_conversations` (metadata de chat) e `whatsapp_messages` (mensagens), que são tabelas separadas de `conversations` (state machine do Copilot). O join entre eles passa por `leads`: `whatsapp_messages.lead_id` → `leads.id` ← `conversations.lead_id`.

**Implementação:** Nova query React Query separada:

```typescript
const { data: waitingHumanLeadIds } = useQuery({
  queryKey: ['waiting-human-leads', organizationId],
  queryFn: async () => {
    const { data } = await supabase
      .from('conversations')
      .select('lead_id')
      .eq('organization_id', organizationId)
      .eq('state', 'WAITING_HUMAN');
    return new Set((data ?? []).map(c => c.lead_id));
  },
  refetchInterval: 30000, // 30s polling
});
```

Novo toggle ao lado do "Com lead" existente:
- Label: "Aguardando humano"
- Ícone: `UserPlus` amber
- Badge com `waitingHumanLeadIds.size` como contagem
- Quando ativo: filtra contatos client-side onde `contact.lead_id` está no Set

Contacts sem `lead_id` são excluídos pelo filtro (correto: sem lead = sem conversation = não pode estar WAITING_HUMAN).

---

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/agent-message/agent-engine.ts` | Chamada imediata de transfer (processMessage), contexto no prompt |
| `supabase/functions/_shared/ai-action-executor.ts` | `immediateTransferHuman()`, handler `transfer_to_human_notify`, history mapping |
| `supabase/functions/_shared/ai-queue.ts` | Sem alteração |
| `supabase/functions/evolution-webhook/index.ts` | `sent_by_ai: true` nos INSERTs de whatsapp_messages do agente (linhas ~1164, ~1212) |
| `supabase/migrations/20260319100000_add_sent_by_ai_to_whatsapp_messages.sql` | Nova coluna + índice parcial |
| `src/components/chat/WhatsAppChat.tsx` | Badge de estado, filtro "Aguardando humano", label Copilot em mensagens, imports |
| `src/hooks/useConversationHistory.ts` | `sent_by_ai` no tipo e mapeamento, `lead_history` para timeline, tipo union TimelineItem |
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
2. Idempotência usa timestamp por minuto - múltiplas transferências possíveis
3. Badge amber "Aguardando atendimento humano" aparece no chat quando `state = WAITING_HUMAN`
4. Motivo da transferência aparece como card inline na timeline do chat
5. Notificação sempre enviada - `responsible_id` do lead ou todos os team_members ativos
6. Mensagens do Copilot têm ícone Bot + "Copilot", mensagens humanas sem label
7. Toggle "reativar IA" reseta `conversations.state` para `QUALIFYING` e injeta contexto no agente
8. Filtro "Aguardando humano" no chat filtra conversas nesse estado
9. TypeScript 0 erros


## Links relacionados

- [[Chat WhatsApp]]

- [[MOC - Arquitetura]]

- [[Visao Geral]]

- [[Analise Logging SaaS]]

- [[Gestao de Time]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
