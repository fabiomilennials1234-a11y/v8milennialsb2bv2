---
tags:
  - adr
  - torque-crm
  - ia
  - copilot
  - backend
  - security
created: 2026-04-23
status: accepted
authors:
  - agent-conductor
  - agent-ai
  - agent-security
  - agent-backend
  - agent-qa
---

# ADR — Copilot fallback elimination + Uazapi→Copilot bridge + tenant isolation

## Status

Accepted — 2026-04-23

## Contexto

Usuário enviou "a granel quais sabores tem?" pelo WhatsApp e recebeu do Copilot: **"Desculpe, houve um problema ao processar sua mensagem."** (54 chars). Era um padrão recorrente em produção — logs mostravam dezenas de ocorrências com `messageLength: 54` e `action: SEND_DOCUMENT`. Nenhum log com `LLM call #3`, logo o problema não era exaustão do MAX_TOOL_TURNS.

Auditoria do código (`supabase/functions/agent-message/`, `whatsapp-webhook/`, `sz-chat-webhook/`) revelou **7 causas raízes coexistindo**:

- **CR-1**: [agent-engine.ts:222](supabase/functions/agent-message/agent-engine.ts) — se o LLM retorna `content:null + tool_calls:[X]` onde X não é SEARCH_KNOWLEDGE (ex.: SEND_DOCUMENT), `processLLMResponse` retorna `assistantMessage=''`, o loop quebra, o código final faz `msg || 'Desculpe...'`. **Usuário vê o fallback mesmo com a action enfileirada corretamente.**
- **CR-2**: histórico de assistant+tool_calls persistido com `content: msg || ''` (string vazia) — viola contrato OpenAI que exige `null` quando há tool_calls.
- **CR-3**: `processLLMResponse` lê apenas `tool_calls[0]`; múltiplos tool_calls em um turno são silenciosamente descartados.
- **CR-4**: `finish_reason` nunca é consultado. Resposta truncada (`length`) passa como sucesso.
- **CR-5**: `loadConversation(leadId, agentId)` ignora o `agentId` e não filtra por `organization_id`. Pode quebrar com `maybeSingle()` em leads com múltiplas conversations; risco cross-agent.
- **CR-6**: `whatsapp-webhook` (Uazapi) **nunca invoca agent-message**. Apenas persiste em `whatsapp_messages`. Orgs em Uazapi ficavam sem Copilot funcional.
- **CR-7**: `identifyTenant` sem `organization_id` busca lead globalmente — cross-tenant boundary fraca.

## Decisão

1. **Fonte única do estado final da resposta do Copilot**: uma de três saídas explícitas — texto válido, transferência humana, ou erro estruturado. Zero fallback silencioso.
2. **Forced-text turn**: se o loop multi-turn termina com `assistantMessage=''`, o engine faz **uma chamada adicional** com `tool_choice:'none'` forçando o LLM a produzir texto. Só aí, se continuar vazio, o fallback genérico é usado e marcado em `telemetry.fallback_used`.
3. **Contrato OpenAI preservado**: `convertMessages` envia `content:null` em assistant+tool_calls.
4. **Múltiplos tool_calls** retornados via `extraToolCalls` — pelo menos observáveis (warn log + metric). Execução paralela é follow-up.
5. **`finish_reason` logado** e reagido: `length` vira `telemetry.truncated=true`.
6. **`loadConversation` tenant-isolated**: `.eq(lead_id).eq(agent_id).eq(organization_id).order().limit(1)`.
7. **`whatsapp-webhook` invoca agent-message** em cada mensagem incoming com texto. Parity com `sz-chat-webhook` e `evolution-webhook`. Fire-and-forget.
8. **`identifyTenant`** hard-fail sem `organization_id` — 400 + log error. Modo legado eliminado.
9. **Telemetria por invocação**: `turns_used`, `tools_called`, `finish_reasons`, `content_null_turns`, `forced_text_turn_used`, `fallback_used`, `truncated` — em `runtime_logs.payload_snapshot`.

## Alternativas consideradas

| Alternativa | Rejeitada porque |
|---|---|
| Retry cego do LLM em caso de content vazio | Trata o sintoma, custa mais e não garante sucesso. Forced-text turn é o retry direcionado e mais barato. |
| Tornar MAX_TOOL_TURNS maior | Não era exhaustão do loop, era o content vazio do próprio tool_call não-inline. Aumentar turns não resolveria. |
| Prompt tweak ("sempre responda em texto") | Frágil. Modelos ignoram quando escolhem tool. A solução precisa ser estrutural no engine, não no prompt. |
| Unificar os 3 webhooks (sz-chat + whatsapp + evolution) em um endpoint único | Escopo maior que a task. Todos chamam o mesmo `agent-message` agora — contrato unificado no destino é suficiente. |

## Consequências

### Positivas

- Elimina o fallback silencioso visto em produção.
- Orgs em Uazapi passam a ter Copilot funcional (antes: pipeline quebrado).
- Tenant isolation fortalecida em `loadConversation` + `identifyTenant`.
- Telemetria deixa o bug visível antes de depender de print do cliente.

### Custos

- +1 roundtrip OpenRouter quando forced-text turn é necessário (<5% das invocações em prod hoje).
- +1 fetch fire-and-forget no whatsapp-webhook por mensagem incoming.

### Riscos residuais

- **R1**: LLM continua não produzindo texto mesmo no forced-text turn. Mitigação: fallback final + telemetry alerta; equipe pode intervir manualmente.
- **R2**: `extraToolCalls` apenas logado (não enfileirado). Follow-up. Prod hoje raramente vê multi-tool; risco baixo.
- **R3**: whatsapp-webhook fire-and-forget pode perder mensagem se função cair antes do fetch. Mitigação: `runtime_logs` registra dispatch por message_id; reprocess manual possível.

## Referências

- Spec: [.specs/features/copilot-fallback-elimination/spec.md](.specs/features/copilot-fallback-elimination/spec.md)
- Design: [.specs/features/copilot-fallback-elimination/design.md](.specs/features/copilot-fallback-elimination/design.md)
- Branch: `fix-copilot-fallback`
- Tests: `tests/unit/agent-engine-openrouter-client.test.ts`, `tests/unit/agent-engine-fallback.test.ts`
