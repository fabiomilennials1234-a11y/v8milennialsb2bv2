---
type: reference
title: RPCs (Postgres Functions)
status: active
created: 2026-05-15
updated: 2026-06-30
tags: [reference, rpc, postgres, security-definer]
related: ["[[Schema]]", "[[RLS Policies]]", "[[Edge Functions]]", "[[Cron Jobs]]", "[[Env Vars]]"]
owner: gabriel
---

# RPCs — Reference

> Funções SQL em `public.*` (e algumas em `auth.*`) chamadas via
> `supabase.rpc('<nome>', { ... })` do frontend / edge functions, ou disparadas
> como **trigger** / **pg_cron**. Source-of-truth: `supabase/migrations/`.
> Hoje há **328 definições únicas** de função no schema (helpers + RPCs de
> negócio + triggers). Este doc é **catálogo por categoria** — para a assinatura
> exata, sempre ler a migration que cria/substitui a função.

## Como inspecionar

```sql
-- listar todas (público)
SELECT n.nspname AS schema, p.proname AS fn,
       p.prosecdef AS security_definer,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;
```

```bash
# achar a migration que define <fn>
grep -rilE "CREATE (OR REPLACE )?FUNCTION (public|auth)\.<fn>" supabase/migrations
```

Auditoria de hardening: torque-mcp `schema.audit_definer` (varre `prosecdef=true`
sem `search_path` pinado) e `schema.audit_triggers` (varre trigger fns
non-definer com call unqualified — ponto cego do anterior). Ver [[Edge Functions]]
torque-mcp e ADR 0011/0013.

## Convenção

```sql
CREATE OR REPLACE FUNCTION public.<nome>(arg type, ...)
RETURNS <type>
LANGUAGE plpgsql
SECURITY DEFINER                 -- ou INVOKER, conforme caso
SET search_path = public, extensions   -- pin obrigatório em DEFINER
AS $$
BEGIN
  -- checagem de auth/role/org (DEFINER bypassa RLS!)
  -- lógica
END;
$$;

GRANT EXECUTE ON FUNCTION public.<nome>(...) TO authenticated;  -- ou service_role
```

---

## Top ~25 — as mais usadas

Nome · 1-linha · **SD** = `SECURITY DEFINER` (sim/não).

### Multi-tenancy & permissões (3 camadas)
| Função | O que faz | SD |
|---|---|:--:|
| `get_my_organization_ids()` | orgs do usuário logado (via `team_members`); base de quase toda RLS | sim |
| `get_my_admin_organization_ids()` | orgs onde o usuário é admin | sim |
| `get_my_team_member_ids()` | ids de `team_members` do usuário (escopo de leads atribuídos) | sim |
| `is_master_user()` | usuário é master (shadow cross-org); pinada pelo hardening 20261227000000 | sim |
| `is_org_admin_or_master(org)` | admin da org **ou** master | sim |
| `has_role(org, role)` | usuário tem role na org (`admin`/`master`/`membro`) | sim |
| `has_feature_permission(...)` | resolução determinística da Feature Permission por org | sim |
| `has_feature(org, feature)` | feature habilitada no plano/flags da org | sim |
| `assert_org_access(org)` | guard cross-tenant — levanta exceção se a org não é acessível | sim |
| `resolve_org_for_rpc(p_org)` | resolve org-alvo de uma RPC permitindo branch master | sim |
| `can_view_lead(lead_id)` | usuário pode ver o lead (responsável/permissões/admin) | sim |

> ⚠️ As três `get_my_*` são **SECURITY DEFINER** de propósito: usar SEMPRE elas
> dentro de policies de outras tabelas. Subquery inline em `team_members` causa
> recursão infinita quando Realtime avalia `apply_rls()`. Ver [[RLS Policies]].

### WhatsApp secrets (service_role only)
| Função | O que faz | SD |
|---|---|:--:|
| `get_uazapi_credentials(p_instance_id)` | retorna token Uazapi de `whatsapp_instance_secrets` (RLS deny-all) | sim |
| `set_uazapi_credentials(p_instance_id, ...)` | grava/atualiza token Uazapi | sim |
| `get_whatsapp_conversation_list(...)` | lista de conversas + unread (read-from summary); tem branch master-ghost | sim |
| `mark_conversation_read(...)` | zera unread da conversa | sim |

### Leads API pública (`api_*`, integrações via API key)
| Função | O que faz | SD |
|---|---|:--:|
| `api_get_lead(...)` / `api_list_leads(...)` | leitura de lead(s) para integradores externos (autenticação por API key) | sim |
| `api_update_lead(...)` | update de campos do lead via API | sim |

### Leads bulk / lixeira
| Função | O que faz | SD |
|---|---|:--:|
| `bulk_delete_leads(...)` | soft-delete em lote; tem branch master + `p_organization_id` | sim |
| `get_trash_leads(p_org)` / `restore_lead(...)` | listar/restaurar leads da lixeira (master-ghost corrigido em 20261212000000) | sim |
| `get_stage_lead_ids(p_org, ...)` | ids de leads de um estágio (seleção de audiência de disparo) | **não** |

### Analytics / disparo / workflows
| Função | O que faz | SD |
|---|---|:--:|
| `get_dashboard_metrics(...)` | métricas do dashboard principal | sim |
| `get_analytics_overview_metrics(...)` | overview de analytics (família `get_analytics_*`) | sim |
| `master_get_org_sales_summary(p_org)` | resumo de vendas por org p/ tela master `/insights` (CAC/coorte) | sim |
| `fire_workflow_trigger(...)` | dispara avaliação de workflows a partir de evento de domínio | sim |
| `claim_workflow_executions(...)` | claim atômico de execuções pendentes (cron worker) | **não** |

---

## Catálogo por categoria

> Listagem por nome. SD não anotado aqui — confirmar na migration. A maioria dos
> helpers de auth/permissão é **DEFINER**; muitas RPCs de leitura paginada e de
> audiência de disparo são **INVOKER** (confiam em `get_my_*` + branch master).

### 1. Multi-tenancy / auth helpers
`get_my_organization_ids` · `get_my_admin_organization_ids` · `get_my_team_member_ids` · `get_my_org_ids` (alias legado) · `get_user_org_role` · `get_user_organization_id` · `user_belongs_to_organization` · `user_has_org_permission` · `is_master_user` · `is_org_admin_or_master` · `is_user_admin` · `is_admin_or_closer` · `is_team_member` · `is_user_responsible` · `is_user_responsible_in_any_pipe` · `is_responsible_in_same_org` · `is_campanha_member` · `is_campanha_viewer` · `has_role` · `has_feature` · `has_feature_permission` · `has_no_responsible` · `assert_org_access` · `resolve_org_for_rpc` · `lead_in_my_org` · `ensure_master_team_member` · `seed_member_org_role_permissions` · `save_team_member_permissions` · `sync_user_roles_from_team_members` · `handle_new_user`

### 2. Leads — acesso, CRUD, bulk, lixeira
`can_view_lead` · `can_delete_lead` · `can_see_lead_by_permissions` · `can_see_lead_by_team_member_permissions` · `create_lead_with_pipe` · `bulk_assign_leads` · `bulk_delete_leads` · `bulk_move_stage` · `bulk_tag_leads` · `restore_lead` · `restore_leads_bulk` · `get_trash_leads` · `purge_lead` · `log_lead_deletion` · `leads_derive_uf_from_ddd` · `normalize_br_mobile` · `snapshot_responsible_from_lead` · `get_stage_lead_ids` · `get_filtered_lead_ids` · `get_custom_filtered_lead_ids` · `get_carteira_lead_ids` · `get_pipeline_page` · `get_pipeline_stage_counts` · `fn_auto_assign_lead_default_pipe` · `tg_leads_adopt_orphan_messages`

> As 4 RPCs de audiência (`get_stage_lead_ids`, `get_filtered_lead_ids`,
> `get_custom_filtered_lead_ids`, `get_carteira_lead_ids`) ganharam
> `p_organization_id` + branch master em 20261228000000 — antes gateavam só
> `get_my_organization_ids()` e davam "Nenhum lead neste estágio" p/ master.

### 3. Leads API pública (`api_*`)
`api_get_lead` · `api_list_leads` · `api_lead_exists` · `api_lead_timeline` · `api_update_lead` · `api_add_lead_tags` · `api_remove_lead_tag` · `api_list_custom_fields` · `api_set_custom_fields` · `api_list_pipelines` · `api_list_tags` · `generate_api_key`

### 4. WhatsApp — secrets, instâncias, conversas
`get_uazapi_credentials` · `set_uazapi_credentials` · `get_meta_cloud_credentials` · `set_meta_cloud_credentials` · `can_manage_whatsapp_instances` · `can_user_write_instance` · `enforce_whatsapp_instance_limit` · `get_lead_write_instance` · `get_user_write_instance` · `set_instance_owner` · `link_agent_to_instance` · `unlink_agent_from_instance` · `get_whatsapp_conversation_list` · `mark_conversation_read` · `get_unread_counts` · `get_unread_total` · `soft_delete_whatsapp_conversation` · `search_messages` · `seed_conversation_read_state` · `normalize_whatsapp_conversation_phone` · `normalize_whatsapp_message_phone` · `resolve_message_lead_id` · `tg_whatsapp_conversation_summary` · `get_whatsapp_situation_candidates`

### 5. Copilot / IA
`can_manage_copilot` · `enforce_copilot_agent_limit` · `acquire_copilot_lock` · `claim_copilot_batch` · `cleanup_copilot_message_queue` · `notify_copilot_batch_processor` · `increment_conversation_turn` · `copilot_v` · `invoke_copilot_v` · `claim_pending_ai_actions` · `has_concurrent_ai_action` · `enforce_ai_state_transition` · `toggle_lead_ai` · `toggle_phone_ai` · `get_lead_ai_status` · `get_phone_ai_status` · `sync_ai_state_from_preferences` · `sync_lead_ai_to_preferences` · `clear_human_pause` · `fn_human_pause_on_manual_send` · `transfer_lead_to_human` · `check_oraculo_limit` · `record_oraculo_usage` · `master_set_copilot_disabled`

### 6. Master / admin ops
`master_add_user` · `master_remove_user` · `master_enable_feature` · `master_disable_feature` · `master_override_billing` · `master_set_copilot_disabled` · `master_get_org_sales_summary` · `admin_get_org_quota_summary` · `admin_reassign_meeting_credit` · `admin_reassign_sale_credit` · `admin_set_purchased_addons` · `admin_set_quota_adjustment`

### 7. Pipelines / stages (incl. triggers das views compat)
`create_default_pipelines` · `ensure_pipeline_display_config` · `trigger_create_default_stages` · `validate_pipe_status` · `pipe_whatsapp_insert_fn` · `pipe_whatsapp_update_fn` · `pipe_whatsapp_delete_fn` · `pipe_confirmacao_insert_fn` · `pipe_confirmacao_update_fn` · `pipe_confirmacao_delete_fn` · `pipe_propostas_insert_fn` · `pipe_propostas_update_fn` · `pipe_propostas_delete_fn` · `log_pipe_whatsapp_stage_change` · `log_pipe_confirmacao_stage_change` · `log_pipe_propostas_stage_change` · `set_pipeline_entry_stage_changed` · `update_stage_changed_at` · `enforce_closed_at_on_final_stage` · `handle_proposta_vendida` · `fn_resolve_active_stage_key` · `apply_stage_checklist` · `migrate_pipe_entries` · `sync_custom_pipe_to_entries` · `sync_custom_pipeline_to_pipelines` · `sync_entries_to_legacy_pipes` · `sync_legacy_pipe_to_entries` · `sync_pipeline_entry_to_lead_pipe_whatsapp` · `sync_pipe_confirmacao_from_lead` · `sync_closer_to_lead_from_pipe` · `sync_sdr_to_lead_from_pipe` · `sync_responsible_to_lead_from_pipe` · `sync_responsible_from_lead_to_pipes` · `sync_dual_responsible_to_lead_from_pipe` · `sync_canonical_assignment` (`fn_sync_canonical_assignment`)

### 8. Workflows
`claim_workflow_executions` · `fire_workflow_trigger` · `matches_workflow_trigger_config` · `resolve_wait_response` · `resolve_wait_response_by_phone` · `convert_campaign_rule_to_workflow` · `convert_pipe_rule_to_workflow` · `update_workflows_updated_at` · `trigger_workflow_lead_created` · `trigger_workflow_lead_assigned` · `trigger_workflow_stage_changed` · `trigger_workflow_pipeline_stage_changed` · `trigger_workflow_tag_added` · `trigger_workflow_field_changed` · `trigger_workflow_score_reached` · `trigger_workflow_meeting_confirmed` · `trigger_workflow_proposal_result` · `trigger_workflow_custom_pipe_entry` · `trigger_workflow_custom_pipe_stage_change` · `trigger_workflow_lead_added_to_campaign` · `trigger_workflow_lead_removed_from_campaign` · `trigger_workflow_campaign_completed` · `trigger_workflow_campaign_status` · `trigger_workflow_campaign_lead_replied` · `trigger_workflow_campaign_lead_no_reply`

### 9. Disparos / dispatch / campanhas / round-robin
`claim_campaign_dispatch_batch` · `claim_pipe_dispatch_batch` · `distribute_campaign_round_robin` · `distribute_pipe_round_robin` · `get_next_campaign_sdr` · `get_next_campaign_closer` · `get_next_pipe_sdr` · `get_next_pipe_closer` · `trigger_pipe_distribution` · `trigger_pipe_dispatch_rules` · `trigger_campanha_leads_dispatch_rules` · `trigger_pipeline_entries_dispatch` · `schedule_pipe_rule_steps_from_position` · `schedule_rule_steps_from_position` · `increment_blast_daily_usage` · `invoke_blast_plan_release` · `default_assigned_to_scheduled_msg`

### 10. Follow-up / candidatos / detecção
`get_followup_eligible_leads` · `find_leads_no_reply` · `get_proposal_no_reply_candidates` · `get_leads_no_response_from_lead` · `get_leads_not_confirmed` · `get_leads_team_no_response` · `get_meeting_reminder_candidates` · `get_dormant_winback_candidates` · `get_pending_meta_conversion_signals` · `queue_followup_reclassify` · `invoke_followup_reclassify` · `migrate_follow_ups_to_activities` · `trigger_whatsapp_response_detection` · `fn_capture_meeting_event`

### 11. Webhooks / enqueue / cron invokers
`enqueue_lead_webhooks` · `enqueue_follow_ups_webhooks` · `enqueue_acoes_do_dia_webhooks` · `enqueue_campaign_dispatch_webhooks` · `enqueue_pipe_whatsapp_webhooks` · `enqueue_pipe_confirmacao_webhooks` · `enqueue_pipe_propostas_webhooks` · `enqueue_whatsapp_messages_webhooks` · `enqueue_webhook_deliveries_for_org` · `invoke_process_webhook_deliveries` · `invoke_process_workflow_executions` · `invoke_process_outbound_dispatches` · `invoke_process_ai_actions` · `invoke_process_copilot_followups` · `invoke_process_followup_automations` · `invoke_process_scheduled_user_messages` · `invoke_pipe_rule_dispatch` · `invoke_campaign_rule_dispatch` · `invoke_event_dispatcher` · `invoke_mass_send_status` · `invoke_history_sync_worker` · `invoke_meta_conversion_dispatch` · `invoke_meta_leadgen_poll` · `invoke_refresh_meta_tokens` · `invoke_retry_dead_letter_jobs` · `invoke_whatsapp_dlq_replay` · `invoke_whatsapp_media_retry` · `invoke_whatsapp_health_monitor` · `invoke_whatsapp_session_watchdog` · `invoke_workflow_cron_triggers` · `invoke_cron_health_check`

> Família `invoke_*` = `pg_cron` → `pg_net` → edge function (auth `x-cron-secret`).
> Ver [[Cron Jobs]] e [[Edge Functions]].

### 12. Analytics / métricas / dashboards
`get_analytics_overview_metrics` · `get_analytics_commercial_metrics` · `get_analytics_engagement_metrics` · `get_analytics_financial_metrics` · `get_analytics_pipeline_metrics` · `get_analytics_utm_metrics` · `get_dashboard_metrics` · `get_funnel_health` · `get_funnel_health_stage_leads` · `get_pipeline_velocity` · `get_ranking_data` · `get_product_ranking` · `get_revenue_attribution` · `get_win_loss_analysis` · `get_split_ab_metrics` · `get_seller_activity_scores` · `get_segment_benchmark` · `get_mkt_origin_metrics` · `get_portfolio_clients` · `get_portfolio_trends` · `get_operations_overview` · `get_jobs_overview` · `get_usage_by_org` · `get_activities` · `get_agenda_events`

### 13. Billing / quotas / planos / cupons
`org_check_limit` · `org_get_features_and_limits` · `org_get_seat_usage` · `org_get_subscription_status` · `org_resolve_all_quotas` · `org_resolve_quota` · `sync_org_plan_quotas` · `sync_org_quotas_from_plan` · `process_overdue_subscriptions` · `set_pending_payment_on_signup` · `enforce_seat_limit` · `validate_coupon` · `increment_coupon_uses` · `_resolve_plan_base_for_resource` · `default_org_feature_flags` · `set_default_org_feature_flags`

### 14. Onboarding / demo / checklists
`advance_onboarding_state` · `reset_onboarding_state` · `auto_create_org_onb_prog` · `match_onboarding_templates` · `complete_step_add_member` · `complete_step_configure_copilot` · `complete_step_connect_whatsapp` · `complete_step_create_workflow` · `complete_step_first_sale` · `complete_step_import_lead` · `seed_demo_data` · `remove_demo_data`

### 15. Histórico / auditoria / atividades
`audit_table_change` · `log_activity` · `log_permission_change` · `log_sensitive_access` · `fn_email_to_history` · `fn_sms_to_history` · `fn_whatsapp_message_to_history` · `fn_lead_comment_mentions` · `fn_log_lead_comment_event` · `migrate_leads_to_contacts_companies`

### 16. Infra / rate-limit / locks / triggers utilitários
`check_rate_limit` · `purge_expired_rate_limits` · `try_provision_lock` · `check_cron_job_health` · `toggle_cron_job` · `mcp_exec_readonly_sql` · `increment` · `generate_product_sku` · `generate_variant_sku` · `set_updated_at` · `update_updated_at` · `update_updated_at_column` · `message_templates_updated_at` · `set_cal_cache_updated_at` · `update_stage_changed_at` · `trigger_google_calendar_sync` · `trigger_meeting_google_sync` · `__map_legacy_days`

---

## Gotchas

- **`SECURITY DEFINER` bypassa RLS.** Validar role/org dentro da função (via
  `assert_org_access` / `get_my_*` / `is_master_user`). Sem checagem = furo
  cross-tenant.
- **`search_path` pin obrigatório em DEFINER.** Migration 20261227000000 pinou
  58 funções em `public, extensions` (NÃO `''` — vide cicatriz `leads_uf`).
  Não pinar = privilege-escalation + erros classe 42883.
- **Triggers non-definer também quebram** se chamam função sem schema
  qualificado sob caller hardened (`search_path=''`) — caso `leads_derive_uf_from_ddd`
  → 42883 abortou delete de org inteira. `schema.audit_definer` NÃO pega isso;
  usar `schema.audit_triggers`.
- **Master-ghost é classe recorrente.** Helpers/RPCs que gateiam só por
  `get_my_organization_ids()` (escopo `team_members`) cegam o master (que não tem
  `team_member` ativo). Padrão de correção: branch `is_master_user()` +
  `p_organization_id`. Já corrigido em trash RPCs, conversation list, checklists,
  goals e nas 4 RPCs de audiência de disparo.
- **Drift repo↔prod.** `get_my_organization_ids` em prod pode estar SEM branch
  master (migration de raiz 20261033000000 não aplicada). Conferir com
  torque-mcp `migration.diff` antes de assumir paridade.
- **Overloads.** Múltiplas funções com mesmo nome + assinaturas diferentes
  confundem o caller. Consolidação feita 2026-05-12.
- **N8n body params** sempre strings — arrays viram JSON body ou normalizar na
  edge function.
