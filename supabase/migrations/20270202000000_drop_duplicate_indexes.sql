-- 20270202000000_drop_duplicate_indexes.sql
--
-- Higiene de índices (Frente D do Dossiê DB — Saúde e Roadmap). Remove 7 índices
-- byte-idênticos ao seu gêmeo na mesma tabela/colunas. O planner usa o gêmeo
-- sobrevivente de forma transparente → ZERO mudança de comportamento/plano.
--
-- APLICADO EM PROD via execute_sql com CONCURRENTLY (não roda em transação/
-- migration normal). Este arquivo documenta o que foi feito + serve de runbook.
-- Registrar em supabase_migrations.schema_migrations (version 20270202000000)
-- após aplicar. Para aplicar manualmente: rodar cada statement isolado, fora de
-- transação.
--
-- Segurança verificada (2026-07-08, read-only + review adversarial 7 agentes):
--   * Todos: is_unique=false, is_primary=false, is_valid=true, backing NENHUM
--     constraint, definição idêntica ao gêmeo mantido.
--   * Nenhuma referência de código/ORM/pg_hint_plan/REINDEX ao nome dropado.
--   * Único caveat (não-bloqueante): os pares nascem de migrations distintas que
--     fazem CREATE INDEX IF NOT EXISTS com nomes diferentes nas mesmas colunas —
--     um replay de DB fresco recria o dup. Fix durável (consolidar os CREATEs)
--     pertence ao projeto de migration-consolidation, fora do escopo desta.
--
-- Mantido (mais usado)                     | Dropado (gêmeo redundante)          | scans keep/drop
-- ─────────────────────────────────────────┼──────────────────────────────────────┼────────────────
-- idx_agent_decision_logs_conv             | idx_agent_logs_conv                  | 187 / 9
-- idx_api_logs_recent                      | idx_api_logs_key_time                | 4 / 0
-- idx_conv_context_lead                    | idx_context_summary_lead             | 1.026.245 / 638
-- idx_conv_msgs_conv_created               | idx_conversation_msgs_conv_created   | 48.719 / 0
-- idx_conversations_lead_id                | idx_conversations_lead               | 71.059 / 756
-- idx_copilot_evals_conversation           | idx_evaluations_conversation_id      | 177 / 0
-- idx_leads_org_created_desc               | idx_leads_org_created                | 586.653 / 6.079

DROP INDEX CONCURRENTLY IF EXISTS public.idx_agent_logs_conv;                 -- agent_decision_logs (conversation_id) — 112 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_api_logs_key_time;              -- api_request_logs (api_key_id, created_at DESC) — 8 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_context_summary_lead;          -- conversation_context_summary (lead_id) — 88 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_conversation_msgs_conv_created; -- conversation_messages (conversation_id, created_at) — 776 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_conversations_lead;            -- conversations (lead_id) — 88 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_evaluations_conversation_id;   -- copilot_conversation_evaluations (conversation_id) — 56 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_org_created;             -- leads (organization_id, created_at DESC) — 1696 KB

-- ── ROLLBACK (operacional, CONCURRENTLY fora de txn) ─────────────────────────
-- Recria byte-idêntico o índice dropado (o gêmeo mantido nunca some, então isto
-- só reintroduz a redundância — usar apenas se algum plano regredir, o que não
-- deve ocorrer com índices idênticos):
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_logs_conv ON public.agent_decision_logs USING btree (conversation_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_logs_key_time ON public.api_request_logs USING btree (api_key_id, created_at DESC);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_context_summary_lead ON public.conversation_context_summary USING btree (lead_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversation_msgs_conv_created ON public.conversation_messages USING btree (conversation_id, created_at);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_lead ON public.conversations USING btree (lead_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evaluations_conversation_id ON public.copilot_conversation_evaluations USING btree (conversation_id);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_org_created ON public.leads USING btree (organization_id, created_at DESC);
