# CLAUDE.md — `agent-message` edge function

Turn principal do Copilot. Lead manda msg → este function decide resposta IA.

> Área 🔴 Crítica. Ver
> [`Obsidian/.../02 — Arquitetura/Areas Frageis.md`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/02%20—%20Arquitetura/Areas%20Frageis.md)
> e [`Obsidian/.../06 — Features/IA/Copilot.md`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/06%20—%20Features/IA/Copilot.md).

## Fluxo (high level)

1. Recebe `message_id` ou `conversation_id`
2. Carrega context: agente + FAQs + business context + histórico
3. Chama Gemini com prompt assembled
4. Parse `<thinking>...</thinking><response>...</response>`
5. Persiste `agent_decision_logs.reasoning_chain` + `runtime_logs.reasoning`
6. Decide ação (responder, mover kanban, follow-up, etc.) via `ai-action-executor`
7. Outbound via `outbound-trigger` (cron 1min) — não chama Uazapi diretamente

## Refactor 2026-04-27

God module `agent-engine.ts` (2920 linhas) quebrado em capabilities/fases
após [`ADR-2026-04-27-refactor-agent-engine-modular`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/04%20—%20Decisões/ADR-2026-04-27-refactor-agent-engine-modular.md).

Estrutura modular vive em `../../_shared/copilot/`:
- `context-loader.ts` — `SELECT_AGENT` query com joins (FAQs, kanban rules)
- `build-prompt.ts` — `buildDynamicPrompt` (assembla system_prompt)
- (outros submódulos — conferir filesystem)

`agent-engine.ts` agora orchestrator (~924 linhas). `processMessage` chama
funções extraídas via `*External` aliases (mantém compat com testes).

## Não fazer

- Não voltar god module — refactor foi medido + validado em deploy DEV
- Não chamar Uazapi diretamente — sempre via `outbound-trigger` + `_shared/whatsapp-client`
- Não pular `agent_decision_logs` — audit obrigatório
- Não logar conteúdo de msg do lead em level info — PII (`logger.debug` only)

## Edge cases conhecidos

- Agente sem `business_context` → respostas genéricas. Recomendar set via
  `generate-business-context` edge fn.
- Lead sem `phone` → não recebe outbound. Function deve detectar + abortar early.
- `copilot_agent_faqs` sem embeddings → semantic search retorna vazio. Recomendar
  `generate-faq-embeddings`.
- Conversation sem mensagens prévias (cold start) → contexto curto, considerar
  template inicial.

## Schema dependencies

- `copilot_agents`
- `copilot_agent_faqs` (com embeddings pgvector 1536d)
- `copilot_agent_kanban_rules`
- `conversations` + `conversation_messages`
- `agent_decision_logs`
- `runtime_logs`
- FK pra `leads` + `organizations`

## Testes obrigatórios ao mexer

```bash
npx vitest run tests/unit/agent-engine-fallback.test.ts
npx vitest run tests/integration/agent-message.test.ts  # se existir
```

## Auth

`verify_jwt = false` em config.toml. Auth via:
- Header custom (admin actions)
- `organization_id` extraído do payload (cron/webhook calls)
- Service role para writes

## Logs

```bash
supabase functions logs agent-message --project-ref bcfadphgsibjzivtbjvc
```

Sentry tags: `copilot.agent_id`, `copilot.org_id`, `copilot.conversation_id`.
