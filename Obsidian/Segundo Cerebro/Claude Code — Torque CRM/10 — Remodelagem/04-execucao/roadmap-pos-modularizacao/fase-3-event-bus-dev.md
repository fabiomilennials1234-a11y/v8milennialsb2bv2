# Fase 3 — Validar event-bus end-to-end em dev

**Branch:** `chore/event-bus-dev-validation` (caso precise commitar fixes encontrados)
**Base:** `develop`
**Target PR:** `develop` (se houver fixes)
**Estimate:** 2h (sessão) + 24h monitoria passiva
**Pré-requisitos:** Slice 19 (event-bus piloto) já mergeada — confirmar via `git log origin/develop | grep "slice 19"`.
**Habilita:** Fase 4 (limpeza)

## Constraints invariantes (NÃO violar)

1. Zero push em `main`. Zero merge em `main`.
2. **Zero mutação em prod DB** (`jsjsmuncfkbsbzqzqhfq`). NUNCA.
3. **Dev DB** (`bcfadphgsibjzivtbjvc`) e **dev edge functions** — permitidos **apenas com autorização explícita do CTO na sessão**. Default = pedir antes.
4. Branch nova pra qualquer commit. PR target = `develop`.
5. Sem `--no-verify`.
6. Antes de começar: `git checkout develop && git pull --ff-only origin develop`. Confirmar slice 19 presente.

## Contexto

Slice 19 deixou pronto:
- Migration `supabase/migrations/20261105000000_domain_events.sql` (NÃO aplicada).
- Módulo `supabase/functions/_shared/events/` (`types`, `publish`, `dispatch`, `registry`, `handlers/lead-stage-changed`).
- Edge function `supabase/functions/event-dispatcher/index.ts` (NÃO deployada).
- Wrapper client `src/integrations/supabase/events.ts` com `publishEvent(...)`.
- 1 call site migrado: `src/modules/campaigns/hooks/useCampanhas.ts:823`.

Nada está rodando em ambiente algum. Esta fase valida a stack inteira **em dev**.

## Pedir autorização ao CTO antes de prosseguir

Mensagem mínima ao CTO:

```
Fase 3 do roadmap pos-modularizacao precisa autorizacao explicita:
1. Aplicar migration 20261105000000_domain_events.sql no projeto DEV (bcfadphgsibjzivtbjvc) — adiciona tabela domain_events.
2. Deploy edge function event-dispatcher em DEV.
3. Popular cron_config em DEV: event_dispatcher_url + cron_secret.
4. Ativar cron schedule * * * * * em DEV.

Tudo reversível (drop tabela + delete edge function + unschedule cron).
Zero impacto em prod (jsjsmuncfkbsbzqzqhfq).
Autoriza?
```

Se CTO não autorizar, **PARAR** e documentar como bloqueio.

## Tarefas (após autorização)

### 1. Aplicar migration em dev

Via Supabase Management API (token dev em `.env.development` linha `SUPABASE_ACCESS_TOKEN`).

```bash
# Carregar token
TOKEN=$(grep -E "^SUPABASE_ACCESS_TOKEN=sbp_" .env.development | tail -1 | cut -d= -f2)
DEV_REF="bcfadphgsibjzivtbjvc"

# Confirmar token
echo "Token: ${TOKEN:0:10}..."

# Aplicar migration via API
MIGRATION=$(cat supabase/migrations/20261105000000_domain_events.sql)

curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d "$(jq -n --arg q "$MIGRATION" '{query: $q}')"

# Verificar tabela criada
curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select count(*) from domain_events"}'
```

Esperado: `[{"count":0}]`.

### 2. Deploy edge function `event-dispatcher` em dev

```bash
supabase functions deploy event-dispatcher --project-ref ${DEV_REF}
```

Confirmar:

```bash
curl -s -X OPTIONS "https://${DEV_REF}.supabase.co/functions/v1/event-dispatcher"
# Expect 200 / 204 / CORS headers
```

### 3. Popular `cron_config` em dev

```bash
DEV_DISPATCHER_URL="https://${DEV_REF}.supabase.co/functions/v1/event-dispatcher"
DEV_CRON_SECRET=$(openssl rand -hex 32)

curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d "$(jq -n --arg url "$DEV_DISPATCHER_URL" --arg secret "$DEV_CRON_SECRET" '{
    query: "insert into cron_config (key, value) values (\($url|tojson|fromjson|tostring|@json), \($url|tojson)), (\(\"cron_secret\"|@json), \($secret|@json)) on conflict (key) do update set value = excluded.value"
  }')"
```

Validação mais simples (SQL direto via Management API):

```sql
INSERT INTO cron_config (key, value) VALUES
  ('event_dispatcher_url', 'https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/event-dispatcher'),
  ('cron_secret', '<gerado-acima>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Configurar `event-dispatcher` em dev pra usar mesmo `CRON_SECRET` via env var na edge function:

```bash
supabase secrets set CRON_SECRET="${DEV_CRON_SECRET}" --project-ref ${DEV_REF}
```

### 4. Ativar cron em dev

```sql
SELECT cron.schedule(
  'event-dispatcher-dev',
  '* * * * *',
  $$ SELECT net.http_post(
       url := (SELECT value FROM cron_config WHERE key = 'event_dispatcher_url'),
       headers := jsonb_build_object('x-cron-secret', (SELECT value FROM cron_config WHERE key = 'cron_secret')),
       body := '{}'::jsonb
     ) $$
);
```

Confirmar:

```sql
SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'event-dispatcher-dev';
```

### 5. Validar pipeline end-to-end (smoke)

Usar uma org de testes em dev (não tocar dados reais).

```sql
-- Pegar uma org de testes em dev
SELECT id, name FROM organizations LIMIT 5;
-- Pegar um lead nessa org
SELECT id, name FROM leads WHERE organization_id = '<org-id>' LIMIT 5;
```

Provocar evento manualmente via SQL (não via UI):

```sql
INSERT INTO domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload, status)
VALUES (
  '<org-id>',
  'lead.stage_changed',
  'pipeline_entry',
  gen_random_uuid(),
  jsonb_build_object(
    'lead_id', '<lead-id>',
    'pipeline_id', '<pipeline-id>',
    'old_stage_key', 'novo',
    'new_stage_key', 'abordado',
    'pipeline_slug', 'whatsapp'
  ),
  'pending'
);
```

Aguardar 1-2 min (cron a cada minuto). Verificar:

```sql
SELECT id, event_type, status, dispatched_at, last_error
FROM domain_events
WHERE event_type = 'lead.stage_changed'
ORDER BY published_at DESC
LIMIT 5;
```

Esperado: `status='dispatched'`, `dispatched_at` populado, `last_error` null.

Verificar fan-out (workflow_executions criado se houver workflow listening):

```sql
SELECT id, workflow_id, status, created_at
FROM workflow_executions
WHERE lead_id = '<lead-id>'
ORDER BY created_at DESC
LIMIT 5;
```

### 6. Testar publish do client (frontend) em dev

Localmente:

```bash
# Garantir VITE_SUPABASE_URL aponta pra dev
grep VITE_SUPABASE_URL .env.development
# Esperado: https://bcfadphgsibjzivtbjvc.supabase.co

npm run dev
# Em localhost:8080:
# 1. Login com user master ou admin dev.
# 2. Navegar pra Campanhas.
# 3. Mover lead entre stages numa campanha (chama o caminho de useCampanhas:823).
# 4. Voltar ao SQL e checar domain_events recebeu novo evento.
```

### 7. Monitoria de 24h

Setar lembrete pra verificar daqui a 24h:

```sql
-- Run after 24h
SELECT status, count(*)
FROM domain_events
WHERE published_at > now() - interval '24 hours'
GROUP BY status;

-- Esperado: pending: 0 (todos processados), dispatched: N, failed: 0

SELECT event_type, last_error, count(*)
FROM domain_events
WHERE status = 'failed' AND published_at > now() - interval '24 hours'
GROUP BY event_type, last_error;
```

Se `failed > 0`, investigar `last_error` antes de prosseguir pra Fase 5.

### 8. Documentar resultado da validação

Criar `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-dev-validation.md`:

```markdown
# Event-bus — validação dev (<data>)

## Setup aplicado

- Migration aplicada em dev: ✅
- Edge function deployada em dev: ✅
- cron_config populado: ✅
- Cron ativo (`* * * * *`): ✅

## Smoke

- INSERT manual de domain_event → dispatched em <X> segundos: ✅
- Workflow_executions criado conforme regras: ✅ / ⚠️ (anotar)
- Publish via UI (campanha move stage) → evento publicado e processado: ✅

## Monitoria 24h

- domain_events: pending=0, dispatched=<N>, failed=<M>
- Erros encontrados (se M>0): <listar last_error>

## Conclusão

✅ Pronto para Fase 5 (deploy prod) / ❌ Bloqueios identificados:
- (listar)
```

Commitar este doc em branch `chore/event-bus-dev-validation` se houver fixes a aplicar; senão, commit só do doc.

## Critério de aceite

- [ ] CTO autorizou os 4 itens (migration dev + deploy dev + cron_config dev + cron schedule dev).
- [ ] Migration aplicada em dev — tabela `domain_events` existe.
- [ ] `event-dispatcher` deployada em dev — endpoint responde.
- [ ] `cron_config` populado em dev.
- [ ] Cron ativo em dev (`* * * * *`).
- [ ] Smoke manual: INSERT direto + UI campanha publish → ambos vão para `status='dispatched'`.
- [ ] Monitoria 24h verde (`failed=0` OU casos de falha investigados e documentados).
- [ ] Doc de validação criado no vault.

## Riscos + mitigação

- **Aplicar migration em prod por engano.** Mitigação: SEMPRE checar project ref antes de cada curl/supabase command. `echo "Aplicando em: ${DEV_REF}"` antes de cada operação. NUNCA usar `${PROD_REF}` (`jsjsmuncfkbsbzqzqhfq`) nesta fase.
- **Edge function falha por env var faltando.** Mitigação: confirmar `supabase secrets list --project-ref ${DEV_REF}` mostra `CRON_SECRET` antes do schedule.
- **Cron dev compete com cron prod por horário.** Não compete — projetos isolados.
- **Workflow_executions duplicadas** se handler for chamado duas vezes. Mitigação: handler deve ser idempotente — verificar com tests da slice 19.

## Out of scope

- Aplicar em prod (Fase 5).
- Migrar outros call sites (`message.received`, `lead.created`, etc) — projeto separado pós-modularização.
- Refactor do handler `lead-stage-changed` — só validar.

## Próximo passo

Após 24h verde em dev: Fase 4 (limpeza) + Fase 5 (deploy prod).
