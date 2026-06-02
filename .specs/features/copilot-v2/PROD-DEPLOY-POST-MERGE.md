# Copilot v2 — Deploy em PROD pós-merge (`main`)

> **Escopo:** migrations + edge functions a aplicar/deployar em produção (`jsjsmuncfkbsbzqzqhfq`) assim que os PRs **#677 (1-H)** e **#<0-C>** forem mergeados em `main` e o frontend for promovido.
> **Status:** ⛔ **NADA aplicado em prod.** Prod exige autorização explícita do CTO (regra do projeto). Este doc é o checklist para esse momento.

---

## 0. Pré-condição (verificar ANTES)

O runtime copilot-v2 já está **vivo em prod (inerte)** → a fundação **já deve estar em prod**:

| Migration (fundação, já em prod) | Cria |
|---|---|
| `20260531174908_copilot_v2_foundation` | tabelas `copilot_v2_message_queue`, `copilot_v2_dlq`, `copilot_v2_config` + RPCs `enqueue`/`acquire_dedup_lock`/`check_human_pause` |
| `20260531214954_copilot_v2_slices_4_6_7_tables` | tabelas das slices 4/6/7 |
| `20260601015114_copilot_v2_queue_claim_rpcs` | RPCs `copilot_v2_claim_messages` / `copilot_v2_fail_message` (versão original) |
| `20260601020907_schedule_copilot_v2_worker` | cron pg_cron do worker |

⚠️ Se a fundação **NÃO** estiver em prod, as migrations do 1-H falham com
`type "public.copilot_v2_message_queue" does not exist` — foi exatamente o que ocorreu no **dev** (drift: 28+ migrations não-aplicadas). Confirmar a fundação antes de aplicar o 1-H.

Verificação rápida (Management API, ref prod):
```sql
select to_regclass('public.copilot_v2_message_queue') as queue,
       proname from pg_proc where proname in ('copilot_v2_claim_messages','copilot_v2_fail_message');
```

---

## 1. Migrations a aplicar — 1-H (PR #677), NA ORDEM

| Ordem | Arquivo | O que faz | Depende de |
|---|---|---|---|
| **1º** | `20260602151330_copilot_v2_claim_attempts_reaper.sql` | `attempts++` move de **claim → fail** (crash transitório não queima retry); + `copilot_v2_reap_stale_processing(p_timeout_minutes)` que devolve rows presas em `processing > timeout` para `retry`. **Recria** `claim_messages`/`fail_message` (supersede 015114, imutável). | fundação + `20260601015114` |
| **2º** | `20260602151331_schedule_copilot_v2_reaper.sql` | cron pg_cron `copilot_v2_reaper` (1/min) → `SELECT public.copilot_v2_reap_stale_processing(5)`. | migration 1º (a função reaper precisa existir) |

⚠️ **Ordem obrigatória**: a 2ª agenda um cron que chama a função criada na 1ª. Aplicar fora de ordem deixa um cron quebrado (erro 1/min). Ambas são idempotentes (`create or replace` + `unschedule`-if-exists).

> **0-C (PR #<0-C>): SEM migrations.** A coluna `organizations.copilot_engine_version` **permanece** (drop fora de escopo). Só código morto + UI removidos.

---

## 2. Método de apply em prod

**NUNCA** `supabase db push` (prod tem drift). Usar **Management API** com o token `sbp_*`
(`SUPABASE_ACCESS_TOKEN` em `.env.development` — personal access token, account-wide, serve pra prod).
`User-Agent` header é **obrigatório** (Cloudflare 1010).

```bash
# ref PROD = jsjsmuncfkbsbzqzqhfq   (DEV = bcfadphgsibjzivtbjvc)
REF=jsjsmuncfkbsbzqzqhfq
TOKEN=<sbp_... de .env.development>
for f in 20260602151330_copilot_v2_claim_attempts_reaper 20260602151331_schedule_copilot_v2_reaper; do
  curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "User-Agent: torque-cli/1.0" \
    --data-binary @<(jq -Rs '{query: .}' "supabase/migrations/$f.sql")
done
```
(ou o helper Python equivalente que lê o arquivo e faz `json.dumps({"query": sql})`.)

---

## 3. Edge functions a redeployar em prod

Os arquivos `_shared/copilot-v2/*` são **bundlados no deploy** de quem os importa. Mudaram no 1-H:
`border.ts` (debounce + dedup atômico), `queue-processor.ts`, `cognition-worker.ts`, `capability-gate.ts`.

| Função | Por quê | Comando |
|---|---|---|
| `agent-runtime-v2` | bundla `border.ts` (coalescer de fragmentos + dedup atômico enqueue) | `supabase functions deploy agent-runtime-v2 --project-ref jsjsmuncfkbsbzqzqhfq` |
| `copilot-v2-worker` | `recordOutbound`, `checkPause` no envio, `ResolvedContext` keyed por archetype, `capsFor`→`resolveAgentCapabilities` | `supabase functions deploy copilot-v2-worker --project-ref jsjsmuncfkbsbzqzqhfq` |

**0-C** → redeploy `agent-message` (removeu read inerte da flag) + frontend (EasyPanel, removeu aba Engine do master).

---

## 4. ⚠️ Task 7 (fail-CLOSED) — efeito ao ativar v2 em prod

Após deploy do `copilot-v2-worker`, **todo agente v2 sem `slots.capabilities` setado para de escrever**
(mover stage, agendar, set tier, fill field, send media, transfer, handoff → bloqueado com `capability_off`).
Hoje o runtime está **inerte em prod** (`is_active=FALSE`, nenhuma instância Uazapi apontada) → **sem impacto imediato**.
Mas no rollout (Slice 12), **configurar `slots.capabilities.{flag}` ANTES de ativar** cada agente v2 (a UI vem na Slice 8).

---

## 5. Ordem de execução no merge→main

1. Merge `develop → main` (inclui #677 + #<0-C>).
2. Confirmar fundação em prod (§0).
3. Aplicar migrations 1-H na ordem (§1, §2).
4. Redeployar edge functions (§3).
5. Promover frontend no EasyPanel (decoupled — manual).
6. Smoke: runtime continua inerte; nenhuma escrita inesperada (Task 7 fail-closed).
