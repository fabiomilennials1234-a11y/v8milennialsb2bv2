-- 20270204000000_pin_search_path_14_functions.sql
--
-- Fase 3 segurança (Dossiê DB). Pina search_path em 14 funções que ficaram de
-- fora do hardening #867 (20261227000000). Fecha o lint `function_search_path_mutable`.
--
-- Verificado 2026-07-08 (read-only): as 14 são SECURITY INVOKER (proconfig null),
-- e NENHUMA referencia schema net/cron/vault/auth/storage/graphql/pgmq/realtime
-- no corpo (regexp sobre prosrc = 0 matches). Todas as refs são public (tabelas,
-- tipo `vector` + operadores pgvector) ou extensions → cobertas por
-- `public, extensions` (+ pg_catalog implícito). Pin não muda lógica, não quebra
-- resolução. `ALTER FUNCTION ... SET` = catalog update, sem lock de tabela.
--
-- APLICADO EM PROD via execute_sql (autorização CTO na sessão). Registrar em
-- supabase_migrations.schema_migrations (version 20270204000000).

ALTER FUNCTION public.normalize_brazilian_phone(phone text)                                                                                     SET search_path = public, extensions;
ALTER FUNCTION public.normalize_br_mobile(digits text)                                                                                          SET search_path = public, extensions;
ALTER FUNCTION public.uf_from_ddd(p_digits text)                                                                                                SET search_path = public, extensions;
ALTER FUNCTION public.cleanup_old_logs(days_to_keep integer)                                                                                    SET search_path = public, extensions;
ALTER FUNCTION public.create_default_pipeline_stages(org_id uuid)                                                                               SET search_path = public, extensions;
ALTER FUNCTION public.default_org_feature_flags()                                                                                               SET search_path = public, extensions;
ALTER FUNCTION public.generate_product_sku(p_organization_id uuid, p_type text)                                                                 SET search_path = public, extensions;
ALTER FUNCTION public.generate_variant_sku(p_organization_id uuid, p_parent_sku text)                                                           SET search_path = public, extensions;
ALTER FUNCTION public.claim_pending_ai_actions(batch_size integer, per_org_cap integer)                                                         SET search_path = public, extensions;
ALTER FUNCTION public.claim_workflow_executions(batch_size integer, per_org_cap integer)                                                        SET search_path = public, extensions;
ALTER FUNCTION public.matches_workflow_trigger_config(p_trigger_type text, p_config jsonb, p_context jsonb)                                      SET search_path = public, extensions;
ALTER FUNCTION public.match_document_chunks(query_embedding vector, agent_id_filter uuid, match_count integer, similarity_threshold double precision) SET search_path = public, extensions;
ALTER FUNCTION public.match_faqs(query_embedding vector, agent_id_filter uuid, match_count integer, similarity_threshold double precision)            SET search_path = public, extensions;
ALTER FUNCTION public.match_lead_memories(query_embedding vector, lead_id_filter uuid, match_count integer, similarity_threshold double precision)    SET search_path = public, extensions;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- ALTER FUNCTION ... RESET search_path;  (por função, se necessário)
