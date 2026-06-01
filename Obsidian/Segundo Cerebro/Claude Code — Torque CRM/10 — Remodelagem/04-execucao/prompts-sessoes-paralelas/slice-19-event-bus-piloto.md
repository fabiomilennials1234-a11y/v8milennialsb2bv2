# Slice 19 — Event-bus piloto

**Branch:** `feat/modularizacao/19-event-bus-piloto`
**Base:** `develop` (com PR #512 já mergeada)
**Target PR:** `develop`
**Estimate:** 8h
**Pode rodar em paralelo com:** Slice 17 (docs + ESLint flip)

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB (`jsjsmuncfkbsbzqzqhfq`).
3. **Migrations aplicáveis APENAS em dev** project ref `bcfadphgsibjzivtbjvc`, e SOMENTE com pedido explícito do CTO na sessão.
4. Zero deploy edge function em prod. Deploy em dev permitido apenas com pedido explícito do CTO.
5. Branch sai de `develop` atualizada. PR target = `develop`.
6. Sem `--no-verify`. Sem skip de hooks.
7. Antes de começar: `git pull origin develop` — garantir PR #512 já mergeada.

## Contexto

Detalhe do plano: [`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/modularizacao/event-bus-plano.md`](../../../06%20—%20Features/modularizacao/event-bus-plano.md).

Backlog do bug correlato: [`Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`](../../../08%20—%20Backlog/backlog/triggerStageChangedWorkflows-duplicate.md).

**Objetivo**: validar padrão pub/sub interno (single DB-backed event-bus) com 1 evento piloto (`lead.stage_changed`). Hoje `triggerStageChangedWorkflows` é chamado em **3 call sites** (`useUpdatePipeProposta`, `useUpdatePipeConfirmacao`, `useUpdatePipeWhatsapp`) — fan-out manual via import direto, anti-pattern modular. Substituir por: cada call site faz **1 publish**, edge function `event-dispatcher` consume e fan-out handlers.

Expansão pra outros 5+ eventos (`message.received/sent`, `lead.created`, `campaign.dispatched`, `workflow.step_executed`) é projeto separado pós-modularização. Esta slice valida o **padrão** + fecha 1 bug.

## Tarefas

### 1. Sincronizar branch

```bash
git checkout develop
git pull origin develop
git log --oneline -5 | grep "slice 16"  # confirmar #512 merged
git checkout -b feat/modularizacao/19-event-bus-piloto
```

### 2. Migration: tabela `domain_events`

Criar arquivo `supabase/migrations/<timestamp>_domain_events.sql`.

Schema:

```sql
CREATE TABLE public.domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,  -- 'lead', 'pipeline_entry', 'message', etc
  aggregate_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',  -- pending | dispatched | failed
  published_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_events_status_check CHECK (status IN ('pending','dispatched','failed'))
);

CREATE INDEX idx_domain_events_pending ON domain_events (organization_id, status, published_at)
  WHERE status = 'pending';
CREATE INDEX idx_domain_events_type ON domain_events (event_type, published_at DESC);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY domain_events_select ON domain_events FOR SELECT
  USING ((organization_id IN (SELECT get_my_organization_ids())) OR is_master_user());

CREATE POLICY domain_events_insert ON domain_events FOR INSERT
  WITH CHECK ((organization_id IN (SELECT get_my_organization_ids())) OR is_master_user());

-- Service role bypass via grants já existentes.
```

**NÃO aplicar em prod**. Aplicar em dev apenas com autorização explícita do CTO na sessão, via `supabase db push` com `--linked` apontando pra dev ref, ou via Management API com dev token.

### 3. Módulo `_shared/events/`

Criar diretório `supabase/functions/_shared/events/` com:

- `types.ts` — tipos TypeScript dos eventos suportados:

```ts
export type DomainEvent =
  | LeadStageChangedEvent
  // futuros: LeadCreatedEvent | MessageReceivedEvent | ...

export interface LeadStageChangedEvent {
  event_type: "lead.stage_changed";
  aggregate_type: "pipeline_entry";
  aggregate_id: string;  // pipeline_entries.id
  organization_id: string;
  payload: {
    lead_id: string;
    pipeline_id: string;
    old_stage_key: string | null;
    new_stage_key: string;
    pipeline_slug: string;
  };
  metadata?: Record<string, unknown>;
}
```

- `publish.ts` — função `publishEvent(event: DomainEvent): Promise<string>` que insere em `domain_events` via service-role client.

- `registry.ts` — registry de handlers por event_type:

```ts
export const handlers: Record<string, (event: DomainEvent) => Promise<void>> = {
  "lead.stage_changed": handleLeadStageChanged,
};
```

- `dispatch.ts` — orquestrador que busca pending events, chama handler por event_type, marca dispatched ou failed com last_error.

- `index.ts` — barrel re-exporting tudo.

### 4. Edge function `event-dispatcher` (cron 1/min)

Criar `supabase/functions/event-dispatcher/index.ts`:

```ts
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders, getCorsHeaders } from "../_shared/security-headers.ts";
import { dispatchPending } from "../_shared/events/dispatch.ts";

const handler = async (req: Request) => {
  // OPTIONS early return
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  // x-cron-secret auth
  const secret = Deno.env.get("CRON_SECRET");
  if (req.headers.get("x-cron-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const result = await dispatchPending({ batchSize: 50 });
  return new Response(JSON.stringify(result), {
    headers: { ...getCorsHeaders(req), "content-type": "application/json" },
  });
};

Deno.serve(withSentry("event-dispatcher", withSecurityHeaders(getCorsHeaders)(handler)));
```

Adicionar entrada em `supabase/config.toml` com `verify_jwt = false`.

### 5. Cron job (em dev migration, NÃO em prod)

```sql
SELECT cron.schedule(
  'event-dispatcher',
  '* * * * *',
  $$ SELECT net.http_post(
       url := (SELECT value FROM cron_config WHERE key = 'event_dispatcher_url'),
       headers := jsonb_build_object('x-cron-secret', (SELECT value FROM cron_config WHERE key = 'cron_secret')),
       body := '{}'::jsonb
     ) $$
);
```

Entradas em `cron_config` populadas apenas em dev. **NÃO** rodar em prod sem ordem.

### 6. Handler piloto: `lead.stage_changed`

Criar `supabase/functions/_shared/events/handlers/lead-stage-changed.ts`:

- Recebe `LeadStageChangedEvent`.
- Faz exatamente o que `triggerStageChangedWorkflows` faz hoje: busca workflows com trigger `stage_changed` matching o pipe + stage, enfileira execuções em `workflow_executions`.
- Reaproveitar lógica existente em `_shared/workflow-trigger.ts` ou similar — não duplicar.

### 7. Migrar 3 call sites para publish

Localizar:

```bash
grep -rln "triggerStageChangedWorkflows" src/
```

Esperados: `src/modules/pipelines/hooks/usePipePropostas.ts`, `usePipeConfirmacao.ts`, `usePipeWhatsapp.ts` (ou paths equivalentes pós-cleanup).

Em cada um, substituir a chamada direta por:

```ts
import { publishEvent } from "@/integrations/supabase/events";  // criar wrapper client-side leve

await publishEvent({
  event_type: "lead.stage_changed",
  aggregate_type: "pipeline_entry",
  aggregate_id: entry.id,
  organization_id: entry.organization_id,
  payload: {
    lead_id: entry.lead_id,
    pipeline_id: entry.pipeline_id,
    old_stage_key: previous.stage_key,
    new_stage_key: entry.stage_key,
    pipeline_slug: pipelineSlug,
  },
});
```

O wrapper client-side faz `supabase.from('domain_events').insert(...)`. Não chama o dispatcher direto — o cron pega.

Manter a chamada antiga **comentada** com TODO de remoção quando dispatcher estiver verde por 2 semanas em prod. Não remover ainda.

### 8. Tests unitários

Criar:

- `tests/unit/events-publish.test.ts` — testa que `publishEvent` insere row.
- `tests/unit/events-dispatch.test.ts` — testa que `dispatchPending` chama handler certo + atualiza status.
- `tests/unit/handler-lead-stage-changed.test.ts` — testa que handler enfileira workflow_execution.

Mockar Supabase client. Não tocar DB real.

### 9. Build + lint local

```bash
npm run build 2>&1 | tail -20
npm run lint 2>&1 | tail -10
npm run test:unit -- events 2>&1 | tail -20
```

### 10. Commit + push + PR

```bash
git add -A
git status --short | grep -i "feature-overview" && echo "PARAR — vault file não pode entrar"
git commit -m "feat(modularizacao): slice 19 — event-bus piloto (lead.stage_changed)

Cria infra de pub/sub interno DB-backed para desacoplar módulos. Tabela
domain_events + _shared/events/{types,publish,dispatch,registry,handlers} +
edge function event-dispatcher (cron 1/min) + migração piloto de
lead.stage_changed (3 call sites manuais → 1 publish + 1 handler).

Fecha backlog triggerStageChangedWorkflows-duplicate.md (ainda não removido o
fan-out manual — comentado com TODO de remoção após 2 semanas verde em prod).

Migration domain_events NÃO aplicada em prod nesta slice. Apenas commitada.
Aplicação fica pra deploy coordenado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin feat/modularizacao/19-event-bus-piloto
gh pr create --base develop --head feat/modularizacao/19-event-bus-piloto --title "feat(modularizacao): slice 19 — event-bus piloto (lead.stage_changed)" --body "<resumo>"
```

## Critério de aceite

- [ ] Migration `domain_events` criada e versionada (NÃO aplicada em prod).
- [ ] `_shared/events/` populado (types + publish + registry + dispatch + handlers/lead-stage-changed).
- [ ] Edge function `event-dispatcher` criada com cron config doc-only no migration (NÃO ativada em prod).
- [ ] 3 call sites de `triggerStageChangedWorkflows` migrados para `publishEvent`.
- [ ] Chamada antiga **comentada** com TODO, não removida.
- [ ] Tests unitários novos passando.
- [ ] `npm run build` + `npm run lint` verdes.
- [ ] PR aberto contra `develop`.

## Riscos + mitigação

- **Dual-write durante migração:** call sites publicam evento E (comentado) podem rodar o trigger antigo. Mitigação: trigger antigo fica comentado, não desligado — rollback rápido se dispatcher falhar.
- **Dispatcher fica atrás (lag):** workflows que respondem a stage_changed teriam latência de até 1 minuto. Aceitável pra esta slice — documentar como trade-off conhecido.
- **`feature-overview.md` no vault não commitar.** Checar `git status` antes de cada `git add -A`.
- **Migration aplicada em prod por engano:** NUNCA rodar `supabase db push` apontando pra prod ref. Memória `feedback_never_deploy_prod.md`.

## Out of scope

- Outros eventos (`message.received`, `lead.created`, etc) — projeto separado.
- Aplicação da migration em prod — coordenação humana.
- Deploy `event-dispatcher` em prod — coordenação humana.
- Remoção do fan-out manual de workflows — aguardar 2 semanas em prod verde.
- Mudanças em sub-CLAUDE.md (slice 17 cuida).
