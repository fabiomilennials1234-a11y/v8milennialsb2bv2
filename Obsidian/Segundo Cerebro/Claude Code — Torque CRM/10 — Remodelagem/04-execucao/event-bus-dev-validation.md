# Event-bus — validação dev (2026-05-28)

**Branch:** `chore/event-bus-dev-validation` (a partir de `develop`)
**Slice 19 base:** `5afabe5b` (confirmado em `develop`)
**Project DEV:** `bcfadphgsibjzivtbjvc`
**Project PROD:** `jsjsmuncfkbsbzqzqhfq` — **ZERO MUTAÇÃO**

## Autorização CTO

CTO autorizou explicitamente na sessão de 2026-05-28 os 4 itens:
- Apply migration domain_events em DEV
- Deploy edge function `event-dispatcher` em DEV
- Popular `cron_config` DEV
- Ativar cron schedule em DEV

## Setup aplicado (DEV)

| Item | Status | Evidência |
|------|--------|-----------|
| Migration `20261105000000_domain_events.sql` | ✅ | `select count(*) from public.domain_events` → 0; 2 policies (`domain_events_select`, `domain_events_insert`) |
| Edge function `event-dispatcher` | ✅ | script size 512.3kB; `OPTIONS` → 200; `POST` sem secret → 401 (`{"error":"Unauthorized"}`) |
| `cron_config` (`event_dispatcher_url`) | ✅ | INSERT `https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/event-dispatcher` |
| `cron_secret` reuse | ✅ | Reutilizado secret pré-existente em `cron_config` (consistência com demais jobs DEV) |
| `CRON_SECRET` edge env | ✅ | `supabase secrets set CRON_SECRET=<valor>` em DEV (hash sha256 confirmado em `secrets list`) |
| Cron schedule `event-dispatcher-dev` | ✅ | `jobid=31`, `schedule='* * * * *'`, `active=true` |

## Smoke E2E

### Manual invoke (sem evento pending)

```
POST event-dispatcher (com x-cron-secret)
→ {"scanned":0,"dispatched":0,"failed":0,"errors":[],"durationMs":660}
```

### INSERT manual + dispatch

```
domain_events row inserted (org QA Test, lead.stage_changed, status=pending)
  id = a06957ee-b7a1-4ca7-9873-16d7a5588f47
  payload = { lead_id, pipeline_id, old=novo, new=abordado, pipeline_slug=whatsapp }

POST event-dispatcher → {"scanned":1,"dispatched":1,"failed":0,"durationMs":1238}

Row re-check:
  status      = "dispatched"
  attempts    = 1
  dispatched_at populado
  last_error  = null
```

✅ Loop publish → consume → mark dispatched validado em ~11s.

### Fan-out workflow_executions

QA Test Org (`00000000-0000-0000-0000-000000000001`) tem `0` workflows ativos. Handler `lead-stage-changed` executou sem erro mas sem fan-out (esperado — `fireTrigger` é no-op quando não há workflow com `trigger_type='stage_changed'` na org).

Fan-out concreto (criar `workflow_executions`) será observado em produção real após Fase 5, ou via teste com org que tenha workflows compatíveis. Não testado nesta fase pra evitar poluir dados.

### Publish via UI (campanha move stage)

**Path equivalente validado programaticamente:** `src/modules/campaigns/hooks/useCampanhas.ts:823` chama `publishEvent` que executa INSERT em `domain_events` com `aggregate_type='campanha_lead'`. O INSERT manual feito acima exercita exatamente o mesmo path consumido pelo dispatcher (mesma tabela, mesma RLS, mesmo handler `lead.stage_changed`). UI test ativo pulado pra evitar mutações em dados reais DEV.

Validação via UI fica como verificação manual opcional antes da Fase 5.

## Monitoria 24h

**Início:** 2026-05-28 ~16:30 UTC
**Próxima checagem:** 2026-05-29 ~16:30 UTC (agendada via ScheduleWakeup)

Queries a executar em 24h:

```sql
-- Distribuição por status
SELECT status, count(*)
FROM public.domain_events
WHERE published_at > now() - interval '24 hours'
GROUP BY status;
-- Esperado: pending=0, dispatched=N, failed=0

-- Erros se houver
SELECT event_type, last_error, count(*)
FROM public.domain_events
WHERE status = 'failed' AND published_at > now() - interval '24 hours'
GROUP BY event_type, last_error;
```

## Riscos detectados

Nenhum durante setup. Reuso de `cron_secret` existente (em vez de gerar novo, como sugeriu o roadmap original) reduz divergência com demais jobs DEV — decisão pragmática registrada aqui.

## Conclusão final

✅ Setup completo em DEV. Smoke loop pub→consume→mark green.

**Monitoria 24h pulada por decisão CTO em 2026-05-28 ~19:30 UTC.** Evidência aceita como suficiente:

- 120 cron runs `succeeded` consecutivos nas últimas 2h (100% green)
- 0 events `failed` desde setup
- 1 event smoke E2E `dispatched` em ~11s
- 0 anomalias em `cron.job_run_details`

Sinal estatístico não é equivalente a 24h verdes (1440 runs vs 120), mas demonstra cron + dispatcher + handler estáveis no eixo conhecido. Risco residual aceito pelo CTO.

**Fase 5 (deploy prod) habilitada.**

## Runbook — checkpoint 2026-05-29 ~16:30 UTC

**Atualização pós-Fase-4 merge (PR #528, 2026-05-28 17:06 UTC):** Fase 4 cortada com smoke programático aceito pelo CTO (pub→consume→mark ~11s + 13 cron runs verdes). Fase 5 (deploy prod) **continua bloqueada** pela monitoria 24h aqui descrita.

**Execução manual** (D do menu de opções — rotina remota descartada por falta de GitHub App + secret management Anthropic Cloud):

### Passo 1 — sincronizar repo

```bash
cd C:\Users\torch\Desktop\milennials\v8milennialsb2bv2
git fetch origin
git checkout chore/event-bus-dev-validation
git pull --ff-only
```

### Passo 2 — queries de monitoria

```bash
DEV_REF="bcfadphgsibjzivtbjvc"  # NUNCA usar jsjsmuncfkbsbzqzqhfq aqui
TOKEN=$(grep -E "^SUPABASE_ACCESS_TOKEN=sbp_" .env.development | tail -1 | cut -d= -f2)

# Distribuição por status nas últimas 24h
curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select status, count(*) from public.domain_events where published_at > now() - interval $$24 hours$$ group by status"}'

# Erros se houver
curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select event_type, last_error, count(*) from public.domain_events where status = $$failed$$ and published_at > now() - interval $$24 hours$$ group by event_type, last_error"}'

# Sanidade do cron
curl -s -X POST "https://api.supabase.com/v1/projects/${DEV_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "User-Agent: claude-cli/1.0" \
  -d '{"query":"select status, count(*) from cron.job_run_details where jobid = 31 and start_time > now() - interval $$24 hours$$ group by status"}'
```

### Passo 3A — caso verde (`failed=0`)

1. Atualizar este doc seção **Monitoria 24h** com counts finais (`pending=0, dispatched=N, failed=0`).
2. Atualizar conclusão pra: `✅ Pronto para Fase 5 (deploy prod)`.
3. Commit + push:
   ```bash
   git add "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/event-bus-dev-validation.md"
   git commit -m "docs(event-bus): monitoria 24h verde, pronto para Fase 5"
   git push
   ```
4. Marcar PR pronto: `gh pr ready 527`
5. Mergear em develop → habilita Fase 5.

### Passo 3B — caso vermelho (`failed > 0`)

1. **NÃO** marcar PR ready.
2. Atualizar doc com snapshot dos `last_error` por `event_type`.
3. Commit + push:
   ```bash
   git commit -m "docs(event-bus): monitoria 24h — N erros, bloqueio Fase 5"
   git push
   ```
4. Comentar no PR #527 com o snapshot.
5. **Bloquear Fase 5** até root cause identificado.
6. Triage: cron succeeded + dispatcher error? → bug no handler. Cron failed? → infra (rate limit, edge function down, secret expirado).

### Constraints invariantes — não negociável

- ✅ Zero push em `main`
- ✅ Zero mutação em prod DB (`jsjsmuncfkbsbzqzqhfq`)
- ✅ Project ref alvo = `bcfadphgsibjzivtbjvc` (DEV) — confirmar antes de cada curl
- ✅ Sem `--no-verify`

## Monitoria — snapshot final (2026-05-28 ~19:30 UTC)

Monitoria 24h **pulada por decisão CTO**. Snapshot do estado em ~3h pós-setup capturado abaixo:

```
domain_events
-------------
status     | count
-----------+-------
dispatched | 1
failed     | 0
pending    | 0

cron.job_run_details (jobid=31, últimas 2h)
-------------------------------------------
status    | count
----------+-------
succeeded | 120
failed    | 0
```

**Aceito como suficiente pra habilitar Fase 5 deploy prod.**

## Risco residual + mitigação Fase 5

Como monitoria foi pulada, **Fase 5 deploy prod precisa intensificar monitoria pós-deploy** pra cobrir o gap:

- Monitoria 60min ativa pós-cutover Fase 5 (vs 5min planejado)
- Query SQL de status executada a cada 15min nas primeiras 2h
- Sentry capture explícito no `publishEvent.catch` antes do deploy (1 linha, ~5min)
- Rollback plan documentado (drop table + unschedule cron + delete edge fn) com tempo alvo ≤ 5min execução
