# Tasks — DB Optimization

Legenda: `[P]` paralelo (sem dependência mútua) | `→ T#` depende de task | 🟢🟠🔴 risco
Regra: dev-first; prod só com "vai" do CTO; `DROP INDEX CONCURRENTLY` via Management API + migration commitada.

---

## Onda 0 — Segurança (~4h)

### T0.1.1 🟢 — REVOKE fns de retenção de mídia (ADV-1)
- **What:** `REVOKE EXECUTE … FROM anon, authenticated` nas 2 fns + `GRANT … TO service_role` + `LEAST(p_limit, 5000)` na RPC
- **Where:** migration nova `<ts>_revoke_media_retention_fns.sql`; corrigir REVOKE em `20270303000000` e `20270303000001`
- **Done when:** `has_function_privilege('anon'|'authenticated', oid, 'execute') = false` nas 2 fns
- **Test:** `POST /rest/v1/rpc/list_expired_whatsapp_media` com anon key → 401/permission denied
- **Gate:** advisor sem os 4 lints; cron jobid 91 `succeeded` no dia seguinte
- **Estimativa:** 1h · **branch:** `hotfix/db-sec-retention-fn-revoke` (de main)

### T0.2.1 🟢 — Policy media/help-media → authenticated (ADV-2)
- **What:** DROP policy `"Allow public read"` + `"help_media_read"`; CREATE SELECT `TO authenticated`
- **Where:** migration `<ts>_media_bucket_authenticated_read.sql` (aplicar via dashboard/Mgmt API — schema storage)
- **Done when:** anon `.list('media')` → vazio/erro; `getPublicUrl` → 200
- **Test (dev, 6 cenários):** list anon vazio · getPublicUrl 200 · upload+upsert novo · upload sobrescrevendo · `.remove()` áudio copilot · help center upload+display
- **Gate:** todos os 6 cenários OK em dev antes de prod
- **Estimativa:** 2h · **branch:** `hotfix/db-sec-media-bucket-list` (de main) · **→ T0.2.1 exige QA logado**

### T0.3.1 🟠 — Rotacionar CRON_SECRET
- **What:** gerar segredo novo → `UPDATE cron_config SET value=… WHERE key='cron_secret'` + atualizar secret nas edge fns
- **Where:** Mgmt API + `supabase secrets set CRON_SECRET=…`
- **Done when:** crons de cron (webhook-deliveries, campaign-rule-dispatch, jobid 91…) seguem `succeeded`
- **Gate:** nenhum job vira `failed` na janela seguinte
- **Estimativa:** 1h · **branch:** `ops/rotate-cron-secret`

---

## Onda 1 — Operacional (~7h)

### T1.0.1 🟠 — DECISÃO NatuPlast (bloqueante do 1.1)
- **What:** confirmar com CTO/cliente: número `556282392982` saiu de propósito ou re-registrar instância?
- **Done when:** decisão registrada; se re-registrar, history-sync backfill agendado
- **Blocks:** T1.1.2 (corte do token 932b8d10)
- **Estimativa:** — (negócio)

### T1.1.1 [P] 🟢 — Desregistrar webhook das instâncias de teste do dev
- **What:** desregistrar webhook (não deletar instância) dos tokens `10471d40`, `643a34f9`, `69943281` (teste dev 554891005289)
- **Where:** edge fn `whatsapp-rebind-webhook` (fala com API Uazapi)
- **Done when:** esses tokens param de aparecer em `whatsapp_webhook_dlq` (novos rows)
- **Estimativa:** 1h

### T1.1.2 🟠 — Cortar webhook fantasma + early-drop + demover log (ERR-4)
- **What:** (1) desregistrar webhook de `932b8d10` (pós T1.0.1) + `3b8b416b`; (2) early-drop no `whatsapp-webhook` por denylist derivada de N exhausted; (3) `logRuntime uazapi_unknown_instance` error→contador agregado
- **Where:** `whatsapp-webhook/index.ts` (branch `unknown_instance`), `_shared`
- **Done when:** entrada DLQ < 300/dia; erros de webhook em `runtime_logs` ~zero
- **Test:** medir msgs reais dropadas ANTES de ligar denylist (guarda contra esconder perda)
- **Gate:** `dlq_replay_batch` sem erro em 24h
- **Depends on:** T1.0.1 · **Estimativa:** 2h · **branch:** `fix/dlq-poison-webhook-cut`

### T1.2.1 🟠 — Gate de liveness na execução de workflow (ERR-3)
- **What:** gate no `process-workflow-executions`: instância viva = `status IN ('open','connected') AND session_dead_since IS NULL`; park `paused`+`error='no_live_instance'` com resume via watchdog
- **Where:** `process-workflow-executions/index.ts`
- **Done when:** execuções de org sem instância viva não re-falham; despausam quando instância volta
- **Estimativa:** 2.5h · **branch:** `fix/workflow-live-instance-gate`

### T1.2.2 ✅ — Fallback org-default em getWhatsAppInstance — FEITO 2026-07-09
- **What:** quando node pina `instanceId` morto, cair pro fallback org-default (mesmo predicado de liveness)
- **Where:** `_shared/action-handlers/whatsapp-helpers.ts` — `isInstanceLive()` extraída + gate na branch pinada
- **Done when:** 163874dd (Evolution-404, 83 falhas/7d) volta a enviar sozinha sem tocar workflow ✓
- **QA:** 7 Deno.test verdes (+2 novos), type-clean (0 erros novos). Branch `fix/workflow-live-instance-gate`, PR pendente.
- **Deploy:** redeploy das edge fns que bundlam o helper (send-whatsapp*, send-to-number, followup-sender, outbound-sender, process-workflow-executions) — **pendente "vai" do CTO**.
- **Nota:** independente da T1.2.1 na prática (o fallback já é liveness-aware); a dependência era conceitual.

### T1.2.3 [P] — Remediação por org
- **What:** Motor100+Bertin re-parear (CS); DNA+17c46b69 desativar (reversível); d7f78b22 `image_url`; 589f6a52 team member
- **Done when:** workflow_executions `failed` < 5% em 7d
- **Estimativa:** 1h (config)

---

## Onda 2 — Features quebradas (~11h)

### T2.1.1 🟠 — find_duplicate_leads Fase 1 (DUP-1)
- **What:** migration `find_duplicate_leads(p_org_id uuid)` org-scoped + master-ghost, `SECURITY INVOKER`, match por email; frontend passa `organizationId`, trata `error`, `retry:false`
- **Where:** migration nova + `src/modules/leads/hooks/useDuplicateLeads.ts` + `pages/Duplicates.tsx`
- **Done when:** `/duplicados` lista os 245 grupos por email + mostra erro (não empty state)
- **Test:** integração RLS admin/membro/master; PGRST202 vira estado de erro visível
- **Estimativa:** 3h · **branch:** `feat/db-optim/duplicate-leads-rpc`

### T2.1.2 🔴 — merge_leads Fase 2 (redesenho antes de prod)
- **What:** `merge_leads(p_keep, p_merge)`: inventário 49 FKs (pg_constraint), colisão de uniques, coalesce escalares, soft-delete perdedor, gate `admin`/`leads.manage`, testes RLS
- **Done when:** merge reatribui todas as FKs sem violar unique; perdedor soft-deleted
- **Gate:** merge é IRREVERSÍVEL — testes de integração completos + review antes de prod
- **Depends on:** T2.1.1 · **Estimativa:** — (Fase 2, escopo próprio)

### T2.2.1 🟠 — Redeploy executor (pré-requisito DUP-2)
- **What:** `supabase functions deploy process-workflow-executions --project-ref jsjsmuncfkbsbzqzqhfq` (bundle v99 é pré-#977, não chama guard); investigar regressão deploy ~18:45 UTC
- **Done when:** executor deployado chama `reserveSendOrSkip`
- **Blocks:** T2.2.2 (tabela inerte sem isso)
- **Estimativa:** 0.5h

### T2.2.2 🟠 — Migration send_dedup_log + plugar manual (DUP-2)
- **What:** migration NOVA idempotente `<ts>_send_dedup_log_apply.sql` (não re-aplicar `20260523000000`): `CREATE TABLE IF NOT EXISTS` + 2 uniques parciais + RLS `get_my_organization_ids` + policy `service_role FOR ALL` + cron cleanup 5min; regen types; plugar `reserveSendOrSkip` no `whatsapp-api-proxy` (source='manual', 10s, sinal visível)
- **Done when:** `to_regclass('public.send_dedup_log')` não-null; duplos workflow → 0
- **Test:** observar 48h logs `[send-dedup] BLOCKED` + falsos-positivos
- **Depends on:** T2.2.1 · **Estimativa:** 4.5h · **branch:** `feat/db-optim/send-dedup-apply`

---

## Onda 3 — Efetividade de índices (~11h)

### T3.1.1 🟢 — whatsapp_messages Fase 0: criar 2 parciais (IDX-1)
- **What:** `CREATE INDEX CONCURRENTLY idx_wm_instance_incoming_created (instance_id, created_at DESC) WHERE direction='incoming'` + `idx_wm_instance_outgoing_ts (instance_id, "timestamp" DESC) WHERE direction='outgoing'`
- **Done when:** health-monitor + rate-limit usam range scan exato (EXPLAIN)
- **Estimativa:** 1h · **branch:** `feat/db-optim/wa-messages-index-diet`

### T3.1.2 🟢 — whatsapp_messages Fase 1: dropar 8 redundantes
- **What:** `DROP INDEX CONCURRENTLY` de `org_lead_dir, messages_org, messages_instance⚠️, messages_direction, org_inst_dir_ts, convlist, sent_source, sent_by_ai` (um a um, Mgmt API)
- **Where:** migration commitada com `DROP INDEX IF EXISTS` (replay); EXPLAIN antes
- **Done when:** 22→16 índices, −380 MB; delta `idx_scan` dos mantidos verde 48h
- **Gate:** ⚠️ `messages_instance` (1,1M scans) só após confirmar que o parcial outgoing absorve; senão manter
- **Depends on:** T3.1.1 · **Estimativa:** 2h

### T3.1.3 🟢 — whatsapp_messages Fase 2 (após 7-14d delta)
- **What:** reavaliar `messages_timestamp` (⚠️ cron jobid 91 consome?) e `messages_assigned_to`
- **Done when:** decisão registrada com delta como evidência
- **Depends on:** T3.1.2 + janela · **Estimativa:** 1h

### T3.2.1 🟢 — 16 pares gêmeos (IDX-2)
- **What:** `DROP INDEX CONCURRENTLY` dos 16 manuais (gêmeo unique fica); rollback recria byte-idêntico (3 com `DESC` na 2ª col)
- **Done when:** gêmeo unique absorve volume em 24h
- **Estimativa:** 1.5h · **branch:** `feat/db-optim/index-twins-unused`

### T3.2.2 🟢 — 3 HNSW embedding + 10 unused + pipeline_entries dup (IDX-3/5, DUP-4)
- **What:** drop 3 HNSW (doc gatilho recriação) + 10 unused (>60d, 0 leitor; ⚠️ EXCLUIR 3× `pipeline_stage_events`) + codificar constraint `pipeline_entries` no repo e dropar índice parcial
- **Done when:** advisor unused_index cai; planner não muda plano de query relevante (EXPLAIN)
- **Depends on:** T3.2.1 · **Estimativa:** 2h

### T3.3.1 🟢 — Reset pgss + snapshots de rollback (ERR-1)
- **What:** `SELECT extensions.pg_stat_statements_reset()` (NÃO `pg_stat_reset()`); tabela `rollback_rate_snapshots` + cron 5min + retenção 30d (policy `service_role FOR ALL`)
- **Done when:** baseline limpa; snapshots alimentando; re-baselinar alerta após 7d (~22-27 rb/min)
- **Gate:** pré-requisito da Onda 4 (medir ganho de RLS exige baseline limpa)
- **Estimativa:** 2h · **branch:** `chore/reset-pgss-baseline`

---

## Onda 4 — Frente A de RLS (SPEC próprio pós-Onda 3)

Escrever `.specs/features/db-optim-rls/SPEC.md` + tasks. Slices S1-S6 (18-26h). Gate por slice: `rls_check_access` admin/membro/master + perfil membro-restrito + delta pgss 48h. Decisão de produto (visibilidade de chat) é pré-requisito do S1 → ADR.

- [ ] Decisão CTO: visibilidade de chat org-wide vs restrito (ADR)
- [ ] SPEC dedicado da Frente A escrito
- [ ] S1 whatsapp_messages (perf inline zero-mudança + decisão)
- [ ] S2 leads (reescrita set-based 4 fns per-row) + S2b initplan 7 lints
- [ ] S3 lead_tags+tags · S4 publication diet · S5 conversations · S6 família restante
