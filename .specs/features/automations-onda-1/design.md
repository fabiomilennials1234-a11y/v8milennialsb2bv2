# Design — Onda 1

## Estratégia geral

Migrations + edge function patches. Zero refactor estrutural. Cada item é isolado e independente exceto onde notado em "Depends on".

Ordem geral: P0 (independentes, paralelizáveis) → P1 (P1.2 depende de P0.2) → P2 (preventivo) → P3 (observabilidade).

## Componentes afetados

```
supabase/migrations/        ← novas migrations (8-10)
supabase/functions/
  process-ai-actions/       ← REQ-P1.3 timeout
  outbound-trigger/         ← REQ-P1.2 ON CONFLICT
  agent-message/agent-engine.ts ← REQ-P2.1, P3.1, P3.2, P3.3
  _shared/
    workflow-executor.ts    ← REQ-P1.1 heartbeat
    workflow-action-handler.ts ← (talvez REQ-P0.5)
    ai-action-executor.ts   ← REQ-P0.3, P0.4 caller
    workflow-trigger.ts     ← REQ-P2.2 depth guard
src/
  lib/
    leadOriginNormalizer.ts ← REQ-P0.1 frontend mirror
```

## Decisões de design por requisito

### REQ-P0.1 — enum `lead_origin`

**Decisão:** alterar enum no banco, não normalizar. Aceitar `web` nativamente.

**Por quê:** Cliente externo (n8n/webhook) já envia `web`. Normalizar em edge function deixa fragmento de validação espalhado. Enum é fonte de verdade.

**Migration:**
```sql
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'web';
```

**Trade-off:** valores ENUM imutáveis pós-criação. Adicionar OK; remover requer recreate. Aceito.

### REQ-P0.2 — outbound_dispatch_log

**Decisão a tomar pelo CTO:** criar tabela OU desativar cron+function?

Investigação: edge function `process-outbound-dispatches` referencia `outbound_dispatch_log`. Codebase tem `outbound-trigger` que cria registros nessa tabela hipotética. Provavelmente migration foi rollbackada ou nunca aplicada.

**Caminho recomendado:** criar tabela. Feature outbound é necessária pro copilot prospectador.

**Schema:**
```sql
CREATE TABLE outbound_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES copilot_agents ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','sent','failed','cancelled')),
  message_content text,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  error_message text,
  attempts smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbound_dispatch_log_pending ON outbound_dispatch_log (scheduled_at) WHERE status='pending';
CREATE INDEX idx_outbound_dispatch_log_org ON outbound_dispatch_log (organization_id, status);
-- REQ-P1.2: UNIQUE para prevenir duplicate
CREATE UNIQUE INDEX idx_outbound_dispatch_unique_active ON outbound_dispatch_log (lead_id, agent_id) WHERE status IN ('pending','sent');
ALTER TABLE outbound_dispatch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON outbound_dispatch_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY org_select ON outbound_dispatch_log FOR SELECT USING (organization_id IN (SELECT organization_id FROM team_members WHERE user_id = auth.uid()));
```

### REQ-P0.3 — Action registry

**Decisão:** mapeamento explícito em `_shared/ai-action-executor.ts`.

**Investigar primeiro:** o que `generate_message` e `send_product_material` deveriam fazer? Procurar callers (provável: regras de followup ou copilot kanban rules).

**Estratégia provisória:** se action não tem handler real ainda, registrar como no-op com warn estruturado em vez de retry-then-dead-letter (que é silencioso).

```ts
const NOOP_ACTION_TYPES = new Set(['generate_message', 'send_product_material']);
if (NOOP_ACTION_TYPES.has(action.action_type)) {
  await logRuntime({ ..., action: `noop:${action.action_type}`, status: 'skipped' });
  return { success: true, result: { skipped: true, reason: 'action_type not implemented' } };
}
```

### REQ-P0.4 — Transfer atomic

**RPC:**
```sql
CREATE OR REPLACE FUNCTION transfer_lead_to_human(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE leads SET ai_disabled = true, ai_disabled_at = NOW(), updated_at = NOW() WHERE id = p_lead_id;
  UPDATE conversations SET state = 'WAITING_HUMAN', updated_at = NOW() WHERE lead_id = p_lead_id;
END;
$$;
GRANT EXECUTE ON FUNCTION transfer_lead_to_human(uuid) TO service_role;
```

**Caller** (`_shared/ai-action-executor.ts:38-68`):
```ts
const { error } = await supabase.rpc('transfer_lead_to_human', { p_lead_id: leadId });
if (error) return { success: false, error: error.message };
return { success: true };
```

**Backfill data fix:** migration secundária roda 1x corrigindo as 115 conversas existentes.
```sql
UPDATE conversations c
SET state = 'WAITING_HUMAN', updated_at = NOW()
FROM leads l
WHERE c.lead_id = l.id AND l.ai_disabled = true AND c.state <> 'WAITING_HUMAN';
```

### REQ-P0.5 — Import `supabaseAdmin.from`

Investigar arquivo da edge function que processa workflow `Automação | Qualificação inicial`. Provável bug:
```ts
import { supabaseAdmin } from '...';
// uso: supabaseAdmin.from(...)  ← undefined export
```
Versus:
```ts
import { createSupabaseAdmin } from '...';
const supabaseAdmin = createSupabaseAdmin();
```

Fix: padronizar import. Adicionar teste smoke que carrega module e chama `.from('leads').select('id').limit(1)`.

### REQ-P1.1 — Heartbeat workflow executor

**Local:** `_shared/workflow-executor.ts:137-139` (UPDATE current_node_id já roda antes de cada node).

**Patch:**
```ts
await supabase.from("workflow_executions")
  .update({ current_node_id: nodeId, loop_counters: loopCounters, updated_at: new Date().toISOString() })
  .eq("id", executionId);
```

Adiciona `updated_at` no SET. Combinado com `claim_workflow_executions` filtrando `updated_at < now() - 10min`, qualquer execução ativa fica protegida de double-claim.

### REQ-P1.2 — Outbound UNIQUE + ON CONFLICT

UNIQUE INDEX já criado em REQ-P0.2. Caller em `outbound-trigger/index.ts:200-214` muda de SELECT+INSERT pra:
```ts
const { data: dispatch, error } = await supabase
  .from('outbound_dispatch_log')
  .insert({ ... })
  .select()
  .maybeSingle();
if (error?.code === '23505') {
  return Response.json({ success: false, reason: 'Dispatch already exists' });
}
```

### REQ-P1.3 — Timeout executeAiAction

**Patch** `process-ai-actions/index.ts:127`:
```ts
const TIMEOUT_MS = 30000;
const result = await Promise.race([
  executeAiAction(supabase, action),
  new Promise<{success: false; error: string}>((_, reject) =>
    setTimeout(() => reject(new Error('timeout: action exceeded 30s')), TIMEOUT_MS)
  ),
]).catch(e => ({ success: false, error: e.message }));
```

### REQ-P1.4 — Idempotency em conversation_messages

**Migration:**
```sql
ALTER TABLE conversation_messages ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX idx_conversation_messages_idempotency
  ON conversation_messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

**Caller** (agent-engine `addMessageToMemory`): gera key como `${role}_${turn_count}_${sha1(content).slice(0,8)}` e passa no insert. ON CONFLICT DO NOTHING.

### REQ-P2.1 — turn_count atomic

**Patch agent-engine.ts:2962-2981:**
```ts
const { error } = await supabase.rpc('increment_conversation_turn', {
  p_conversation_id: conversationId,
  p_new_state: newState,
});
```

**RPC:**
```sql
CREATE OR REPLACE FUNCTION increment_conversation_turn(p_conversation_id uuid, p_new_state text)
RETURNS void LANGUAGE sql AS $$
  UPDATE conversations
  SET turn_count = turn_count + 1,
      state = COALESCE(p_new_state, state),
      last_message_at = NOW(),
      updated_at = NOW()
  WHERE id = p_conversation_id;
$$;
```

### REQ-P2.2 — Trigger loop guard

**Migration:**
```sql
ALTER TABLE workflow_executions ADD COLUMN triggered_by_execution_id uuid REFERENCES workflow_executions(id) ON DELETE SET NULL;
ALTER TABLE workflow_executions ADD COLUMN chain_depth smallint NOT NULL DEFAULT 0;
CREATE INDEX idx_workflow_executions_triggered_by ON workflow_executions(triggered_by_execution_id) WHERE triggered_by_execution_id IS NOT NULL;
```

**`fire_workflow_trigger` patch:** aceitar `p_triggered_by_execution_id` opcional. Calcular `chain_depth` baseado no parent. Recusar se depth >= 5.

### REQ-P2.3 — Per-org cap no claim

**RPC patch:**
```sql
CREATE OR REPLACE FUNCTION claim_workflow_executions(batch_size int DEFAULT 20, per_org_cap int DEFAULT 5)
RETURNS SETOF workflow_executions LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY started_at) AS rn
    FROM workflow_executions
    WHERE (status = 'running' AND (next_run_at IS NULL OR next_run_at <= NOW()))
       OR (status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes')
    ORDER BY started_at
    FOR UPDATE SKIP LOCKED
  ), eligible AS (
    SELECT id FROM ranked WHERE rn <= per_org_cap LIMIT batch_size
  )
  UPDATE workflow_executions SET status = 'processing', updated_at = NOW()
  WHERE id IN (SELECT id FROM eligible) RETURNING *;
END;
$$;
```

Idem `claim_pending_ai_actions`.

### REQ-P3.1 — Logar success=false

Audit caller sites: `agent-engine.ts:3024-3050` (`logDecision`). Garantir que branch de erro também grava com `success=false` e `error_message` populado. Hoje provavelmente só grava sucessos.

### REQ-P3.2 — Idempotency key turn-based

`agent-engine.ts:2922`:
```ts
// Substituir
// const ts = Math.floor(Date.now() / 60_000);
const turn = conversation.turn_count;
// Usar `${actionType}_${leadId}_${turn}` + sufixo de params críticos
```

### REQ-P3.3 — Logar tamanho de prompt

`agent-engine.ts:140` após buildDynamicPrompt:
```ts
const promptChars = systemPrompt.length;
const estimatedTokens = Math.ceil(promptChars / 4);
await logRuntime({
  module: 'copilot', action: 'prompt_built', status: 'success',
  payloadSnapshot: { agent_id: capabilities.id, lead_id: leadId, prompt_chars: promptChars, estimated_tokens: estimatedTokens },
});
```

## Plano de rollout

```
1. Deploy migrations dev → smoke test
2. Deploy edge functions dev → smoke test
3. Validar métricas dev por 2h
4. Deploy migrations prod
5. Deploy edge functions prod (canary 1 cron, depois global)
6. Monitorar runtime_logs por 24h
7. Cleanup: arquivar functions/RPCs legacy após 7d
```

## Testes

Cada task ganha:
- **Migration**: smoke SQL contra dev
- **Edge function**: deploy dev + curl manual
- **RPC**: pgTAP test ou query direta

Sem cobertura de teste E2E nesta onda — Onda 2 traz visibility, dashboard mostra regressão.
