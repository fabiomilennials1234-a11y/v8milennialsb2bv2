-- 20261119000013_whatsapp_index_cleanup_and_support.sql
--
-- V3 reform — índices de whatsapp_messages. APLICADO EM PROD via execute_sql
-- (CONCURRENTLY não roda dentro de transação/migration normal). Este arquivo
-- documenta o que foi feito + serve para dev/fresh-apply. Já registrado em
-- supabase_migrations.schema_migrations (version 20261119000013).
--
-- Para aplicar manualmente: rodar cada statement isolado, fora de transação.

-- ── TIER 1: drop de índices ociosos (idx_scan=0 em janela longa pré-restart) ──
-- Recupera ~24MB + alivia o write-path (tabela write-hot via webhook).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_pinned;        -- 8 KB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_received_via;  -- 1.8 MB
DROP INDEX CONCURRENTLY IF EXISTS public.idx_whatsapp_messages_groups;        -- 22 MB
-- NÃO dropar idx_whatsapp_messages_search_tsv (GIN 23MB) — backing de
-- search_messages (useMessageSearch.ts), feature shippada.

-- ── Índices de suporte das RPCs V3 (20261119000012) ──────────────────────────
-- Lista de conversas (skip-scan + LATERAL última msg por phone):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_msgs_convlist
  ON public.whatsapp_messages (organization_id, instance_id, normalized_phone, "timestamp" DESC)
  WHERE deleted_at IS NULL;   -- ~59MB

-- Unread (count incoming por org+instance, covering normalized_phone):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_msgs_unread_cover
  ON public.whatsapp_messages (organization_id, instance_id, "timestamp" DESC)
  INCLUDE (normalized_phone)
  WHERE direction = 'incoming' AND deleted_at IS NULL AND is_group = false;   -- ~18MB

-- Resultado medido em prod (org 636776d8 / instance 49437977, 795 phones):
--   get_whatsapp_conversation_list: 2906ms → 499ms (~6x)
--   get_unread_total:               3049ms → 118ms (~26x)
