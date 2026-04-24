# Design — Copilot fallback elimination

## Architectural principle

**Toda mensagem do Copilot termina em um dos três estados explícitos:**

1. `response_text` — texto válido enviado ao lead, com action opcional enfileirada.
2. `human_transfer` — conversa transferida (`WAITING_HUMAN`), sem texto automático.
3. `explicit_error` — logado em `runtime_logs` com severity=error e métricas; mensagem mínima ao lead **apenas** se não houver alternativa (e marcada como `fallback_used: true`).

Fallback silencioso é o anti-padrão que queremos eliminar.

## Changes

### 1. Agent-engine multi-turn — terminal forced-text turn

[agent-engine.ts:173-222](supabase/functions/agent-message/agent-engine.ts#L173-L222)

Adicionar constante `FORCED_TEXT_TURN`: quando o loop principal (MAX_TOOL_TURNS) termina com `assistantMessage=''` e há uma action não-inline (ou nenhuma), fazer **uma chamada final extra** com `tool_choice: 'none'` e prompt-system adicionando "Responda em texto natural, sem chamar ferramentas". Garante resposta textual pro lead.

Se mesmo após forced-text o texto continuar vazio:
- logRuntime severity=error com `{reason:'llm_no_text_after_force', turns_used, tools_called, finish_reasons}`.
- Retornar `{ action: 'FALLBACK_USED', message: <fallback genérico>, _eval_meta:{fallback:true} }`.

A action original (SEND_DOCUMENT etc) continua enfileirada normalmente.

### 2. Contract-correct message replay

[agent-engine.ts:200-209](supabase/functions/agent-message/agent-engine.ts#L200-L209)

```ts
// Antes:
content: msg || '',
// Depois:
content: msg ?? null,  // preserva null quando LLM não devolveu texto
```

E em `openrouter-client.convertMessages`: se `content === null` + `tool_calls` presentes, preservar `null`. Se `content === null` + sem tool_calls, coagir para string vazia (modelos não aceitam null sem tool_calls).

### 3. Multiple tool_calls

[agent-engine.ts:2752-2773](supabase/functions/agent-message/agent-engine.ts#L2752-L2773)

Enfileirar **todas** as tool_calls:
- SEARCH_KNOWLEDGE: continua único/inline por iteração (não faz sentido paralelizar sem resultado).
- Outras actions: todas são enfileiradas. `actionToExecute` vira `actionsToExecute: Action[]`.

O caller (processMessage) itera e enfileira cada uma. Idempotency-keys distintos.

### 4. Log e react a `finish_reason`

Cada turno loga `finish_reason`. Se `length` e `assistantMessage.length === 0` → mesmo caminho forced-text turn. Se `length` e `assistantMessage.length > 0` → retorna o texto mas loga `truncated: true`.

### 5. loadConversation tenant-isolation

[agent-engine.ts:1016-1036](supabase/functions/agent-message/agent-engine.ts#L1016)

```ts
.from('conversations')
.select('*')
.eq('lead_id', leadId)
.eq('agent_id', agentId)
.eq('organization_id', this.organizationId)
.order('created_at', { ascending: false })
.limit(1)
.maybeSingle();
```

`organization_id` é adicionado como filtro defense-in-depth (RLS pode cobrir via service_role mas filtro explícito é melhor).

### 6. whatsapp-webhook → agent-message bridge

[whatsapp-webhook/index.ts:161-194](supabase/functions/whatsapp-webhook/index.ts#L161-L194) em `handleMessagesEvent`:

Após o upsert, se `direction === 'incoming'`:
- Resolver `content` (text ou transcribed). Se vazio, skip.
- `fetch(agent-message)` com body `{ from: phone_number, message: content, channel: 'whatsapp', organization_id: instance.organization_id, push_name, incoming_message_type: message_type }`.
- Fire-and-forget com `waitUntil` / `EdgeRuntime.waitUntil` se disponível; senão, `Promise.allSettled` com timeout curto.
- Log `runtime_logs.uazapi_agent_message_dispatched` com `message_id`.

Mesmo padrão do `sz-chat-webhook`. Não duplica lógica — apenas aciona o contrato.

### 7. identifyTenant — hard fail sem org_id

[agent-message/index.ts:229-249](supabase/functions/agent-message/index.ts#L229-L249). Remover fallback cross-tenant. Retorna 400 + log.

### 8. Telemetry

Em `processMessage`, acumular durante o loop:
```ts
const telemetry = {
  turns_used: 0,
  tools_called: [],       // ['search_knowledge', 'search_knowledge']
  finish_reasons: [],     // ['tool_calls', 'stop']
  content_null_turns: 0,
  forced_text_turn_used: false,
  fallback_used: false,
};
```
Salvo em `runtime_logs.payload_snapshot` no log final.

## Data model

Sem alteração de schema.

## Contracts

### `agent-message` (inbound body) — unified

```ts
interface AgentMessageRequest {
  from: string;                    // phone / external id
  message: string;
  channel: 'whatsapp' | 'sz_chat' | 'evolution';
  organization_id: string;         // REQUIRED — no more legacy lookup
  push_name?: string;
  incoming_message_type?: string;  // text/audio/image/...
}
```

Documentado em `.specs/codebase/INTEGRATIONS.md` (atualizado nesta task).

### Response

```ts
interface AgentMessageResponse {
  action?: string;                 // e.g. 'SEND_DOCUMENT', 'TRANSFER_HUMAN'
  message?: string;                // texto ao lead; pode ser vazio se action-only
  state?: string;                  // NEW_LEAD / QUALIFYING / WAITING_HUMAN / ...
  fallback_used?: boolean;         // NOVO — caller pode suprimir envio se true
}
```

Callers (`sz-chat-webhook`, `whatsapp-webhook`, `evolution-webhook`) devem **não enviar** mensagem ao lead se `fallback_used: true` — preferível silêncio ao boilerplate confuso. (Opcional: suprimir apenas em telemetry-only mode.)

## Trade-offs

- **+1 roundtrip** no forced-text turn (quando necessário). Rate: <5% dos casos atuais. Custo aceitável pelo ganho de qualidade.
- **Suprimir fallback** via `fallback_used` pode deixar o lead sem resposta em casos raros. Preferimos silêncio a mensagem ruidosa; alerta em runtime_logs permite operação manual.
- **Uazapi → agent-message** adiciona carga ao fluxo inbound. Fire-and-forget minimiza latência do webhook para Uazapi (ele precisa de 200 rápido).

## Residual risks

- **R1**: forced-text turn também retorna vazio em casos extremos. Mitigação: segundo fallback com system-prompt mais direto; se ainda assim falhar, humano entra via log alerta.
- **R2**: enfileirar todas as tool_calls pode gerar actions conflitantes (ex: qualify + disqualify). Improvável pelo prompt, mas monitorado via telemetria.
- **R3**: whatsapp-webhook fire-and-forget pode "perder" mensagem se a função cair durante invoke. Mitigação: log do message_id antes do fetch; worker manual pode reprocessar.
