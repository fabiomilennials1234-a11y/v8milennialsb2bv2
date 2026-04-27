# Design — Onda 2

## Estratégia

Adicionar 2 tabelas (`system_alerts`, `audit_log`), 1 página master, 1 aba em automações, instrumentar logRuntime calls, trigger genérica de audit.

## Componentes

```
supabase/migrations/
  + system_alerts table
  + audit_log table
  + audit trigger function
supabase/functions/
  _shared/logger.ts      ← extender pra duration/tokens
  agent-message/         ← startTime + tokens via OpenRouter response
  process-ai-actions/    ← duration
  reprocess-dead-letter/ ← nova edge function (ou usar retry-dead-letter-jobs existente)
  retry-workflow-execution/ ← nova edge function
src/
  pages/master/AutomationHealth.tsx   ← REQ-O2.1
  pages/AutomacoesErros.tsx (ou aba) ← REQ-O2.3
  components/automation-health/       ← cards, tabelas
  components/system-alerts/Banner.tsx ← REQ-O2.4
  hooks/useAutomationHealth.ts
  hooks/useWorkflowErrors.ts
  hooks/useSystemAlerts.ts
```

## Schema novas tabelas

### system_alerts
```sql
CREATE TABLE system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations ON DELETE CASCADE,  -- null = master-level
  severity text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  category text NOT NULL,  -- 'webhook_circuit_breaker', 'workflow_stuck', etc
  source_type text,        -- 'webhook', 'workflow', 'copilot', etc
  source_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_alerts_unresolved ON system_alerts (created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_system_alerts_org ON system_alerts (organization_id, created_at DESC);
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_all ON system_alerts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY org_select ON system_alerts FOR SELECT USING (organization_id IS NULL OR organization_id IN (SELECT organization_id FROM team_members WHERE user_id = auth.uid()));
```

### audit_log
```sql
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id text NOT NULL,
  organization_id uuid,
  actor_role text NOT NULL,  -- 'service_role', 'authenticated', etc
  actor_function text,        -- edge function name (if injected via header)
  changes jsonb,              -- diff antes/depois (apenas pra UPDATE)
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_table_time ON audit_log (table_name, occurred_at DESC);
CREATE INDEX idx_audit_log_org_time ON audit_log (organization_id, occurred_at DESC) WHERE organization_id IS NOT NULL;
-- Particionado por mês
SELECT partman.create_parent('public.audit_log', 'occurred_at', 'native', 'monthly');
```

### Trigger genérica
```sql
CREATE OR REPLACE FUNCTION audit_table_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role text := current_setting('request.jwt.claim.role', true);
  v_func text := current_setting('request.headers.x-edge-function', true);
  v_org uuid;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_org := COALESCE(NEW.organization_id, OLD.organization_id);
  INSERT INTO audit_log (table_name, operation, row_id, organization_id, actor_role, actor_function, changes)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id::text, OLD.id::text),
    v_org,
    v_role,
    v_func,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Aplicar em tabelas críticas
CREATE TRIGGER audit_leads AFTER INSERT OR UPDATE OR DELETE ON leads FOR EACH ROW EXECUTE FUNCTION audit_table_change();
-- idem conversations, pending_ai_actions, workflow_executions
```

**Trade-off:** trigger síncrona adiciona latência (~1-3ms por write). Aceitável em hot tables com volume atual (1500/dia execuções, 256 ações). Se virar gargalo, mover pra `pg_notify` + worker async.

## REQ-O2.1 — Página `/master/automation-health`

Layout:
```
┌─────────────────────────────────────────────┐
│ Automation Health                  [Refresh]│
├─────────────────────────────────────────────┤
│ ⚠ 64 dead_letter pending (top: update_pipeline_stage 63)│
│ 🔴 3 workflows fail_rate > 50% (Basic4u Inicial)│
│ ⏰ 6 AI actions órfãs > 24h                  │
│ 🚫 2 webhooks circuit-broken                │
├─────────────────────────────────────────────┤
│ [Tabs: Dead-Letter | Workflows | Actions | Webhooks | Audit]│
└─────────────────────────────────────────────┘
```

Cada tab é uma TanStack Query com filtros. Botão reprocess invoca edge function dedicada por tipo.

## REQ-O2.2 — Latência + tokens

Patch `_shared/logger.ts`:
```ts
export interface LogRuntimeInput {
  // ... existente
  durationMs?: number;
  tokens?: { prompt: number; completion: number; model?: string };
}
```

Patch agent-engine.ts em cada chamada LLM:
```ts
const t0 = Date.now();
const response = await this.openRouter.chat({ ... });
const usage = response.usage; // OpenRouter retorna prompt_tokens, completion_tokens
await logRuntime({
  module: 'copilot', action: 'llm_call', status: 'success',
  durationMs: Date.now() - t0,
  tokens: { prompt: usage?.prompt_tokens ?? 0, completion: usage?.completion_tokens ?? 0, model: usage?.model },
  payloadSnapshot: { agent_id, lead_id },
});
```

Migration adiciona colunas opcionais em runtime_logs:
```sql
ALTER TABLE runtime_logs ADD COLUMN IF NOT EXISTS duration_ms int;
ALTER TABLE runtime_logs ADD COLUMN IF NOT EXISTS prompt_tokens int;
ALTER TABLE runtime_logs ADD COLUMN IF NOT EXISTS completion_tokens int;
ALTER TABLE runtime_logs ADD COLUMN IF NOT EXISTS llm_model text;
CREATE INDEX idx_runtime_logs_module_action_time ON runtime_logs (module, action, created_at DESC);
```

## REQ-O2.3 — Aba "Erros" em automações

Hook:
```ts
const { data } = useQuery({
  queryKey: ['workflow_errors', orgId],
  queryFn: async () => supabase
    .from('workflow_executions')
    .select('id, workflow:workflows(name), lead_id, error, started_at, completed_at, current_node_id, workflow_execution_steps!inner(node_label, error)')
    .eq('organization_id', orgId)
    .eq('status', 'failed')
    .gte('started_at', dayjs().subtract(7, 'day').toISOString())
    .order('started_at', { ascending: false })
    .limit(100),
});
```

UI: tabela com expand pra ver step error completo + botão "retry" que chama edge function `retry-workflow-execution` (re-claim).

## REQ-O2.4 — Auto-disable webhook + alert

Patch `process-webhook-deliveries`:
```ts
if (delivery.attempt >= MAX && webhook.consecutive_failures >= 10) {
  await supabase.from('webhooks').update({ is_active: false }).eq('id', webhook.id);
  await supabase.from('system_alerts').insert({
    organization_id: webhook.organization_id,
    severity: 'critical',
    category: 'webhook_circuit_breaker',
    source_type: 'webhook',
    source_id: webhook.id,
    title: 'Webhook desativado por falhas consecutivas',
    message: `${webhook.name} (${webhook.url}) atingiu 10 falhas e foi desativado.`,
    metadata: { url: webhook.url, last_error: delivery.last_error },
  });
}
```

Component banner em `/configuracoes/webhooks`:
```tsx
const { data: alerts } = useSystemAlerts({ category: 'webhook_circuit_breaker', resolved: false });
{alerts.map(a => <AlertBanner severity="critical" {...a} />)}
```

## REQ-O2.5 — Audit log

Trigger genérica acima. Frontend visualiza via tab "Audit" no master health.

Filter UI:
- Range date
- Table
- Operation
- Org

Query:
```ts
supabase.from('audit_log')
  .select('*')
  .eq('table_name', selectedTable)
  .gte('occurred_at', range.from)
  .lte('occurred_at', range.to)
  .order('occurred_at', { ascending: false })
  .limit(100);
```

## Plano de rollout

```
Fase A (DB): migrations system_alerts + audit_log + triggers
Fase B (logger): patch _shared/logger.ts + migrations runtime_logs
Fase C (callers): patches em agent-engine + process-ai-actions + workflow-executor
Fase D (alerts): patch process-webhook-deliveries + auto-disable
Fase E (frontend): páginas + hooks
Fase F (validação): 7 dias dev → prod
```

## Testes

- pgTAP: trigger audit registra mutation com role correto
- Vitest: hook useAutomationHealth retorna shape esperado
- Playwright: fluxo "ver erro de workflow → retry" end-to-end
