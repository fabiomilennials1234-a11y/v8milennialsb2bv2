# Tasks — Onda 1

Legenda: `[P]` paralelo (sem dependência mútua) | `→ T#` depende de task

---

## P0 — Stop the bleeding (~9h)

### T1.0.1 [P] — Adicionar `web` ao enum `lead_origin`
- **What:** Migration `ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'web';`
- **Where:** `supabase/migrations/<ts>_add_web_to_lead_origin.sql`
- **Reuses:** padrão de migrations de enum
- **Done when:** dev + prod aceitam INSERT com `origin='web'`
- **Test:** `INSERT INTO leads (organization_id, name, origin) VALUES ('<test_org>', 'X', 'web');` retorna sucesso
- **Gate:** runtime_logs query 24h pós-deploy mostra 0 erros `lead_origin "web"`
- **Req:** REQ-P0.1
- **Estimativa:** 0.5h

### T1.0.2 [P] — Investigar destino de outbound_dispatch_log + decisão CTO
- **What:** Buscar callers e migration original. Confirmar com CTO: criar tabela ou desativar cron?
- **Where:** `grep -r "outbound_dispatch_log" supabase/`
- **Done when:** decisão registrada em STATE.md como D-onda1-001
- **Req:** REQ-P0.2 (gate)
- **Estimativa:** 0.5h
- **Blocks:** T1.0.3, T1.1.2

### T1.0.3 — Criar tabela outbound_dispatch_log (se decisão for criar)
- **What:** Migration com schema completo + RLS + UNIQUE INDEX (REQ-P1.2 incluso aqui)
- **Where:** `supabase/migrations/<ts>_create_outbound_dispatch_log.sql`
- **Reuses:** padrão schema de `pending_ai_actions`
- **Done when:** tabela existe em dev + prod, RLS habilitado, UNIQUE INDEX previne duplicação
- **Test:** INSERT direto + tentar duplicate deve retornar 23505
- **Gate:** runtime_logs 24h pós-deploy 0 erros `Could not find the table`
- **Req:** REQ-P0.2, REQ-P1.2
- **Depends on:** T1.0.2 (decisão)
- **Estimativa:** 2h

### T1.0.3-alt — Desativar cron + remover function (se decisão for desativar)
- **What:** Migration que remove pg_cron job + DROP FUNCTION se aplicável
- **Where:** `supabase/migrations/<ts>_disable_outbound_dispatches_cron.sql`
- **Done when:** SELECT FROM cron.job não retorna `process-outbound-dispatches`
- **Req:** REQ-P0.2 (alt)
- **Depends on:** T1.0.2

### T1.0.4 [P] — Investigar `generate_message` e `send_product_material`
- **What:** Encontrar callers (workflows? copilot kanban rules? followup rules?). Determinar o que deveriam fazer.
- **Where:** grep + Obsidian features search
- **Done when:** doc curto em `.specs/features/automations-onda-1/investigations/action-types.md` com origem + comportamento desejado
- **Req:** REQ-P0.3 (gate)
- **Estimativa:** 1h
- **Blocks:** T1.0.5

### T1.0.5 — Registrar handlers para action types desconhecidos
- **What:** Adicionar `NOOP_ACTION_TYPES` ou implementação real conforme T1.0.4. Logar como `skipped` em vez de gerar dead_letter silencioso.
- **Where:** `supabase/functions/_shared/ai-action-executor.ts`
- **Reuses:** padrão de logRuntime existente
- **Done when:** handler retorna `success: true` com `skipped: true`, evita retry/dead_letter
- **Test:** invocar manualmente com `action_type='generate_message'` retorna sucesso
- **Gate:** runtime_logs 24h pós-deploy: 0 erros `Tipo de ação desconhecido`, ações aparecem como `noop:generate_message status=skipped`
- **Req:** REQ-P0.3
- **Depends on:** T1.0.4
- **Estimativa:** 1h

### T1.0.6 [P] — RPC `transfer_lead_to_human`
- **What:** Criar RPC SQL com transação atômica. Backfill conversas existentes.
- **Where:** `supabase/migrations/<ts>_transfer_lead_to_human_rpc.sql`
- **Done when:** 
  - RPC existe e retorna void
  - Backfill UPDATE corrige as 115 conversas drift
- **Test:** chamar RPC + query drift deve retornar 0
- **Gate:** snapshot pós-deploy: 0 conversas com `ai_disabled=true AND state<>'WAITING_HUMAN'`
- **Req:** REQ-P0.4
- **Estimativa:** 1.5h
- **Blocks:** T1.0.7

### T1.0.7 — Substituir caller de transferência
- **What:** `ai-action-executor.ts:38-68` (`immediateTransferHuman`) chama RPC em vez de 2 UPDATEs separados. Manter assinatura. Manter função antiga em comentário 7d.
- **Where:** `supabase/functions/_shared/ai-action-executor.ts`
- **Done when:** edge function atualizada usa RPC, deploy ok
- **Test:** simular transfer em dev, verificar drift query = 0
- **Req:** REQ-P0.4
- **Depends on:** T1.0.6
- **Estimativa:** 0.5h

### T1.0.8 [P] — Fix `supabaseAdmin.from is not a function`
- **What:** Identificar workflow runner que importa errado. Padronizar import.
- **Where:** investigar — provavelmente `supabase/functions/_shared/workflow-action-handler.ts` ou caller que dispara `Automação | Qualificação inicial`
- **Done when:** module carrega + chama `.from(...)` sem TypeError
- **Test:** smoke local com `deno run` carregando module
- **Gate:** runtime_logs 24h: 0 erros `supabaseAdmin.from`
- **Req:** REQ-P0.5
- **Estimativa:** 1h

---

## P1 — Duplicação + travamentos (~9h)

### T1.1.1 [P] — Heartbeat workflow_executions.updated_at
- **What:** Patch `_shared/workflow-executor.ts:137-139` adiciona `updated_at: new Date().toISOString()` no UPDATE de current_node_id (roda antes de cada node)
- **Where:** `supabase/functions/_shared/workflow-executor.ts`
- **Reuses:** UPDATE existente
- **Done when:** workflow longo rodando 15min não é re-claimed por outro worker
- **Test:** dev — disparar workflow com delay 12min, verificar `workflow_executions.updated_at` avança
- **Req:** REQ-P1.1
- **Estimativa:** 1h

### T1.1.2 — UNIQUE constraint outbound (já feito em T1.0.3)
- **Status:** absorvido em T1.0.3 — ver REQ-P1.2
- **Req:** REQ-P1.2
- **Depends on:** T1.0.3

### T1.1.3 — Substituir SELECT+INSERT por INSERT ON CONFLICT em outbound-trigger
- **What:** `outbound-trigger/index.ts:200-214` remove SELECT prévio. INSERT direto. Tratar `23505` como "já existe".
- **Where:** `supabase/functions/outbound-trigger/index.ts`
- **Done when:** 2 requests simultâneos para mesmo (lead, agent) → apenas 1 dispatch criado
- **Test:** script paralelo de 10 requests simultâneos
- **Req:** REQ-P1.2
- **Depends on:** T1.0.3
- **Estimativa:** 1h

### T1.1.4 [P] — Timeout 30s em executeAiAction
- **What:** Promise.race em `process-ai-actions/index.ts:127`. Action timeout vira `failed`, retry path normal.
- **Where:** `supabase/functions/process-ai-actions/index.ts`
- **Done when:** ação travada não bloqueia >30s
- **Test:** mock action `await new Promise(() => {})` → falha em 30s com `error_message='timeout'`
- **Gate:** snapshot pós-deploy: 0 pending_ai_actions órfãs >24h
- **Req:** REQ-P1.3
- **Estimativa:** 1.5h

### T1.1.5 [P] — Coluna idempotency_key em conversation_messages
- **What:** Migration adiciona coluna + UNIQUE partial index
- **Where:** `supabase/migrations/<ts>_conversation_messages_idempotency.sql`
- **Done when:** schema atualizado, INSERT com mesma key 2x → 1 row
- **Req:** REQ-P1.4
- **Estimativa:** 0.5h
- **Blocks:** T1.1.6

### T1.1.6 — Caller usa idempotency_key
- **What:** `agent-engine.ts` `addMessageToMemory` (linhas ~3005-3011) gera key + ON CONFLICT DO NOTHING
- **Where:** `supabase/functions/agent-message/agent-engine.ts`
- **Done when:** dup detection funciona em produção
- **Test:** simular double-call processMessage idêntico → 1 message persistida
- **Gate:** snapshot 7d pós-deploy: pares assistant duplicadas <60s caem >95%
- **Req:** REQ-P1.4
- **Depends on:** T1.1.5
- **Estimativa:** 1.5h

---

## P2 — Hardening preventivo (~8h)

### T1.2.1 [P] — RPC `increment_conversation_turn` + caller
- **What:** RPC SQL atomic + patch agent-engine.ts:2962-2981
- **Where:** migration + agent-engine.ts
- **Done when:** SELECT+UPDATE separado eliminado; turn_count incrementa atomicamente
- **Test:** stress 100 chamadas paralelas via deno script → turn_count final = 100
- **Req:** REQ-P2.1
- **Estimativa:** 2h

### T1.2.2 — Adicionar triggered_by_execution_id + chain_depth
- **What:** Migration + patch `fire_workflow_trigger` aceita parent execution id
- **Where:** `supabase/migrations/<ts>_workflow_chain_depth.sql` + `_shared/workflow-trigger.ts` (callers passam parent)
- **Done when:** workflow A→B→A→B com depth=5 é recusado
- **Test:** cenário sintético em dev com 2 workflows que se disparam
- **Req:** REQ-P2.2
- **Estimativa:** 3h

### T1.2.3 [P] — Per-org cap no claim_workflow_executions
- **What:** RPC patch com window function
- **Where:** `supabase/migrations/<ts>_claim_per_org_cap.sql`
- **Done when:** org com 1000 jobs não consome >50% do batch
- **Test:** sintetizar 100 execuções em 2 orgs distintas, claim retorna distribuído
- **Req:** REQ-P2.3
- **Estimativa:** 2h

### T1.2.4 [P] — Per-org cap no claim_pending_ai_actions
- **What:** Mesma estratégia que T1.2.3 aplicada à RPC de AI actions
- **Where:** migration
- **Done when:** análogo
- **Req:** REQ-P2.3
- **Estimativa:** 1h

---

## P3 — Observabilidade base (~4h)

### T1.3.1 [P] — Garantir agent_decision_logs registra success=false
- **What:** Audit `agent-engine.ts:3024-3050` (`logDecision`). Adicionar branches de erro em todos os call sites.
- **Where:** agent-engine.ts
- **Done when:** snapshot 24h pós-deploy mostra >0 entries com success=false
- **Req:** REQ-P3.1
- **Estimativa:** 1.5h

### T1.3.2 [P] — Idempotency key turn-based
- **What:** Substituir `Math.floor(Date.now()/60_000)` por `conversation.turn_count` em `agent-engine.ts:2922`
- **Where:** agent-engine.ts
- **Done when:** key inclui turn_count; colisão em <60s impossível
- **Req:** REQ-P3.2
- **Estimativa:** 1h

### T1.3.3 [P] — Logar tamanho de prompt
- **What:** logRuntime após buildDynamicPrompt com prompt_chars + estimated_tokens
- **Where:** agent-engine.ts:140 (após assignment)
- **Done when:** runtime_logs ganha entries `action='prompt_built'`
- **Req:** REQ-P3.3
- **Estimativa:** 1h

---

## Resumo

| Fase | Tasks | Tempo | Paralelizáveis |
|---|---|---|---|
| P0 | 8 (incl. alt) | ~9h | T1.0.1, T1.0.2, T1.0.4, T1.0.6, T1.0.8 (5 simultâneas) |
| P1 | 5 | ~6h | T1.1.1, T1.1.4, T1.1.5 paralelas |
| P2 | 4 | ~8h | T1.2.1, T1.2.3, T1.2.4 paralelas |
| P3 | 3 | ~3.5h | tudo paralelo |
| **Total** | **20** | **~26.5h** | dia 1 P0, dia 2 P1, dia 3 P2, dia 4 P3+validation |

## Critério de fechamento da Onda

Todas tasks `completed` + métricas de sucesso da spec atingidas em snapshot 24h pós-deploy completo.
