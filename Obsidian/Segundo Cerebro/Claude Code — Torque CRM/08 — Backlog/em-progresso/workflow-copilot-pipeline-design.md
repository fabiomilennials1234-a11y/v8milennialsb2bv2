---
created: 2026-04-24
priority: P1
status: em-progresso
domain: workflow,copilot,backend
related-incident: 2026-04-24-generate-message-loop
---

# Backlog — workflow-copilot-pipeline-design

## Contexto

Workflow node tipo `copilot` ([workflow-executor.ts:337](../../../../supabase/functions/_shared/workflow-executor.ts:337)) enfileira `pending_ai_actions { action_type: "generate_message", payload: { source: "workflow", agent_id } }`. Handler em `ai-action-executor.ts` **nunca foi implementado** (débito desde commit `799a563` 2026-03-13).

Resultado: até 2026-04-24, qualquer workflow ativo com node copilot causava:
- "Tipo de ação desconhecido: generate_message"
- 3 retries com backoff
- Cron `process-ai-actions` re-pickup → loop infinito
- Spam runtime_logs (1000+ entries/24h em Milennials)

## Hotfix aplicado (2026-04-24)

Branch `hotfix/ai-action-executor-generate-message-noop`:
- Case `generate_message` → no-op success + warn log
- 4 testes ativos cobrindo regressão
- 2 pending stuck Milennials cancelados (`status='dead_letter'`)

**Não restaura funcionalidade**. Apenas para sangramento.

## O que falta desenhar (P1)

### Decisão de rota

Workflow node `copilot` quer: "use AGENTE específico para gerar próxima mensagem outbound a este lead". Opções:

1. **Bridge via `outbound-trigger`** — adicionar param `force_agent_id` em [outbound-trigger/index.ts](../../../../supabase/functions/outbound-trigger/index.ts), ai-action-executor invoca via fetch fire-and-forget. Pro: reusa pipeline existente (lead context, template, dispatch). Con: mistura "trigger automático por tag" com "trigger explícito por workflow".
2. **Direct call `agent-message`** — agent-message é incoming-driven (espera msg do lead). Adaptar para aceitar `mode: "outbound_workflow"` é pesado.
3. **Novo handler `executeGenerateMessage`** — replica subset de outbound-trigger inline (agent fetch, prompt build, sendOutboundDispatch). Pro: explícito. Con: duplicação.

Recomendação preliminar: **(1) Bridge via outbound-trigger** com flag `force_agent_id` + `template_override` (do payload do node, ex: `prompt: "..."`).

### Requisitos

- Receber `agent_id` (caso null hoje em payloads stuck — workflow-executor faz `if (agentId && leadId)` guard, mas pending stuck têm `agent_id: null` → indica algum outro caller histórico).
- Suportar `prompt`/template do payload (workflow node tem campo de instruções).
- Idempotência (ações duplicadas se workflow re-roda).
- Tenant isolation (agent_id pertence à org_id da action).
- Logging estruturado (entity_type=lead, action='generate_message', status).

### Tasks

- [ ] Auditar workflow-executor.ts:337-352 — confirmar payload shape atual + casos onde `agent_id: null` é gerado
- [ ] Decidir rota (1/2/3) com Architect + AI agents
- [ ] Spec em `.specs/features/workflow-copilot-pipeline/` (Medium escopo)
- [ ] Implementar `executeGenerateMessage` (ou adaptar `outbound-trigger`)
- [ ] Tests integration: workflow w/ copilot node → message enviada
- [ ] Remover `console.warn` do hotfix no-op
- [ ] Migration cleanup: `pending_ai_actions` legados Milennials (3 dead_letter)

### Risk

- Toca pipeline outbound (área frágil — Copilot)
- Se mal feito, agentes podem mandar mensagens duplicadas / pra leads errados

### Owner

Conductor → Architect (rota) → AI + Backend (impl) → QA (integration test) → Security (RLS check em pending_ai_actions reads)

## Referências

- Hotfix commit: branch `hotfix/ai-action-executor-generate-message-noop`
- Diagnóstico: changelog [2026-04-24](../../07%20—%20Changelog/2026-04-24.md)
- Investigação Uazapi (paralela): [2026-04-23](../../07%20—%20Changelog/2026-04-23.md)
