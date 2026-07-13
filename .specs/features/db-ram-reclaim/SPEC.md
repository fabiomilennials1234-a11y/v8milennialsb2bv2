# DB RAM Reclaim — reclamar ~1.5 GB sem upgrade de compute

**Created:** 2026-07-13
**Owner:** CTO + engenheiro
**Prod:** `jsjsmuncfkbsbzqzqhfq` (Small, 2 GB RAM: shared_buffers 512 MB,
effective_cache_size 1.5 GB, max_conn 90). DB 6.6 GB = 3.3× RAM. heap cache hit
92% (alvo 99%). 0 OOM/restart em 24 h — não está quebrando, está desperdiçando.
**Regra:** dev-first; aplicar em prod só com "vai" do CTO. Branch
`feat/db-ram-reclaim/*` de `main`. Complementa (não substitui) a Onda 3 do SPEC
`db-optimization`.
**Entregáveis:** `20270313000000_drop_dead_whatsapp_messages_indexes.sql`,
`20270313000001_autovacuum_tuning_log_tables.sql`, `RUNBOOK.md` (o lever real).

---

## TL;DR

O RAM se reclama encolhendo o **footprint físico** (bloat), não mexendo em
compute. ~1.5 GB estão presos em bloat de high-water-mark em 6 objetos, quase
tudo recuperável **online** (REINDEX/DROP CONCURRENTLY, TRUNCATE), só ~250 MB
exigem janela (VACUUM FULL). Ver `RUNBOOK.md`.

---

## Divergências do diagnóstico recebido (verificadas em PROD 2026-07-13)

O brief que arrancou este slice tinha 4 itens; a verificação contra o
schema/código real corrigiu 3 deles. Reportado como manda a regra ("se não bate,
pare e reporte").

### D1 — Item 4 (retenção de logs) JÁ EXISTE. É bloat, não falta de retenção.
O brief dizia "sem retenção hoje" em audit_log/runtime_logs/health_checks/
media_jobs/dlq. Falso: há **8 crons de retenção ativos** — jobid 82 (audit 14 d),
83 (health 7 d), 84 (media 14 d), 77 (dlq só `resolved_at IS NOT NULL` OR 14 d),
90 (runtime_logs), 91 (media), 75 (raw_payload 14 d), 40 (pgnet 7 d). As tabelas
estão grandes **apesar** da retenção: o DELETE dos crons libera linha mas não
devolve o espaço ao SO (HWM nunca encolhe). Ex.: `whatsapp_health_checks` = 116 MB
de índice para 142K linhas. → Fix é REINDEX/VACUUM FULL, **não** novos crons.
**Nada novo a construir aqui.**

### D2 — Item 1 (retenção pg_net) idem. TTL já é 6 h; os 666 MB são bloat.
`net._http_response` = 666 MB para 4.238 linhas (janela de exatamente 6 h; GUC
`pg_net.ttl = 6 hours`) + cron jobid 40 redundante deletando a 7 d. É 100% bloat.
Fix = `TRUNCATE` (reclama ~630 MB, sub-segundo, seguro — respostas são
fire-and-forget). Reduzir TTL é tuning opcional, não o ganho.

### D3 — Item 2 (índices wa_messages): candidatos do brief conflitam com dado vivo.
- "600 MB de composites redundantes" (org_instance_ts/org_inst_dir_ts/
  org_instance_phone/instance_jid_ts) — **REFUTADO**: idx_scan vivo = 474K / 123K /
  79K / 38K. São quentes, não redundantes. EXPLAIN prova cada um servindo um
  fluxo real (chat thread → org_instance_phone; unread → unread_cover;
  ChatBubble incoming → org_inst_dir_ts).
- `idx_whatsapp_msgs_org_dir_ts` (117 MB) — o brief manda avaliar drop; o SPEC
  `db-optimization` Onda 3.1 manda **MANTER** (rationale: analytics/useAgentMetrics).
  Evidência fresca conflita com AMBOS parcialmente: idx_scan congelou (2013) numa
  janela viva E o code-sweep mostra que analytics filtra `created_at`, não
  `"timestamp"` (o índice é em timestamp → inutilizável por elas). Sinal de morto,
  MAS a janela de delta foi curta (3.6 min) e há veto revisado. **Decisão adiada
  → Onda 3.1 com delta de 24–48 h.** Não dropado unilateralmente.
- `idx_whatsapp_messages_instance` — VETO do SPEC (1.2M scans). Não tocado.

**Sobra provado-morto e não-conflitante:** convlist (190 MB, consumidor removido
em 20261119000015 + idx_scan congelado + EXPLAIN mostra unread_cover servindo),
sent_source (7.4 MB), sent_by_ai (360 KB), assigned_to (8 KB). Todos também no
drop-list do próprio SPEC. → migration `20270313000000`.

### D4 — Non-goal "VACUUM FULL descartado (~73 MB)" do SPEC db-optimization está stale.
Aquela medição (2026-07-08) não contou o bloat de índice das tabelas de log nem o
pgnet. Medição fresca: pgnet 666 MB + health idx 116 MB + audit idx 137 MB +
runtime idx 127 MB. O reclaim real via REINDEX/VACUUM FULL nesses 6 objetos é
~1.5 GB, re-mensurável pelo §Medição do RUNBOOK. Supersede o non-goal **para
esses objetos** (o non-goal continua válido pra heap de whatsapp_messages).

---

## O que foi construído (branch-ready, NÃO aplicado)

1. **`20270313000000_drop_dead_whatsapp_messages_indexes.sql`** — dropa 4 índices
   mortos (convlist/sent_source/sent_by_ai/assigned_to; −198 MB + 4 btrees a menos
   por INSERT no hot path). Padrão #1009 (CONCURRENTLY fora de txn, aplicar via
   execute_sql, registrar em schema_migrations). Evidência por índice no header.
2. **`20270313000001_autovacuum_tuning_log_tables.sql`** — baixa scale_factor de
   audit_log + runtime_logs (as 2 churny ainda no default 0.2) pra 0.05. Padrão
   #1012, txn-safe, previne regrowth. Só previne — não reclama o bloat já preso.
3. **`RUNBOOK.md`** — o lever de RAM (~1.5 GB): TRUNCATE pgnet + REINDEX
   CONCURRENTLY (logs + sobreviventes wa_messages) + VACUUM FULL (heaps, janela
   baixa). Ordenado por ROI/risco, com medição antes×depois e verify por passo.

## Evidência (PROD read-only 2026-07-13)

- Inventário dos 22 índices de wa_messages com idx_scan + size.
- Code-sweep de todos os call-sites (PostgREST + RPCs) por índice candidato.
- EXPLAIN(ANALYZE,BUFFERS): chat thread→org_instance_phone; unread→unread_cover;
  ChatBubble incoming→org_inst_dir_ts.
- Delta de idx_scan em janela viva: convlist/org_dir_ts/sent_*/assigned_to
  CONGELADOS enquanto unread_cover +54 e org_instance_phone +27.
- Corpo real de get_whatsapp_conversation_list em prod (lê de summary; convlist órfão).
- reloptions + cron.job (retenção existente) + breakdown heap/idx das 6 tabelas.

## Item 5 — Retenção de whatsapp_messages: ADIADO (decisão)

**Não fazer agora.** Só ~6% das linhas são >90 d (DB tem 5.5 meses de dados) e
`raw_payload` já é nulado a 14 d (cron jobid 75), mantendo o heap em ~730 B/linha.
Retenção aqui reclamaria quase nada e apagaria chat vivo (contradiz visibilidade
de histórico). Heap de wa_messages (1082 MB) está saudável (autovacuum 0.10).
**Revisitar em ~6 meses** quando a cauda >90 d for material, aí avaliar
particionamento por tempo (DROP de partição = reclaim instantâneo, sem bloat)
em vez de DELETE.

## Follow-ups

- Onda 3.1 (`feat/db-optim/wa-messages-index-diet`): decidir org_dir_ts com delta
  24–48 h; criar as 2 parciais (health-monitor/rate-limit) e o resto do diet 22→16.
- Opcional: reduzir `pg_net.ttl` 6 h→1 h (validar mecânica em staging) ou cron
  `TRUNCATE net._http_response` semanal (tabela descartável) pra evitar re-bloat.
- Reexecutar §Medição do RUNBOOK 48 h pós-aplicação; registrar reclaim real e
  cache hit no changelog Obsidian `07 — Changelog/2026-07-13.md`.
