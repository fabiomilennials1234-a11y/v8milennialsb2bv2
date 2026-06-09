-- 20261119000020_optimizations_indexes_realtime_settings.sql
--
-- Otimizações (backlog re-análise). Aplicado em prod (jsjsm) 2026-06-09.
-- Partes migration-safe abaixo; as CONCURRENTLY foram operacionais (não rodam em txn).
--
-- ── Índices mortos dropados (CONCURRENTLY, operacional) ──────────────────────
--   idx_whatsapp_messages_search_tsv  (GIN 27MB, 0 scans/183d, search_messages 0 calls
--     — busca textual nunca usada; o GIN recomputava tsvector a CADA insert na hot table)
--   idx_whatsapp_messages_org_timestamp_direction (66MB, 202 scans, redundante c/
--     idx_whatsapp_msgs_org_inst_dir_ts). Total ~93MB + alívio de escrita.
--
-- ── FK indexes criados (CONCURRENTLY, operacional) — 11 hot FKs sem cobertura ──
--   lead_tags(tag_id), follow_ups(lead_id), follow_ups(assigned_to) WHERE not null,
--   leads(sdr_id) WHERE not null, leads(closer_id) WHERE not null,
--   team_members(user_id), campanha_leads(lead_id), campanha_leads(campanha_id),
--   conversations(agent_id) WHERE not null, whatsapp_media_jobs(instance_id),
--   whatsapp_media_jobs(organization_id). Acelera JOINs + remove lock O(n) em
--   DELETE de parent.

-- ── Realtime: remover 5 tabelas mortas (0 live/0 DML/sem subscription) ────────
-- NÃO mexer em activities/upsell_gestao_rules: 0 linhas MAS têm useRealtimeSubscription
-- no front (features dormentes) — quebraria ao ativar.
ALTER PUBLICATION supabase_realtime DROP TABLE
  public.deals, public.companies, public.contacts, public.commissions, public.user_badges;

-- ── work_mem + autovacuum nas hot tables bloated ─────────────────────────────
-- RAM ~2GB (eff_cache 1536MB): 8MB é seguro (16MB x 90 conns arriscaria OOM).
ALTER DATABASE postgres SET work_mem = '8MB';
ALTER TABLE public.automation_jobs      SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.leads                SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.conversations        SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
ALTER TABLE public.whatsapp_webhook_dlq SET (autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05);
