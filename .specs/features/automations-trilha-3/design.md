# Design — Trilha 3

## Sub-feature 3.A — Unificação de engines

### Estratégia

**Não migrar dados imediatamente.** Estratégia de absorção em 4 fases:

```
Fase A1: workflow engine ganha capabilities-equivalentes
Fase A2: shim — pipe-rule-dispatch e campaign-rule-dispatch viram thin wrappers que enfileiram workflow_executions
Fase A3: migration converte rules existentes em workflows (com flag wrapper_for)
Fase A4: deprecate cron + tabelas legadas após 30d sem incidente
```

### Componentes

```
supabase/functions/_shared/workflow-executor.ts ← novos nodes especializados
supabase/functions/_shared/workflow-action-handler.ts ← absorve handlers de pipe + campaign
supabase/functions/pipe-rule-dispatch/ ← vira shim (enqueue → workflow_executions)
supabase/functions/campaign-rule-dispatch/ ← idem
supabase/migrations/<ts>_pipe_rules_to_workflows.sql ← conversão
src/components/dispatch-rules/ ← ainda renderiza UI atual mas persiste em workflows
src/hooks/usePipeDispatchRules.ts ← refactored para escrever em workflows
```

### Schema delta

```sql
-- Marcar workflows que são wrappers de pipe/campaign
ALTER TABLE workflows ADD COLUMN wrapper_for text CHECK (wrapper_for IN (NULL, 'pipe_rule', 'campaign_rule'));
ALTER TABLE workflows ADD COLUMN wrapper_source_id uuid;  -- FK virtual para pipe_dispatch_rules.id ou campanha_dispatch_rules.id
CREATE INDEX idx_workflows_wrapper ON workflows (wrapper_for, wrapper_source_id) WHERE wrapper_for IS NOT NULL;
```

### Conversão pipe_rule → workflow

Pipe rule:
```
trigger: lead_added | lead_moved_to_stage
steps: [
  { action_type: send_template, template_id: X, delay_minutes: 0 },
  { action_type: wait_response, wait_timeout_minutes: 60 },
  { action_type: change_stage, target_stage_id: Y },
]
```

Equivalente workflow definition:
```json
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "data": { "trigger_type": "lead_moved_to_stage", "config": { "pipe_type": "whatsapp", "stage_id": "..." } } },
    { "id": "n1", "type": "action", "data": { "action_type": "send_template", "template_id": "X" } },
    { "id": "n2", "type": "wait_response", "data": { "timeout_minutes": 60 } },
    { "id": "n3", "type": "action", "data": { "action_type": "move_stage", "target_stage_id": "Y" } }
  ],
  "edges": [
    { "source": "trigger", "target": "n1" },
    { "source": "n1", "target": "n2" },
    { "source": "n2", "target": "n3", "sourceHandle": "responded" }
  ]
}
```

Conversor SQL via PL/pgSQL function `convert_pipe_rule_to_workflow(rule_id uuid) RETURNS uuid`.

### Trade-off engines unificados vs UX

UI atual de pipe rules (5 cliques) **não muda** para o user. Backend persiste em `workflows` com `wrapper_for='pipe_rule'`. Hook `usePipeDispatchRules` lê do `workflows` filtrando por wrapper.

**Trade-off aceito**: complexidade no hook (2 modos read: legacy table + new wrapper), mas UX preservada.

---

## Sub-feature 3.B — Refactor copilot

### Estratégia 5 fases

```
Fase B1 (semana 1-2): split agent-engine.ts em módulos (mesma lógica, arquivos separados)
Fase B2 (semana 2-3): testes unit por módulo + corrigir bugs estruturais identificados
Fase B3 (semana 3-4): introduzir feature flag organizations.copilot_engine_version
Fase B4 (semana 4-6): piloto 1-2 orgs em v2, observar métricas Onda 2
Fase B5 (semana 6-8): rollout 100% + cleanup v1
```

### Decomposição alvo

```
supabase/functions/_shared/copilot/
  context-loader.ts          ← loadCapabilities, loadConversationContext, cache LRU
  prompt-builder.ts          ← buildDynamicPrompt, buildDynamicTools, truncagem auditada
  llm-client.ts              ← OpenRouter wrapper com timeout + retry + token tracking
  sanitizer.ts               ← (mover de _shared/message-sanitizer.ts pra cá)
  state-machine.ts           ← determineNextState, valid transitions, RPC atomic increment
  dispatcher.ts              ← enqueueToolAction, idempotency key v2
  search-knowledge.ts        ← executeSearchKnowledge isolado, max iterations cap
  rag.ts                     ← embedding + pgvector queries
  followup.ts                ← getNextSendTime + schedule
  index.ts                   ← AgentEngine v2 entry point (orchestrator <300 LOC)
  __tests__/
    context-loader.test.ts
    prompt-builder.test.ts
    ...
```

### Cache strategy

Capabilities por agent_id em LRU in-memory + TTL 5min. Invalidação on update via realtime ou explicit bust.

```ts
const capabilitiesCache = new LRU<string, AgentCapabilities>({ max: 100, ttl: 5 * 60 * 1000 });
```

### Validação Zod tool_calls

```ts
import { z } from 'zod';

const ScheduleMeetingSchema = z.object({
  lead_id: z.string().uuid(),
  preferred_date: z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(180).default(30),
});

function validateToolCall(name: string, args: unknown) {
  const schema = TOOL_SCHEMAS[name];
  if (!schema) return { valid: false, error: `Unknown tool: ${name}` };
  const result = schema.safeParse(args);
  if (!result.success) return { valid: false, error: result.error.message };
  return { valid: true, data: result.data };
}
```

Vantagem: LLM recebe erro estruturado se mandou args inválidos → próxima iteração corrige. Hoje aceita silenciosamente.

### Feature flag

```sql
ALTER TABLE organizations ADD COLUMN copilot_engine_version text NOT NULL DEFAULT 'v1' CHECK (copilot_engine_version IN ('v1','v2'));
```

Edge function `agent-message`:
```ts
const org = await getOrg(organizationId);
const engine = org.copilot_engine_version === 'v2'
  ? await import('./engine-v2/index.ts').then(m => new m.AgentEngineV2(...))
  : new AgentEngine(...);  // v1 atual
```

### Comparação v1 vs v2

`/master/copilot-engine-comparison` lê `runtime_logs` (com colunas duration_ms + tokens da Onda 2) e plota:
- Latência p50/p95/p99 por engine_version
- Tokens médios por turno
- Taxa de erro
- Custo estimado / 1000 mensagens

---

## Plano integrado de rollout

### Cenário recomendado: 3.B primeiro

```
Semana 1-2: Fase B1 (split)
Semana 3-4: Fase B2 (testes + fixes)
Semana 5: Fase B3 (feature flag) — paralelo: começar Fase A1 (capabilities workflow)
Semana 6: Fase B4 piloto + Fase A1 continuação
Semana 7: Fase B4 piloto extensão + Fase A2 (shim)
Semana 8: Fase B5 rollout + Fase A3 (migration)
Semana 9-12: monitorar + cleanup
```

### Cenário paralelo (mais rápido, mais risco)

3.A e 3.B em paralelo desde semana 1. Requer 2 devs ou agents separados (Backend + AI).

### Critério de avanço entre fases

Cada fase só avança se:
- Testes passam
- Métricas de baseline (Onda 2) não pioram
- Zero regressão reportada por 7d

## Testes

- **3.A**: unit do conversor pipe→workflow + integration test rodando regra real em dev
- **3.B**: unit por módulo + integration test agent-message v2 vs v1 com mesma entrada → mesma saída (regression suite)
