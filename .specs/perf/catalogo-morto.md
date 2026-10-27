# Inventário de objetos mortos do schema (onda 5 do plano de RAM)

Data: 19/10/2026. Projeto `jsjsmuncfkbsbzqzqhfq`. Repo na `main` @ `be8596f67`.
**Só leitura. Nada foi removido, nenhuma migration de DROP criada.** Plano pai: `.specs/perf/ram-pool-postgrest/README.md` (branch `claude/supabase-high-ram-4bf64d`).

## Conclusão (leia primeiro)

1. **Objeto morto quase não custa RAM.** O backend do PostgREST só carrega no cache (relcache/catcache/plano de RLS) o que **toca**. Função sem chamador, tabela de backup e view sem consumidor nunca são tocadas, então aposentá-las não reduz o backend. O custo está nos objetos **vivos e pesados**: policies das tabelas quentes, índices (cada índice é uma entrada de relcache), triggers e views `private.*`.
2. **Tamanho real do catálogo** (bytes de linha em `pg_*`, não texto): `pg_proc` 2,31 MB · `pg_policy` 1,67 MB (o texto são só 133 KB; o resto é a árvore de parse) · `pg_attribute` 2,54 MB (4.318 colunas em tabelas `public`) · `pg_trigger` 0,62 MB. O corte seguro (51 funções órfãs) tira **58 KB de `pg_proc` (2,5%)**. Impacto por backend: ≈ 0 MB.
3. **A meta 60 → 20–30 MB não sai de aposentar objetos mortos.** Os lotes seguros dão, estimado, < 1–2 MB por backend (estimativa, não medida). Alavancas com ganho plausível, todas em área frágil ou de alto custo de verificação: (a) policies sobrepostas nas tabelas quentes (309 das 1.071 policies de `public` têm nome `master_ghost*`/`master_select_all*`/`strict_owner*`; 940 das 1.071 estão em tabelas tocadas); (b) 182 índices nunca usados em tabelas quentes + 21 duplicados; (c) as 71 views `private.*` do `strict_lead_owner`.
4. **Antes de qualquer corte da onda 5, medir de verdade**: em um backend do PostgREST, `pg_backend_memory_contexts` (`CacheMemoryContext` e filhos) depois de 30 min. Hoje isso é palpite. Do SQL Editor/Management API só se vê o backend da própria conexão; precisa de um `SET ROLE authenticated` + rodar as queries das telas quentes na mesma sessão, depois ler o contexto. Recomendo isso como pré-requisito dos lotes 4–6.
5. **Achado de segurança, fora do escopo de RAM:** 12 das 51 funções órfãs têm `EXECUTE` para `anon` (7 `SECURITY DEFINER`). Ver lote 0.

Janela de stats: `pg_stat_*` sem `stats_reset` registrado; banco no ar desde 05/10 15:55 UTC → ~14 dias. Rotinas mensais/trimestrais podem não ter rodado. Tabela com `seq_scan+idx_scan = 0` **não prova** ausência de uso por RPC `SECURITY DEFINER` (conta, mas só se houve execução na janela).
`pg_stat_user_functions` está vazio (`track_functions = none`), então **`calls = 0` por função não existe em prod**. Evidência de prod para funções = ausência de referência em `pg_proc.prosrc`, `pg_policy`, views, `cron.job`, defaults, CHECKs, índices, triggers, event triggers e `pg_stat_statements.query` (4.841 queries). Evidência de repo = `git grep -w` em `src/`, `classic/`, `supabase/functions/`, `services/`, `scripts/`, `tools/`, `cloudflare/`.

## Contagens em prod (schema → objetos)

| Tipo | Contagem |
|---|---|
| Funções | `public` 1.175 (1,73 MB prosrc) · `private` 31 · `realtime` 18 · `storage` 19 · `extensions` 56 · demais 30 |
| Tabelas (`r`) | `public` 363 · `auth` 27 · `backup` 11 · `realtime` 9 · `storage` 8 · demais |
| Views | `private` 71 · `public` 11 · `extensions` 2 |
| Índices | `public` 1.327 (4,76 GB) |
| Policies | `public` 1.071 · `storage` 19 · `cron` 2 |
| Triggers (não internos) | `public` 312 · `storage` 7 · `auth` 2 |
| Tabelas `public` tocadas na janela | 294 de 363; policies em tabelas tocadas: 940 |

## Candidatos

Risco: **B** baixo · **M** médio · **A** alto (RLS/multi-tenant/dinheiro/WhatsApp). Ganho de RAM estimado, não medido.

### Lote 0 — endurecer sem remover (REVOKE, reversível)
Não reduz RAM. Fecha superfície. Não é DROP.

| Objeto | Tipo | Evidência prod | Evidência repo | Risco |
|---|---|---|---|---|
| `cleanup_old_logs`, `generate_product_sku`, `generate_variant_sku`, `is_admin_or_closer`, `is_team_member`, `try_provision_lock` | RPC/helper, `EXECUTE` p/ `anon` | sem referência em prosrc/policy/view/cron/stmts; `is_team_member`, `try_provision_lock`, `is_admin_or_closer` são DEFINER | 0 em `src`/edge; só migrations | B |
| `enforce_feature_on_insert`, `sync_pipe_confirmacao_from_lead`, `tg_lead_origins_set_updated_at`, `trigger_create_default_stages`, `trigger_workflow_deal_created`, `validate_pipe_status` | função de trigger órfã, `EXECUTE` p/ `anon` | `pg_trigger.tgfoid` não aponta p/ elas | 0 em `src`/edge | B |

### Lote 1 — tabelas de backup/rascunho (17 relações; ~12 MB em disco + `media_dedup_plan` 52 MB)
Nunca tocadas em runtime → ganho de RAM ≈ 0; ganho é disco/higiene/superfície. 15 têm RLS ligado e 0 policies (ninguém lê); `dashboard_composition_backup` e `_lead_duplicates_audit` têm 1 policy e `SELECT` p/ `anon` e `authenticated` (RLS filtra).
Obs.: `n_live_tup=0` é enganoso aqui (ex.: `_bkp_c7e4ba84_messages` 3,1 MB). Fazer `SELECT count(*)` antes de decidir; guardar `pg_dump` se for apagar.

| Objeto | Evidência prod | Evidência repo | Risco |
|---|---|---|---|
| `_backup_bertin_20260608_pipe_entries`, `_backup_merge_agendamentos_milennials`, `_backup_stage_faxina_20260727`, `_backup_wf_executions_faxina_20260727`, `_backup_workflows_faxina_20260727` | 0 scan, 0 policy, 0 trigger, 0 FK | 0 em `src`/edge/scripts; só migrations de criação | B |
| `_bkp_c7e4ba84_{instance,messages,secrets,summary,workflows}`, `_bkp_lid_principal` | idem. **`_bkp_c7e4ba84_secrets` pode ter credencial**: apagar com prioridade | idem | B |
| `backup_aposenta_funis_carteira`, `backup_chique_oportunidades_20260729`, `pipeline_entries_revert_20260514`, `oraculo_legacy_usage_archive`, `dashboard_composition_backup`, `_lead_duplicates_audit`, `alinhamento_desfecho_b1` | idem (as 2 últimas com 1 policy) | 0 em `src`/edge | B |
| `media_dedup_plan` (52 MB, 2 índices) | 0 scan, 0 policy | 1 ref em edge fn (conferir; pode ser job de dedup de mídia) | M |

### Lote 2 — funções órfãs (51; 58 KB de `pg_proc`)
Critério: 0 referência em prod (todas as fontes acima) **e** 0 em `src/`, `classic/`, edge fns, `services/`, `scripts/`, `tools/`. Só aparecem em migrations (criação). Todas executáveis por `service_role`; 40 por `authenticated`.
Antes de cada DROP: `pg_depend` (view/policy/default dependente) e `grep` por chamada dinâmica (`rpc(\`...\`)`, nome montado). n8n não foi varrido (workflows moram fora do repo) — **verificar nodes HTTP/Postgres do n8n e o Make** antes do lote.

- **2a. Funções de trigger sem trigger (18), risco B:** `complete_step_first_sale`, `enforce_feature_on_insert`, `log_pipe_confirmacao_stage_change`, `log_pipe_propostas_stage_change`, `log_pipe_whatsapp_stage_change`, `sync_closer_to_lead_from_pipe`, `sync_dual_responsible_to_lead_from_pipe`, `sync_pipe_confirmacao_from_lead`, `sync_responsible_to_lead_from_pipe`, `sync_sdr_to_lead_from_pipe`, `tg_lead_origins_set_updated_at`, `trigger_create_default_stages`, `trigger_pipe_dispatch_rules`, `trigger_pipe_distribution`, `trigger_workflow_deal_created`, `trigger_workflow_proposal_result`, `trigger_workflow_stage_changed`, `validate_pipe_status`.
  Nota: `trigger_pipe_dispatch_rules`/`trigger_workflow_*` têm lógica de automação — confirmar que o gatilho foi substituído (workflows) e não só desligado por engano.
- **2b. Utilitários/seed/backfill/rollback de uso único (risco B):** `_fn_reseed_legacy_to_native_unchecked`, `cleanup_old_logs`, `fn_medicao_de_ruido`, `fn_pico_de_avisos_quentes`, `migrate_leads_to_contacts_companies`, `reconciliar_comissao_historica`, `purge_expired_rate_limits`, `generate_product_sku`, `generate_variant_sku`, `workflow_move_custom_entry_safely`.
- **2c. RPCs de negócio sem chamador (risco M — dinheiro/billing/permissão/WhatsApp, rubric de segurança):** `admin_set_purchased_addons`, `billing_get_link_customer`, `billing_upsert_link_buyer`, `increment_coupon_uses`, `process_overdue_subscriptions`, `sync_org_quotas_from_plan`, `org_check_limit`, `has_feature`, `is_admin_or_closer`, `is_team_member`, `master_add_user`, `master_remove_user`, `reset_onboarding_state`, `copilot_v2_next_turn`, `fn_publish_dashboard_page`, `invoke_process_webhook_deliveries`, `convert_pipe_rule_to_workflow`, `oraculo_admin_briefing_metrics`, `requeue_whatsapp_ingress_file_download`, `set_instance_reputation`, `set_whatsapp_edge_execution_mode`, `unlink_agent_from_instance`, `try_provision_lock`.
  `has_feature`, `is_team_member`, `is_admin_or_closer` são helpers de RLS clássicos: 0 uso hoje, mas 15 migrations citam `is_team_member`. Se alguma policy futura/rollback depender, quebra. Dropar por último.
- **2d. 16 funções com referência só em `scripts/`/`services/` (risco M, manter até confirmar que o script morreu):** `convert_campaign_rule_to_workflow`, `enqueue_whatsapp_receipt_recovery`, `finish_whatsapp_ingress_event_with_outcome`, `finish_whatsapp_receipt_recovery`, `fn_auto_assign_lead_default_pipe`, `fn_backfill_carteira_orders`, `fn_backfill_state_sales`, `fn_capture_meeting_event`, `fn_reetiqueta_funnel_streams`, `fn_rollback_carteira_backfill`, `fn_rollback_reetiqueta_funnel`, `link_agent_to_instance`, `read_guided_condition_trigger_business_stage`, `save_document_content`, `set_whatsapp_ingress_worker_pause`, `test_guided_condition_trigger_business_stage`.
- Os outros 115 itens do universo de 182 sem referência no banco **têm** chamador em `src/`/edge (RPC chamada pelo front): **não são mortos**.

### Lote 3 — índices duplicados (21 pares, 2 índices iguais por par)
Mesma tabela, mesmas colunas/classe/predicado. Dropar o **não-único** (ou o sem uso) e manter o `UNIQUE`/PK. Ganho: 21 entradas de relcache a menos nas tabelas que forem tocadas + escrita mais barata.

| Tabela | Manter | Candidato a DROP (scans) | Risco |
|---|---|---|---|
| `auth_rate_limits` | `…_ip_endpoint_key` (U) | `idx_auth_rate_limits_ip_endpoint` (0) | B |
| `client_health_snapshots` | `…_snapshot_date_key` (U, 87.813) | `idx_health_snapshots_client` (9) | B |
| `conversation_context_summary` | `unique_context_per_lead` (U) | `idx_conv_context_lead` (91.572) — o planner usa o não-único; trocar uso, medir | M |
| `conversation_messages` | `idx_conv_msgs_conv_created` (1.536) | `idx_conversation_messages_conv` (0) | B |
| `conversations` | `conversations_lead_id_key` (U) | `idx_conversations_lead_id` (76.269) — idem | M |
| `feature_catalog` | `feature_catalog_key_key` (U) | `idx_feature_flags_key` (5.367) | M |
| `gestores` | `gestores_user_id_key` (U, 0) | `idx_gestores_user_id` (12,9 M) — **manter o usado**, dropar o U só se não for constraint | M |
| `google_calendar_tokens` | `unique_user_calendar` (U) | `idx_google_calendar_tokens_user` (153 k) | M |
| `google_calendar_watch_channels` | `…_channel_id_key` (U) | `idx_watch_channels_channel_id` (79 k) — 1,3 MB | M |
| `lead_scores` | `lead_scores_lead_id_key` (U) | `idx_lead_scores_lead_id` (3.077) | B |
| `master_users` | `unique_master_user` (U) | `idx_master_users_user_id` (237 M scans) — RLS quente | M |
| `omie_connections`, `tinyerp_connections`, `toth_connections` | `unique_*_org` (U) | `idx_*_org*` (65 / 0 / 0) | B |
| `org_subscriptions` | `…_one_current_per_org` (U) | `idx_org_subscriptions_current` (182 k) | M |
| `organizations` | `organizations_slug_key` (U) | `idx_organizations_slug` (4) | B |
| `payment_history` | `…_asaas_payment_id_key` (U) | `idx_payment_history_asaas_payment` (0) | B |
| `pending_org_invites` | `…_email_key` (U) | `idx_pending_org_invites_email` (6.034) | B |
| `pipeline_entries` | `uq_pipeline_entries_deal_id` (U, 27 k) | `idx_pipeline_entries_deal` (196) — 2,4 MB | B |
| `tinyerp_order_mappings` | `…_upsell` (U) | `…_upsell_order_id` (55) | B |
| `whatsapp_instance_reap_queue` | `…_instance_id_key` (U) | `idx_wa_reap_instance` (2) | B |

Regra: onde o único tem 0 scans e o duplicado não-único tem milhões, o planner prefere o não-único por motivo de estatística/ordem. Dropar o não-único e deixar o único assumir exige `EXPLAIN` das queries quentes (`master_users`, `gestores`, `conversations`). Os de uso 0 e baixo são seguros.

### Lote 4 — índices nunca usados (337; 463 MB; 182 deles em tabelas quentes, 446 MB)
`idx_scan = 0`, sem constraint, não único/PK. Janela de 14 dias: pode haver índice de rotina rara (fim de mês, relatório). Gerar lista nominal por tabela na etapa de execução, cruzar com `EXPLAIN` das queries do `pg_stat_statements`, e dropar em lotes com `DROP INDEX CONCURRENTLY`. Risco M (regride query rara); reversível recriando o índice. Principal alavanca de relcache depois do lote 6.

### Lote 5 — tabelas sem scan e sem linha, **com** referência no código (feature não ligada, decisão de produto)
Não são "mortas" pela regra (há referência). Listadas para decisão do CTO; aposentar exige remover o código antes.

| Grupo | Tabelas (policies) | Ref `src`/edge | Obs. |
|---|---|---|---|
| Copilot V2 | `copilot_v2_{agents(2),config(2),knowledge(2),rubric(2),send_media(2),traces(3)}`, `…_{agent_media,dlq,knowledge_chunks,pause_state,trace_steps,turn_counters}`, `copilot_quote_{events,templates}`, `copilot_agent_audios(7)` | edge: 0–3 refs, front: 0–2 | memória: Copilot V3 em custódia, parar só se V3 > V1. Área frágil |
| Campanhas | `campanha_{dispatch_rules(6),dispatch_rule_steps(6),pipe_automations(6),stages(6),templates(4)}` | front 2–6, edge 0–14 (`campanha_stages`) | não mexer sem confirmar abandono |
| Comercial | `coupons(2)`, `coupon_redemptions(1)`, `payment_webhook_events(1)`, `approval_rules(3)`, `exchange_rates(2)`, `sms_provider_config(2)`, `emails(4)+1 trigger`, `deal_insights(3)`, `report_schedules(3)`, `webhook_dead_letters(3)`, `webhook_delivery_logs(3)`, `badges(6)` | variadas | `badges` 47 refs no front: falso morto (RPC/SELECT nunca na janela) |
| Zero ref em src/edge/scripts | `automation_webhooks(6 pol, 1 trg)`, `client_sidebar_permissions(6)`, `competitors(3)`, `data_retention_policies(1)`, `metric_catalog_{measure_styles,style_variants,widget_styles}(1 cada)`, `permission_audit_log(1; 30 linhas, 33 escritas)`, `quota_audit_log(2)`, `report_schedules(3)`, `deal_insights(3)` | 0/0 | aqui a evidência de repo concorda: candidatas a morta. **Confirmar** `permission_audit_log` (tem escrita) e `quota_audit_log` (auditoria, pode ser exigência) |

Triggers em tabelas sem scan (7): `automation_webhooks`, `campanha_dispatch_rules`, `copilot_quote_templates`, `dashboard_pages`, `emails`, `omie_connection_secrets`, `org_unit_economics_inputs` (1 cada). Caem junto com a tabela.

Views públicas sem referência em `src`/edge e em nenhuma outra view/função: `leads_compat`, `oraculo_profile_adoption_60d`, `unified_inbox_messages`, `v_cron_job_status`, `v_sale_events_negocio`. Risco B/M; checar painéis externos (Metabase/n8n). `pg_buffercache` (public) é wrapper de extensão — não mexer.

### Lote 6 — policies sobrepostas em tabelas quentes (RLS — rubric de segurança bloqueante)
Policies **idênticas** (mesmo comando, roles, USING e WITH CHECK): **0**. O problema é sobreposição semântica, não cópia. PERMISSIVE aplicáveis ao mesmo comando, pior caso:

| Tabela | SELECT | INS | UPD | DEL | Policies |
|---|---:|---:|---:|---:|---:|
| `help_articles` | 6 | 3 | 3 | 3 | 6 |
| `lead_history` | 4 | 5 | 3 | 4 | 11 |
| `google_calendar_events_cache` | 5 | 2 | 2 | 2 | 6 |
| `commissions` | 5 | 2 | 2 | 2 | 5 |
| `whatsapp_messages` | 4 | 4 | 3 | 2 | 9 |
| `conversations`, `whatsapp_conversations`, `acoes_do_dia`, `campanha_leads` | 4 | 2–3 | 2–3 | 2 | 8 |
| `conversation_summaries` | 5 (inclui `master_ghost_select_*`, `strict_owner_related_select`) | | | | 7 |
| `whatsapp_conversation_summary` | 5 | | | | 6 |
| `lead_custom_field_values` | 3 | 2 | 3 | 4 | 10 |

Candidato por padrão de nome: 309 policies `master_ghost_*`/`master_select_all_*`/`strict_owner_*`. Provável fonte do `strict_lead_owner` (memória: 103 views + `can_see_chat_scope`). **Não remover sem**: (1) mapa de qual role cada policy atende, (2) teste como `authenticated` com claims reais (memória `rls-test-as-authenticated-role`: `SET ROLE` sem claims não testa nada), (3) rubric `security-rubric`. Consolidar várias PERMISSIVE em uma só `OR` reduz o plano de RLS por tabela e é a alavanca de RAM mais provável deste inventário. Risco A.

## Estimativa de ganho

| Corte | Bytes de catálogo | Efeito por backend (estimativa) |
|---|---|---|
| Lote 2 (51 funções) | −58 KB `pg_proc` (2,5%) | ≈ 0 (nunca cacheadas) |
| Lote 1 (17 tabelas de backup) | 0 policy, 0 trigger, 0 índice (maioria) | ≈ 0 |
| Lote 3 (21 índices) | −21 de 1.327 relcache (1,6%) | < 0,3 MB, só se a tabela for tocada |
| Lote 4 (182 índices quentes) | −182 de 1.327 (13,7%) | ~0,5–1,5 MB (estimativa) |
| Lote 6 (consolidar policies) | até −300 de 1.071 policies (28%) | ~1–4 MB (estimativa; maior alavanca) |
| **Total plausível** | | **~2–6 MB de 60** — não chega em 20–30 MB |

Para o backend cair de 60 → 20–30 MB o ganho teria de vir de outro lugar (p.ex. reciclar backend: `db-pool-max-lifetime`, hipótese aberta 3 do plano pai; ou pool menor; ou o compute Large). Recomendação: **medir `CacheMemoryContext` por backend antes de gastar a onda 5**.

## Lotes de aposentadoria sugeridos (do mais seguro ao mais arriscado)

| Lote | Escopo | Risco | Pré-requisito |
|---|---|---|---|
| 0 | REVOKE `anon` das 12 funções órfãs | B | nenhum |
| 1 | Backups (17), começando por `_bkp_c7e4ba84_secrets` | B | `count(*)` + `pg_dump` |
| 2a | 18 funções de trigger órfãs | B | `pg_depend` limpo |
| 2b | 10 utilitários/backfill | B | varrer n8n/Make |
| 3 | Índices duplicados de uso 0 ou baixo (≈ 12 dos 21) | B | `EXPLAIN` nos quentes |
| 2c | RPCs de negócio órfãs | M | rubric; varrer n8n/Make/edge logs |
| 2d | 16 funções só de scripts | M | decidir destino dos scripts |
| 3b | Duplicados com planner dependente (`master_users`, `gestores`, `conversations`…) | M | `EXPLAIN ANALYZE` na branch efêmera |
| 4 | Índices nunca usados | M | janela maior que 14 dias + `EXPLAIN` |
| 5 | Tabelas/views sem ref em src/edge/scripts | M | decisão de produto |
| 6 | Consolidação de policies | A | rubric + teste como `authenticated` |

Todo DROP: migration cirúrgica em prod, ensaio transacional (memórias `aplicar-migration-cirurgica-em-prod`, `ensaio-transacional-contra-prod`), `DROP … IF EXISTS`, e conferir o ledger (funções de prod podem ser mais velhas que o repo; objetos de prod podem estar fora do repo).

## Limites desta auditoria
- Prod lido via MCP `execute_sql` do Supabase apenas com `SELECT` (o token da Management API não estava no ambiente; nenhuma escrita executada).
- `pg_stat_user_functions` vazio → sem `calls = 0` direto. Referência em corpo de função cobre `rpc()` interno, não chamada de rede externa (n8n, Make, Uazapi, integrações) — **não varridas**.
- `git grep -w` não pega nome montado dinamicamente.
- Janela de stats de 14 dias.
- Não inspecionei as 71 views `private.*` nem funções dos schemas `private`/`realtime`/`storage`.
