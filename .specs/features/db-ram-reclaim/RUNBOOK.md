# RUNBOOK — DB RAM Reclaim (PROD)

**Objetivo:** reclamar ~1.3–1.5 GB de RAM/cache do Postgres de PROD
(`jsjsmuncfkbsbzqzqhfq`, Small 2 GB) SEM upgrade de compute, encolhendo o
footprint físico (bloat) pra o hot set caber em `shared_buffers` (512 MB) e o
cache hit de heap subir de 92% → ~99%.

> **NÃO APLICADO.** Este runbook é executado pelo CTO em PROD com "vai" explícito.
> Nada aqui foi rodado. Medições são de PROD read-only 2026-07-13.
> DEV (`bcfadphgsibjzivtbjvc`) fora de alcance do MCP nesta sessão — validar em
> DEV/staging antes se disponível.

## Regras de execução

- `REINDEX INDEX CONCURRENTLY` e `DROP INDEX CONCURRENTLY`: **online, sem lock de
  escrita**, mas **não rodam em transação/pg_cron**. Rodar cada statement isolado
  via `psql`/`execute_sql`.
- `VACUUM FULL` e `TRUNCATE`: pegam **ACCESS EXCLUSIVE** (bloqueiam leitura E
  escrita da tabela pela duração). Rodar em **janela de baixo tráfego**
  (madrugada BRT). Rápidos aqui (tabelas ≤ 130 MB).
- Ordem = ROI decrescente × risco crescente. Pode parar a qualquer passo.
- Medir **antes e depois de cada passo** com o bloco §Medição.

---

## Passo 0 — Snapshot ANTES (rodar e guardar)

```sql
-- Tamanho por objeto-alvo
SELECT c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) total,
       pg_size_pretty(pg_relation_size(c.oid))       heap,
       pg_size_pretty(pg_indexes_size(c.oid))        idx
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('whatsapp_messages','whatsapp_health_checks','runtime_logs',
                    'audit_log','whatsapp_media_jobs','whatsapp_webhook_dlq')
ORDER BY pg_total_relation_size(c.oid) DESC;

SELECT pg_size_pretty(pg_total_relation_size('net._http_response')) pgnet;

-- Cache hit de heap (alvo ~99%)
SELECT round(100*sum(heap_blks_hit)/nullif(sum(heap_blks_hit+heap_blks_read),0),2) AS heap_cache_hit_pct
FROM pg_statio_user_tables;
```

Baseline PROD 2026-07-13 (referência):
| objeto | total | heap | idx |
|---|---|---|---|
| whatsapp_messages | 3893 MB | 1082 MB | ~1600 MB (22 idx) |
| net._http_response | 666 MB | — | — |
| audit_log | 262 MB | 125 MB | 137 MB |
| runtime_logs | 207 MB | 81 MB | 127 MB |
| whatsapp_health_checks | 148 MB | 32 MB | 116 MB |
| whatsapp_media_jobs | 123 MB | 89 MB | 34 MB |
| whatsapp_webhook_dlq | 99 MB | 48 MB (+42 MB toast) | 7 MB |

heap_cache_hit ~92%. DB total 6.6 GB = 3.3× RAM.

---

## Passo 1 — pg_net `_http_response`: ~630 MB (RISCO ~ZERO, fazer primeiro)

666 MB para **4.238 linhas** (6 h de dados, TTL já = 6 h). É 100% bloat de churn:
respostas HTTP de cron que ninguém lê (todos os `net.http_post` do projeto são
fire-and-forget). A tabela é totalmente efêmera → `TRUNCATE` reclama tudo
instantaneamente (lock sub-segundo), o worker repopula sozinho.

```sql
-- Reclama ~630 MB na hora. Seguro: respostas não são lidas por nenhum caller.
TRUNCATE net._http_response;
```

> Se `TRUNCATE` falhar por ownership (net é do supabase_admin), usar:
> `DELETE FROM net._http_response; VACUUM FULL net._http_response;`
> (o cron jobid 40 `pgnet_response_cleanup` já faz o DELETE 7d — redundante com
> o TTL de 6 h; o que falta é devolver o espaço, que só o TRUNCATE/VACUUM FULL faz.)

**Opcional (durável, avaliar):** reduzir o TTL de 6 h → 1 h mantém o steady-state
~6× menor. Mecanismo depende da versão pg_net 0.19.5 (GUC `pg_net.ttl`); validar
em staging antes — **não** é load-bearing (o TRUNCATE é o ganho). Sem isso, o
bloat volta a acumular ao longo de meses → reexecutar o TRUNCATE trimestralmente
(ou agendar cron `TRUNCATE` semanal, já que a tabela é descartável).

**Verify:** `pg_total_relation_size('net._http_response')` << 50 MB; crons seguem
`succeeded` (checar `cron.job_run_details` na janela seguinte — 10+ jobs/min
dependem do pg_net).

---

## Passo 2 — REINDEX CONCURRENTLY das tabelas de log (ONLINE, ~330 MB)

Índices inchados por retenção DELETE-heavy (crons a cada 10 min). Ex.:
`whatsapp_health_checks` = 116 MB de índice para 142K linhas (~10× o saudável).
`REINDEX CONCURRENTLY` reconstrói sem lock de escrita.

```sql
-- health_checks (~106 MB) — maior ROI/risco
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_health_checks_status;
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_health_checks_instance_time;
REINDEX INDEX CONCURRENTLY public.whatsapp_health_checks_pkey;

-- audit_log (~100 MB de idx) — tem PII no heap; REINDEX não toca dado, só btree
REINDEX INDEX CONCURRENTLY public.idx_audit_log_row_time;
REINDEX INDEX CONCURRENTLY public.idx_audit_log_table_time;
REINDEX INDEX CONCURRENTLY public.idx_audit_log_org_time;
REINDEX INDEX CONCURRENTLY public.audit_log_pkey;

-- runtime_logs (~100 MB de idx)
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_module_action_time;
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_status_created;
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_org_created;
REINDEX INDEX CONCURRENTLY public.idx_runtime_logs_module_created;
REINDEX INDEX CONCURRENTLY public.runtime_logs_pkey;

-- media_jobs (~30 MB)
REINDEX INDEX CONCURRENTLY public.whatsapp_media_jobs_message_id_instance_id_key;
REINDEX INDEX CONCURRENTLY public.whatsapp_media_jobs_pkey;
```

> Se algum REINDEX CONCURRENTLY falhar (deixa um índice `_ccnew` inválido):
> `DROP INDEX CONCURRENTLY IF EXISTS public.<idx>_ccnew;` e re-tentar.

**Verify:** `pg_indexes_size` das 4 tabelas cai ~330 MB somados; nenhum índice
`INVALID` (`SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`).

---

## Passo 3 — DROP dos 4 índices mortos de whatsapp_messages (ONLINE, −198 MB)

Ver `supabase/migrations/20270313000000_*.sql` (evidência completa por índice).
Write-hot table → sempre CONCURRENTLY. Registrar em schema_migrations depois.

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_msgs_convlist;         -- 190 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_sent_source;  -- 7.4 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_sent_by_ai;   -- 360 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_assigned_to;  -- 8 KB
```

**Verify:** `SELECT count(*) FROM pg_indexes WHERE tablename='whatsapp_messages';`
= 18 (era 22). Delta de idx_scan dos mantidos verde em 48 h.

---

## Passo 4 — REINDEX CONCURRENTLY dos sobreviventes de whatsapp_messages (ONLINE, ~100–150 MB)

95.900 dead tuples; índices grandes com bloat de churn. Só os maiores (ROI). Online.

```sql
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_msgs_org_instance_phone;  -- 193 MB
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_messages_instance_jid_ts; -- 176 MB
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_msgs_org_instance_ts;     -- 149 MB
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_msgs_org_inst_dir_ts;     -- 123 MB
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_messages_direction;       -- 112 MB
REINDEX INDEX CONCURRENTLY public.idx_whatsapp_msgs_org_lead;            -- 94 MB
```

**Verify:** `pg_indexes_size('public.whatsapp_messages')` menor; 0 índice INVALID.

---

## Passo 5 — VACUUM FULL do heap inchado (JANELA BAIXA, lock ACCESS EXCLUSIVE, ~250 MB)

Reclama bloat de heap+toast. **Bloqueia a tabela** — só em madrugada BRT, uma de
cada vez. `audit_log` é escrita por trigger em toda mutação → VACUUM FULL dela
bloqueia mutações de usuário; fazer por último e rápido.

```sql
VACUUM (FULL, ANALYZE) public.whatsapp_webhook_dlq;   -- 48 MB heap + 42 MB toast
VACUUM (FULL, ANALYZE) public.whatsapp_media_jobs;    -- 89 MB heap
VACUUM (FULL, ANALYZE) public.runtime_logs;           -- 81 MB heap
VACUUM (FULL, ANALYZE) public.whatsapp_health_checks; -- 32 MB heap
VACUUM (FULL, ANALYZE) public.audit_log;              -- 125 MB heap (PII; por último)
```

> `whatsapp_messages` (1082 MB heap) **NÃO** entra em VACUUM FULL: lock longo na
> tabela write-hot é inaceitável e o heap está saudável (raw_payload já nulado
> a 14 d pelo cron jobid 75, autovacuum a 0.10). Retenção de linhas fica adiada
> (item 5, ver SPEC).

**Verify:** rodar §Medição; comparar com Passo 0.

---

## Medição (rodar ao fim; comparar com Passo 0)

```sql
SELECT c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) total
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('whatsapp_messages','whatsapp_health_checks','runtime_logs',
                    'audit_log','whatsapp_media_jobs','whatsapp_webhook_dlq')
ORDER BY pg_total_relation_size(c.oid) DESC;
SELECT pg_size_pretty(pg_total_relation_size('net._http_response')) pgnet;
SELECT round(100*sum(heap_blks_hit)/nullif(sum(heap_blks_hit+heap_blks_read),0),2)
FROM pg_statio_user_tables;  -- esperado subir em direção a 99%
```

## Reclaim esperado (conservador)

| passo | objeto | reclaim | risco |
|---|---|---|---|
| 1 | net._http_response TRUNCATE | ~630 MB | 🟢 zero |
| 2 | REINDEX logs (health/audit/runtime/media) | ~330 MB | 🟢 online |
| 3 | DROP 4 dead idx wa_messages | ~198 MB | 🟢 online |
| 4 | REINDEX sobreviventes wa_messages | ~100–150 MB | 🟢 online |
| 5 | VACUUM FULL heaps | ~250 MB | 🟠 lock janela baixa |
| **total** | | **~1.5 GB** | |

Passos 1–4 (~1.25 GB) são todos **online/instantâneos** — o VACUUM FULL do Passo
5 é o único que exige janela. Cache hit de heap deve subir de 92% → ~99% conforme
o hot set passa a caber em shared_buffers.
