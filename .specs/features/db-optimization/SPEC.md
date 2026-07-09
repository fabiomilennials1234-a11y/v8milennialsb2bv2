# DB Optimization — Segurança · Operacional · Efetividade · RLS

**Created:** 2026-07-09
**Scope:** Large (produção — segurança, correção operacional, higiene de índices, consolidação de RLS)
**Owner:** CTO + arquiteto + engenheiro
**Estimate:** ~45h ao longo de 5 ondas (Onda 4 = projeto dedicado)
**Source:** Auditoria adversarial 2026-07-09 (workflow ultracode, 35 agentes: 6 investigadores × dimensão + 1 cético refutador por achado; 24 confirmados, 5 refutados). Complementa o Dossiê DB (2026-07-08).
**Gated by:** nada — Onda 0 pode arrancar já. Ondas independentes entre si (exceto onde marcado).
**Roadmap:** Dossiê DB (vault `02 — Arquitetura/Dossiê DB — Saúde e Roadmap.md`), §5.
**Regra do projeto:** dev-first; migration/deploy prod só com "vai" explícito do CTO; branch `feat/db-optim/<slice>` de `develop` (segurança = classe hotfix, sai de `main`); método `DROP INDEX CONCURRENTLY` via Management API + migration commitada (gotcha replay #1009).

---

## Contexto

O Dossiê DB (2026-07-08) mapeou a saúde do banco mas priorizou por **médias cumulativas** de `pg_stat_statements` — nunca resetado desde 2026-01-24 (5,5 meses). A auditoria de 2026-07-09 tirou **dois retratos com 40 min de intervalo em pico** e cruzou os deltas de `calls`. Descoberta que reordena tudo:

> **Os "gargalos" top-por-total são fósseis.** A query de chat de 3.049 ms (174K calls), o kanban de 94 ms e o pipe legado de 1.570 ms estão **congelados** — features já substituídas, não executam mais. O único write pesado **vivo** é o `INSERT` em `whatsapp_messages` a **30,8 ms** (~51K/dia, hot path do webhook, 7 gatilhos síncronos). Perseguir latência de leitura pela média cumulativa = caçar fantasma.

Por isso a ordem deste SPEC **não** é "acelera o chat". É: (0) fechar brechas de segurança provadas, (1) estancar perda operacional real, (2) consertar features que falham em silêncio, (3) higiene de índices no write path vivo, (4) fatiar a Frente A de RLS. O ganho de latência de leitura vem depois, gated por **reset de `pg_stat_statements` + medição de 7 dias**.

## Goals

- **Segurança**: 0 função de retenção de mídia executável por `anon`/`authenticated`; bucket `media` não-listável sem login; `CRON_SECRET` rotacionado. Verificado por `has_function_privilege` + advisor re-run + teste com anon key.
- **Operacional**: workflow_executions `failed` < 5% em 7d; entrada da DLQ < 300/dia; 0 mensagem real de org ativa dropada silenciosamente.
- **Efetividade**: `whatsapp_messages` de 22 → 16 índices (~400 MB líquidos) sem regressão de leitura; cauda de índices redundantes/unused/gêmeos dropada; feature `/duplicados` funcional; camada anti-duplo-envio ativa.
- **RLS (Onda 4)**: eliminar per-row function calls nas ≤8 tabelas quentes; publication saneada; decisão de produto sobre visibilidade de chat registrada em ADR.

## Non-goals

- **Perseguir latência de leitura antes do reset de stats** — as médias atuais são fósseis; medir 7d primeiro.
- **Re-derivar falsos-positivos já fechados**: lint `unindexed_foreign_keys` (191, veredito NÃO indexar), bloat (~73 MB reclamável, `VACUUM FULL` descartado), `pg_sleep` (unstagger aplicado), autovacuum (tunado #1012), dup-indexes exatos (#1009).
- **Fillfactor em `whatsapp_messages`** (refutado: status `delivered`/`read` nem existe em prod).
- **Investigar rollback 19%** como incêndio (refutado: fóssil cumulativo; real ~2,1%, maquinaria benigna PostgREST/Realtime).
- **Big-bang de RLS de 40h** — a Onda 4 fatia em slices; cada um é reversível por DDL.
- **Storage / retenção de mídia** — projeto separado (S1 resolvido; S2-S5 em roadmap próprio).

---

## Ondas & slices

Cada slice = 1 PR pequeno + 1 script de rollback. Migration commitada mesmo quando aplicada via Management API (replay não recria dropados — gotcha #1009).

| # | Branch | Onda | Escopo | Risco | Estimativa |
|---|--------|------|--------|-------|------------|
| 0.1 | `hotfix/db-sec-retention-fn-revoke` | 0 Segurança | REVOKE `anon,authenticated` nas 2 fns de retenção de mídia + corrigir migrations `20270303*` | 🟢 Baixo | 1h |
| 0.2 | `hotfix/db-sec-media-bucket-list` | 0 Segurança | Policy `media`/`help-media` → SELECT `authenticated` (mata enumeração sem login) | 🟢 Baixo | 2h |
| 0.3 | `ops/rotate-cron-secret` | 0 Segurança | Rotacionar `CRON_SECRET` (cron_config + secrets edge fns) | 🟠 Médio | 1h |
| 1.1 | `fix/dlq-poison-webhook-cut` | 1 Operacional | Desregistrar webhook das instâncias fantasma + early-drop denylist + demover log error→contador | 🟠 Médio | 3h |
| 1.2 | `fix/workflow-live-instance-gate` | 1 Operacional | Gate de liveness na execução + fallback org-default em `getWhatsAppInstance` | 🟠 Médio | 4h |
| 2.1 | `feat/db-optim/duplicate-leads-rpc` | 2 Features | Migration `find_duplicate_leads` + página trata erro (Fase 1); `merge_leads` (Fase 2, redesenho) | 🟠 Médio | 6h |
| 2.2 | `feat/db-optim/send-dedup-apply` | 2 Features | Migration nova `send_dedup_log` + redeploy executor + plugar path manual | 🟠 Médio | 5h |
| 3.1 | `feat/db-optim/wa-messages-index-diet` | 3 Efetividade | +2 parciais (health-monitor/rate-limit), −8 redundantes; 22→16 | 🟢 Baixo | 5h |
| 3.2 | `feat/db-optim/index-twins-unused` | 3 Efetividade | 16 pares gêmeos + 3 HNSW + 10 unused + `pipeline_entries` dup UNIQUE | 🟢 Baixo | 4h |
| 3.3 | `chore/reset-pgss-baseline` | 3 Efetividade | `pg_stat_statements_reset()` + tabela `rollback_rate_snapshots` + cron 5min | 🟢 Baixo | 2h |
| 4.x | `feat/db-optim/rls-sN-*` | 4 RLS | 6 slices de consolidação de RLS + publication diet (SPEC próprio pós-Onda 3) | 🔴 Alto | 18-26h |

**Order rationale:** segurança primeiro (menor custo, maior risco se ignorada, classe já autorizada). Operacional segundo (sangramento de negócio ativo — mensagens perdidas). Features terceiro (falham em silêncio, mas sem perda de dado). Índices quarto (write path vivo, baixo risco, calibra disciplina). Reset de stats **antes** da Onda 4 (a Onda 4 precisa de baseline limpa pra medir ganho). Onda 4 por último (projeto dedicado, alto risco, dev-first obrigatório).

---

## Onda 0 — Segurança (fechar hoje)

> **Status 2026-07-09:** artefatos de migration escritos (`20270309000000`, `20270309000001`) + runbook 0.3 (`05 — How-to/rotacionar-cron-secret.md`). Lint de anti-padrões: verde. **Não aplicado em prod** — gated em "vai" do CTO; dev-first bloqueado (402 quota + baseline divergente). Decisão de eng.: as migrations imutáveis `20270303*` NÃO foram editadas (regra 1 `migrations/CLAUDE.md`); a nova roda por último e corrige o ACL no replay.

### Slice 0.1 — Fns de retenção executáveis por anon (ADV-1)

**Achado:** `proacl` de `list_expired_whatsapp_media` e `invoke_whatsapp_media_retention` em prod = `{postgres=X, anon=X, authenticated=X, service_role=X}`, ambas `SECURITY DEFINER`. `p_limit` sem teto → anon enumera 166K paths (telefone + org no nome) e dispara purge de mídia.

**Root cause:** o grant é **explícito**, materializado por `pg_default_acl` (defaclacl do role `postgres`) — por isso `REVOKE FROM PUBLIC` (que as migrations `20270303*` já têm) é **no-op**. Gotcha refinado: o mantra "use FROM PUBLIC" é incompleto neste projeto — inspecionar `proacl` antes de escolher o grantee.

**Fix:**
```sql
REVOKE EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retention() TO service_role;
GRANT EXECUTE ON FUNCTION public.list_expired_whatsapp_media(integer, integer) TO service_role;
-- opcional (avaliar em separado — muda default de TODAS as fns futuras):
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
```
Corrigir as linhas de REVOKE nas migrations `20270303000000`/`20270303000001` (adicionar `anon, authenticated`) pro replay fresco não regredir. Adicionar `LEAST(p_limit, 5000)` na RPC.

**Verify (obrigatório, nos DOIS roles):** `has_function_privilege('anon', oid, 'execute') = false` E `has_function_privilege('authenticated', oid, 'execute') = false`. Advisor sem os 4 lints. Cron jobid 91 segue `succeeded` no dia seguinte.

### Slice 0.2 — Bucket media público e listável (ADV-2)

**Achado (provado empiricamente):** com a anon key de prod, `POST /storage/v1/object/list/media` lista `whatsapp-media/{org}/` das 30 orgs e chega a arquivos cujo nome é o telefone do cliente. O comentário "path não-enumerável" no código é derrotado — `.list()` entrega o path.

**Fix (substituir, não dropar cru):**
```sql
DROP POLICY "Allow public read" ON storage.objects;
CREATE POLICY "media_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'media');
DROP POLICY "help_media_read" ON storage.objects;
CREATE POLICY "help_media_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'help-media');
```
`getPublicUrl` (/object/public) segue 200 — bucket continua `public`. Remove `.list()` anônimo + `/object/authenticated` anônimo, preserva os fluxos logados (upsert precisa de SELECT → `authenticated` mantém).

**Verify (DEV antes de prod):** (1) anon `.list('media')` → vazio/erro; (2) `getPublicUrl` de mídia existente → 200; (3) upload authenticated com upsert de arquivo novo → sucesso; (4) upload sobrescrevendo → sucesso; (5) `.remove()` de áudio copilot → sucesso; (6) upload+display no help center → sucesso.

**Residual (aceito, deferir p/ S2 privatização):** policy é bucket-wide — usuário logado de qualquer org ainda lista cross-tenant. Fim real = path por-org + bucket privado + signed URL (S2). Este slice cumpre o objetivo: matar enumeração **sem login**.

### Slice 0.3 — Rotacionar CRON_SECRET

**Achado:** vazou em transcript do incidente de retenção (2026-07-09); segue credencial válida em `cron_config.cron_secret` + env das edge fns. Amplifica o 0.1.

**Fix:** gerar novo segredo → atualizar `cron_config` + secrets das edge fns num único movimento (10+ jobs dependem). Smoke: crons de cron seguem verdes.

---

## Onda 1 — Operacional (estancar sangramento)

### Slice 1.1 — DLQ 100% veneno perde mensagens reais (ERR-4)

**Achado:** 37.704 webhooks de instância fantasma desde 25/jun, **0 resolvidos na história**. 85% do token da instância "HUGO NATUPLAST" (`556282392982`) — org **ativa** que trocou de instância sem desregistrar o webhook antigo → ~890 msgs reais/dia perdidas. Replay re-tenta cada linha 5× e o log `uazapi_unknown_instance` (status=error) gera **87%** de todos os erros de `runtime_logs`.

**Decisão de negócio (pré-requisito, item 0):** confirmar com CTO/NatuPlast se o número saiu de propósito ou re-registrar (history-sync backfill recupera o período perdido). Só então cortar.

**Fix:**
1. Desregistrar **só o webhook** por instância (config per-instance do Uazapi; tokens estão nos payloads da DLQ; edge fn `whatsapp-rebind-webhook` já fala com a API) — NÃO deletar instância/sessão (exigiria QR físico, irreversível). Aplicar a: `932b8d10` (após decisão), `3b8b416b`, `10471d40`, `643a34f9`, `69943281` (instâncias de teste do dev — corte imediato seguro).
2. Early-drop no `whatsapp-webhook`: token com N rows `exhausted` na DLQ vira 200 + contador, sem `enqueueDlq` (denylist derivada, consultada só no branch `unknown_instance`).
3. Demover o `logRuntime uazapi_unknown_instance` de `status=error` por-evento pra contador agregado/sampled.

**Ganho:** −94% dos erros de `runtime_logs`, ~10K replays HTTP inúteis/semana a menos, entrada DLQ < 300/dia. **Métrica de guarda:** medir mensagens reais dropadas ANTES de ligar o denylist (senão o denylist esconde a perda pra sempre).

### Slice 1.2 — Workflows falham contra instância morta (ERR-3)

**Achado:** 459/1.213 execuções `failed` em 7d (37,8%), concentradas em 5 orgs: Motor100 (sessão congelada), 163874dd (node em instância Evolution extinta), DNA (zero instância — DEP-1), 17c46b69 (2/2 caídas). Todos os workflows seguem `is_active=true`, re-falhando toda janela de cron.

**Fix:**
1. Gate de pré-execução no `process-workflow-executions` com o predicado **certo**, espelhando `getWhatsAppInstance`: instância viva = `status IN ('open','connected') AND session_dead_since IS NULL` (NÃO `status='connected'`, que deixa Motor100 passar). Escopar a execuções com nodes de envio WhatsApp. Park como `status='paused', error='no_live_instance'` **com mecanismo de resume** (webhook/watchdog volta instância → despausa execuções da org) — sem resume, paused vira stranding pior que failed.
2. Fechar o buraco em `getWhatsAppInstance` (whatsapp-helpers.ts): quando o node pina `instanceId`, validar liveness da instância pinada com o mesmo predicado; se morta, cair pro fallback org-default. Isso elimina os 83 Evolution-404 da 163874dd sem tocar workflow nenhum.
3. Remediação por org (proporcional): Motor100 + Bertin = re-parear sessão (pendência CS); DNA + 17c46b69 = desativar (reversível) até re-parear; d7f78b22 = corrigir `image_url`; 589f6a52 = corrigir team member.

**Ganho:** itens 1+2 cobrem ~2/3 das falhas sem tocar workflow; meta `failed` < 5% em 7d pós-remediação completa. **Não** move a dimensão erros-rollbacks do DB (é operacional/negócio).

---

## Onda 2 — Features quebradas

### Slice 2.1 — /duplicados chama RPC inexistente (DUP-1)

**Achado:** `find_duplicate_leads` e `merge_leads`: 0 em `pg_proc`, 0 em migrations, chamadas com cast `as any`. `Duplicates.tsx` não lê o `error` → o PGRST202 vira "sem duplicatas". Há 245 leads excedentes por email (HGE 46, REALSC 36, Gráfica Cauta 32). Por telefone: 0 (unique parcial `idx_leads_org_phone_unique` já protege).

**Fix — Fase 1 (baixo risco):** migration cria `find_duplicate_leads(p_org_id uuid)` — **com parâmetro** — org-scoped + master-ghost (classe #784/#869), `SECURITY INVOKER`, match por email igual (determinístico) no shape `DuplicateGroup` que o front espera. Frontend: passar `organizationId`, tratar `error` (estado visível, não empty), `retry:false` pra PGRST202. Nome-similar (pg_trgm) fica pra fase posterior (falso-positivo + O(n²)).

**Fix — Fase 2 (redesenho antes de prod):** `merge_leads(p_keep, p_merge)` com (1) inventário das **49 FKs → leads** (catálogo `pg_constraint`, não 4 hardcoded); (2) estratégia de colisão pros uniques (`conversations` lead_id, `pipeline_entries`/`custom_pipe_entries` (pipeline,lead), `lead_tags` (lead,tag)); (3) coalesce de escalares; (4) perdedor via soft-delete (nunca hard-delete); (5) gate de permissão `admin`/`leads.manage`; (6) testes RLS admin/membro/master. Merge é **irreversível** (DROP FUNCTION só reverte a função, não os dados).

### Slice 2.2 — send_dedup_log nunca criada, camada fail-open (DUP-2)

**Achado:** `send_dedup_log` ausente em prod (migration `20260523000000` "never applied" — referenciava `auth.org_id()` inexistente). `send-dedup.ts:197` cai no fail-open. Só plugada em 3 action-handlers de workflow — **ausente em manual/copilot/mass-send**. Medido: 349 duplos manuais ≤10s/7d, 15 workflow. Motivação: incidente Bertin (12× "Oi Filipe!").

**Fix:**
0. **Pré-requisito:** redeploy de `process-workflow-executions` de main (bundle atual v99 é pré-#977, não chama o guard — sem isso a tabela é inerte). Investigar se o deploy de hoje ~18:45 UTC regrediu o executor.
1. Migration **nova** idempotente (`20270110000000_send_dedup_log_apply.sql`) — NÃO re-aplicar a colidida (ledger já a pula): `CREATE TABLE IF NOT EXISTS` + 2 uniques parciais + RLS via `get_my_organization_ids` (incluir policy `service_role FOR ALL` — service_role não bypassa RLS neste projeto) + cron cleanup 5min. Regen types.
2. Observar 48h logs `[send-dedup] BLOCKED` + falsos-positivos (janela workflow 300s pode skippar re-prompt legítimo).
3. Plugar `reserveSendOrSkip` no `whatsapp-api-proxy` com `source='manual'` (janela 10s) — retornar sinal visível ao composer (parte dos 349 pode ser repetição humana intencional), não skip mudo.

**Ganho:** elimina os duplos de workflow na hora; manuais após fase 3. Baseline sistêmico: 0,07%.

---

## Onda 3 — Efetividade de índices (write path vivo)

Método comum a todos: EXPLAIN dos consumidores antes, `DROP INDEX CONCURRENTLY` um a um via Management API (não roda em transação), migration commitada, verificação de `idx_scan` do gêmeo/substituto em 48h. Reversível recriando. Ganho é **write-amplification + RAM**, não latência de leitura.

### Slice 3.1 — whatsapp_messages 22→16 (IDX-1)

- **Fase 0 (criar 2 parciais que faltam):** `(instance_id, created_at DESC) WHERE direction='incoming'` (serve `whatsapp-health-monitor`, hoje 650-2.640 tup/scan) + `(instance_id, "timestamp" DESC) WHERE direction='outgoing'` (serve `enforceWhatsAppRateLimit`, hot path de todo envio).
- **Fase 1 (dropar 8 redundantes):** `idx_whatsapp_msgs_org_lead_dir`, `idx_whatsapp_messages_org`, `idx_whatsapp_messages_instance`⚠️, `idx_whatsapp_messages_direction`, `idx_whatsapp_msgs_org_inst_dir_ts`, `idx_whatsapp_msgs_convlist`, `idx_whatsapp_messages_sent_source`, `idx_whatsapp_messages_sent_by_ai`.
  - ⚠️ **VETO revisado:** `idx_whatsapp_messages_instance` tem 1,1M scans — o cético pediu manter; substituído pelo parcial outgoing da Fase 0 que cobre o rate-limit. Reavaliar com delta antes de dropar. **MANTER** `idx_whatsapp_msgs_org_dir_ts` (consumido por analytics engagement + useAgentMetrics).
- **Fase 2 (após 7-14d de delta):** reavaliar `idx_whatsapp_messages_timestamp` (⚠️ cron de retenção jobid 91 marca por timestamp — pode ser o consumidor) e `idx_whatsapp_messages_assigned_to`.
- **Mantém:** pkey, `message_id_instance_id_key` (dedupe), `org_lead`, `org_instance_ts`, `unread_cover`, `org_instance_phone`, `instance_jid_ts`, `normalized_phone`, `unprocessed`, `lead`, `phone`.

**Ganho:** ~380-410 MB líquidos, health-monitor/rate-limit viram range scan exato, INSERT mantém 16 btrees. Ganho no mean 30,8ms é **modesto** (dominado por 7 triggers síncronos — `fn_whatsapp_message_to_history` faz probe jsonb + `net.http_post` síncrono; follow-up separado).

### Slice 3.2 — Gêmeos + HNSW + unused + pipeline_entries (IDX-2/3/5, DUP-4)

- **16 pares** unique-constraint + índice manual gêmeo (ex.: `idx_rate_limits_key_window` 0 scans em tabela 2M upd; `idx_master_users_user_id` 298M scans migra pro `unique_master_user`). ⚠️ 3 têm `DESC` na 2ª coluna — rollback recria byte-idêntico COM o DESC.
- **3 índices HNSW** de embedding nunca escolhidos (corpus <709 linhas, filtro igualdade ganha): `idx_lead_memories_embedding`, `idx_doc_chunks_embedding`, `idx_faqs_embedding`. Documentar gatilho de recriação (~5-10K linhas/agent).
- **10 unused** reais (idade >60d + 0 leitor): `idx_workflow_execution_steps_node_id`, `idx_leads_not_shadow`, 3× `channel_messages`, 2× `watch_channels`, `idx_context_summary_last_message`, 3× `copilot_agents_routing_*`. ⚠️ **EXCLUIR** os 3× `pipeline_stage_events` (tabela de 07/jul, leitor `get_funnel_flow` pendente de migração de hooks).
- **`pipeline_entries`** tem 2 UNIQUE na mesma chave (`uq_..._pipeline_lead` total + `idx_..._pipeline_lead` parcial) — codificar a constraint no repo (passo idempotente) e dropar o parcial.

**Ganho:** menos manutenção dupla em tabelas quentes; baseline limpo. Dados em si: **0 duplicatas** reais em leads/telefone/pipeline.

### Slice 3.3 — Reset de baseline (ERR-1)

- `SELECT extensions.pg_stat_statements_reset()` — janela limpa pra medir gargalo vivo (pré-requisito da Onda 4). **NÃO** rodar `pg_stat_reset()` (zeraria `idx_scan`/`n_dead_tup`, destruindo a base de decisão dos índices e do autovacuum).
- Tabela `rollback_rate_snapshots(ts, xact_commit, xact_rollback)` + cron 5min + retenção 30d (policy `service_role FOR ALL`). Re-baselinar alerta após 7d (observado ~22-27 rb/min ≈ 2,1%). **Parar de usar** o rollback cumulativo (19%) como KPI — é fóssil benigno.

---

## Onda 4 — Frente A de RLS (projeto dedicado, SPEC próprio)

Detalhamento vira SPEC dedicado após Onda 3 (`.specs/features/db-optim-rls/`). Resumo da fatia (FA-01):

- **Custo concentra em ≤8 tabelas** (score = scans × policies-SELECT × 2-se-publicada): leads 477M, whatsapp_messages 194M, feature_permissions 147M, lead_tags 121M, pipelines 39M, pipeline_entries 28M, organizations/whatsapp_instances 24M, tags 17M. O lint de 2.349 `multiple_permissive` em 156 tabelas **superestima** — a alavanca está nessas 8.
- **RLS-01:** policies quentes chamam fns `SECURITY DEFINER` com arg de **linha** → avaliadas por linha (255M probes em `team_members_pkey` de 205 linhas). Reescrever como `col IN (SELECT fn())` (InitPlan, avaliado 1×). **Nunca** inlinar subquery em tabela com RLS (recursão do `apply_rls`); usar SRFs de arg-zero.
- **RLS-02 + decisão de produto (GATE bloqueante):** em `whatsapp_messages`, `select_org` (org-wide) subsome `select_by_responsibility` (que faz o probe caro). Hoje **qualquer membro lê todas as msgs da org** — regressão de `20260303000000` sobre feature de user-separation `20260128050000`, contradiz visibilidade restrita HGE/SORVFOODS. Perf inline zero-mudança vai já; a direção (org-wide vs restrito) é decisão do CTO → ADR.
- **RT-02 (publication diet):** 9 tabelas assinadas pelo frontend estão **fora** da publication (realtime morto silencioso: meetings, team_members, blast_plans, history_sync_jobs, custom_pipe_entries…). `meta_conversations` nem existe no `public` de prod — **Atendimento Meta quebrado**. Decidir por tabela: publicar (só se policies já usam `get_my_organization_ids`) ou remover a subscription morta.

**Slices propostas (SPEC próprio):** S1 whatsapp_messages (perf inline + decisão) · S2 leads (reescrita set-based das 4 fns per-row) · S2b initplan nos 7 `auth_rls_initplan` · S3 lead_tags+tags · S4 publication diet · S5 conversations+conversation_messages · S6 família restante. Gate por slice: `rls_check_access` admin/membro/master + perfil membro-restrito (classe HGE) + delta `pg_stat_statements` 48h. Estimativa honesta: **18-26h** (~metade do big-bang).

---

## Critérios de aceite (overall)

**Onda 0:**
- [ ] `has_function_privilege('anon'|'authenticated', <fn retenção>, 'execute') = false` nas 2 fns
- [ ] anon `.list('media')` → vazio/erro; `getPublicUrl` → 200; 6 fluxos logados OK em dev
- [ ] `CRON_SECRET` rotacionado; crons seguem `succeeded`
- [ ] advisor security sem os lints `*_security_definer_function_executable` das 2 fns e sem `public_bucket_allows_listing`

**Onda 1:**
- [ ] entrada DLQ < 300/dia; `dlq_replay_batch` sem erro; erros de webhook em `runtime_logs` ~zero
- [ ] decisão NatuPlast tomada e registrada (re-registrar ou confirmar saída) — 0 msg real dropada silenciosa
- [ ] workflow_executions `failed` < 5% em 7d

**Onda 2:**
- [ ] `/duplicados` lista os 245 grupos por email + mostra estado de erro (não empty state)
- [ ] `send_dedup_log` existe em prod, executor redeployado, path manual plugado; duplos workflow → 0

**Onda 3:**
- [ ] `whatsapp_messages` com 16 índices, −380 MB; delta `idx_scan` dos mantidos/novos verde em 48h
- [ ] 16 gêmeos + 3 HNSW + 10 unused + 1 dup pipeline_entries dropados, gêmeos absorvem volume
- [ ] `pg_stat_statements` resetado; `rollback_rate_snapshots` alimentado; baseline de 7d coletada

**Onda 4:** SPEC próprio (exit criteria por slice).

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Drop de índice regride leitura do chat | EXPLAIN dos consumidores antes; `idx_whatsapp_messages_instance` sob veto até delta; recriável em segundos |
| Denylist da DLQ esconde perda de msg real | Medir msgs reais dropadas ANTES de ligar; decisão NatuPlast é pré-requisito bloqueante |
| Gate de workflow vira stranding silencioso | `paused` obrigatoriamente com mecanismo de resume (watchdog despausa) |
| Migration `send_dedup_log` colide (classe conhecida) | Migration NOVA idempotente, não re-aplicar a `20260523000000`; ou `migration repair` antes |
| REVOKE de fn helper quebra RLS app-wide (ADV-3) | NÃO revogar as ~20 fns referenciadas em policies; só as 8 service-only, com verify por role |
| RLS-02 muda comportamento vivido desde março | Decisão de produto é GATE bloqueante da Onda 4; perf inline (zero-mudança) separada da decisão |
| Replay fresco recria índices dropados | Migration commitada com `DROP INDEX IF EXISTS` (gotcha #1009) |
| `service_role` sem policy quebra writer | Toda tabela nova com RLS inclui `service_role FOR ALL` (service_role não bypassa RLS neste projeto) |

---

## Decisões registradas (auditoria 2026-07-09)

| # | Decisão | Por quê |
|---|---|---|
| 1 | Priorizar por delta vivo, não média cumulativa | pgss fóssil de 5,5 meses; "chat/kanban lentos" são features mortas |
| 2 | Segurança antes de perf | Duas brechas provadas (anon-exec, bucket listável), custo baixo |
| 3 | Operacional antes de features | Mensagens reais sendo perdidas (NatuPlast) |
| 4 | Reset de stats como gate da Onda 4 | Medir ganho de RLS exige baseline limpa |
| 5 | Frente A fatiada, não big-bang | Custo concentra em ≤8 tabelas; slice mais barato = maior ganho |
| 6 | Não re-derivar FK-lint/bloat/fillfactor/rollback | Refutados com evidência (5 achados mortos pelo cético) |
| 7 | Índices via Management API + migration | Método #1009 validado; replay não recria |
| 8 | Visibilidade de chat = decisão de produto do CTO | RLS-02 é perf E política; separar os dois |

---

## Próximos passos imediatos

1. CTO aprova SPEC + escolhe ponto de arranque (recomendado: Onda 0, dev-first).
2. Decisão de negócio NatuPlast (Slice 1.1 pré-requisito).
3. Decisão de produto visibilidade de chat (gate da Onda 4) — pode ser tomada em paralelo.
4. Cortar `hotfix/db-sec-retention-fn-revoke` de main; aplicar dev → verify → prod com "vai".
5. Após Onda 3, escrever SPEC dedicado da Frente A (`.specs/features/db-optim-rls/`).
