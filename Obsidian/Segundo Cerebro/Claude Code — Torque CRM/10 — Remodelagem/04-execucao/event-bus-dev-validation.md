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

## Conclusão preliminar

✅ Setup completo em DEV. Smoke loop pub→consume→mark green.
⏳ Aguardando 24h de monitoria passiva pra concluir Fase 3 e habilitar Fase 4.

## Próximo passo

- 2026-05-29: executar queries de monitoria, atualizar este doc com counts finais, commit final na branch `chore/event-bus-dev-validation`.
- Se monitoria verde: Fase 4 (limpeza) habilitada.
- Se `failed > 0`: investigar `last_error`, bloquear Fase 5 até resolver.
