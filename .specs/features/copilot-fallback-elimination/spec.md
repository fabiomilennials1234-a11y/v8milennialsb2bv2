# Copilot — Eliminação do fallback silencioso + unificação de pipeline inbound

**Created:** 2026-04-23
**Severity:** Production incident (usuário recebeu "Desculpe, houve um problema ao processar sua mensagem.")
**Conductor route:** AI → Security → Backend → DBA → Automation → QA → Security (gate)

## Context

Usuário perguntou no WhatsApp "a granel quais sabores tem?" — um pedido típico de catálogo que deveria disparar `search_knowledge` e retornar resposta textual. Em vez disso, recebeu o fallback genérico **"Desculpe, houve um problema ao processar sua mensagem."** (54 chars).

Logs de produção (últimas 72h, `function_logs` do projeto `jsjsmuncfkbsbzqzqhfq`):
- Eventos `messageLength: 54` com `action: SEND_DOCUMENT` aparecem repetidamente, confirmando que o LLM chamou uma tool mas retornou `content: null` — e o engine devolveu o fallback.
- Nenhuma ocorrência de `LLM call #3` — ou seja, o limite `MAX_TOOL_TURNS=3` não foi exaurido; o bug é de terminação precoce, não de exhaustão.

## Root causes (confirmadas no código)

### CR-1 — Fallback silencioso quando LLM retorna tool_call sem texto
[agent-engine.ts:173-222](supabase/functions/agent-message/agent-engine.ts#L173-L222). O loop multi-turn trata SEARCH_KNOWLEDGE via `continue`, mas qualquer outra tool (SEND_DOCUMENT, TRANSFER_HUMAN, etc) é resposta final. Se o LLM devolve `content: null` + `tool_calls: [send_document]`, `processLLMResponse` retorna `assistantMessage=''`, o loop quebra, o bloco final faz `finalAssistantMessage || 'Desculpe, houve um problema...'`. **Usuário vê o fallback mesmo com a action enfileirada corretamente.**

### CR-2 — Contrato OpenAI violado no replay do histórico
[agent-engine.ts:200-204](supabase/functions/agent-message/agent-engine.ts#L200-L204). Ao adicionar a assistant-message-com-tool_calls ao histórico multi-turn, persiste `content: msg || ''` (string vazia). A API espera `content: null` quando há tool_calls. Alguns providers/modelos tratam diferente — risco de incoerência.

### CR-3 — Apenas o primeiro tool_call é executado
[agent-engine.ts:2752-2773](supabase/functions/agent-message/agent-engine.ts#L2752-L2773). `message.tool_calls[0]` é lido; se o LLM retornar múltiplos (ex: `search_knowledge` + `transfer_to_human`), os demais somem.

### CR-4 — `finish_reason` nunca é consultado
Se o LLM retorna `finish_reason: 'length'` (truncou por max_tokens), o engine trata como sucesso. Resposta incompleta vai ao lead sem sinalização.

### CR-5 — `loadConversation` ignora agent_id e organization_id
[agent-engine.ts:1016-1036](supabase/functions/agent-message/agent-engine.ts#L1016). Assinatura é `(leadId, agentId)` mas o SELECT só filtra por `lead_id`. Sem `.eq('agent_id', agentId)` nem `.eq('organization_id', this.organizationId)`, um lead com múltiplas conversations quebra o `maybeSingle()` com "multiple rows returned". Risco cross-agent dentro do mesmo lead; risco cross-tenant se houver shadow-lead com mesmo id (improvável por UUID, mas defense-in-depth).

### CR-6 — Drift arquitetural: `whatsapp-webhook` (Uazapi) nunca aciona o Copilot
[whatsapp-webhook/index.ts:161-194](supabase/functions/whatsapp-webhook/index.ts#L161-L194). `handleMessagesEvent` somente faz `upsert` em `whatsapp_messages`. **Nunca invoca `agent-message`.** Qualquer org que use o provider Uazapi **não tem Copilot funcionando**. O `sz-chat-webhook` invoca corretamente ([sz-chat-webhook/index.ts:184](supabase/functions/sz-chat-webhook/index.ts#L184)); `evolution-webhook` também invoca. Só `whatsapp-webhook` ficou órfão.

### CR-7 — `identifyTenant` legado faz lookup cross-tenant
[agent-message/index.ts:231-246](supabase/functions/agent-message/index.ts#L231-L246). Quando `organization_id` não vem no body, busca lead por `normalized_phone` em **todas** as organizações e usa o mais recente. Um chamador autenticado como service-role pode forjar um lead em outra org. Security boundary fraca.

## Requirements

### Functional

- **FR-01**: Nenhuma mensagem enviada ao lead pode ser um fallback genérico vindo de `content==''` do LLM. O sistema precisa ter **estado explícito**: resposta válida, transferência humana válida, ou erro estruturado logado + opcionalmente fallback último recurso **com telemetria**.
- **FR-02**: Quando o LLM retorna `tool_calls + content:null`, o engine força uma chamada final **sem tools** (`tool_choice: 'none'`) para obter texto. Se ainda vier vazio, decisão explícita: escalonar pra humano ou responder um fallback pro canal marcado como "limited".
- **FR-03**: `whatsapp-webhook` (Uazapi) deve invocar `agent-message` após persistir mensagem `direction='incoming'`, com os mesmos parâmetros do `sz-chat-webhook`. Mesmos gates aplicam: `ai_disabled`, `WAITING_HUMAN`, `agent_active`, batching.
- **FR-04**: `loadConversation` filtra por `(lead_id, agent_id, organization_id)` e ordena determinísticamente.
- **FR-05**: `identifyTenant` sem `organization_id` falha com 400 e log explícito. Modo legado eliminado.
- **FR-06**: Múltiplos `tool_calls` em uma resposta devem ser todos enfileirados (FIFO) ou explicitamente rejeitados via `tool_choice` restrito. **Nada silencioso.**
- **FR-07**: `finish_reason` é logado e (quando `length`) é sinalizado como "resposta truncada" com retry ou transferência explícita.

### Non-Functional

- **NFR-01**: Telemetria obrigatória por mensagem: turnos usados, tools chamadas, `finish_reason` de cada turno, latência, `content_null_count`. Salvos em `runtime_logs.payload_snapshot` para diagnóstico sem depender de print de cliente.
- **NFR-02**: Multi-tenant estrito. Todo SELECT em `conversations`, `conversation_messages`, `copilot_agents` filtra por `organization_id`.
- **NFR-03**: Backward-compat: `fix-copilot-fallback` não pode quebrar testes existentes (2566+ passing no develop).
- **NFR-04**: Testes novos reproduzem o fallback ANTES do fix (assertivo) e o comportamento correto DEPOIS.

### Out of scope

- Reescrever o RAG/`executeSearchKnowledge` (comportamento atual OK quando invocado).
- Trocar modelo padrão ou ajustar prompts do Copilot.
- Consolidar `sz-chat-webhook` + `whatsapp-webhook` num único webhook — só garantir que ambos invocam o mesmo contrato `agent-message`.
- `WAITING_HUMAN` race conditions (separado, escopo adjacente).

## Acceptance

- **AC-01**: Reproduce test mostra que, ANTES do fix, um mock do LLM retornando `{content:null, tool_calls:[send_document], finish_reason:'tool_calls'}` faz `processMessage` retornar o fallback "Desculpe...". DEPOIS do fix, retorna uma resposta textual válida (obtida via retry sem tools) ou transferência explícita.
- **AC-02**: Test reproduz "a granel quais sabores tem?" via mock de LLM que chama `search_knowledge` → retorna resultado → LLM responde com texto. Resposta final tem `messageLength > 0` e não é o fallback.
- **AC-03**: `whatsapp-webhook` com payload `messages` + `direction=incoming` dispara `fetch(agent-message)` com corpo contendo `organization_id`, `from`, `message`, `channel='whatsapp'`. Test unit verifica.
- **AC-04**: `loadConversation` queried com 2 conversations no mesmo lead mas agent_ids diferentes retorna apenas a do agent solicitado.
- **AC-05**: `identifyTenant` sem `organization_id` retorna 400 com `{ error: "organization_id required" }`. Log com severity=error.
- **AC-06**: `finish_reason: 'length'` em resposta sem texto final gera log `copilot.response_truncated` e ou retry sem tools OU transferência — nunca fallback silencioso.
- **AC-07**: `runtime_logs` para cada invocação de `agent-message` contém `turns_used`, `tools_called`, `finish_reasons[]`.
- **AC-08**: Test suite completo passa (2566+ tests, zero regressões).

## Non-goals

- Não removemos `SEARCH_KNOWLEDGE` do loop especial (é o único inline). Outras tools continuam assíncronas via `enqueueAiAction`.
- Não substituímos OpenRouter por chamada direta à OpenAI.
- Não alteramos como `sz-chat-webhook` invoca `agent-message` (já funciona).
