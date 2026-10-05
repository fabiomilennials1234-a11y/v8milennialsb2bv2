-- whatsapp-messages-index-snapshot.sql
--
-- Snapshot diário (23:00 UTC) do protocolo de 7 dias dos índices de
-- whatsapp_messages. Protocolo: .specs/perf/whatsapp-messages-indexes/README.md
--
-- SÓ LEITURA. Só views de estatística e catálogo — nunca count(*) na tabela.
-- Sai UMA linha JSON; salvar como snap-AAAA-MM-DD.json:
--
--   psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
--     -f scripts/perf/whatsapp-messages-index-snapshot.sql \
--     > .specs/perf/whatsapp-messages-indexes/snap-$(date -u +%F).json
--
-- (ou colar no MCP execute_sql e salvar o valor de `snapshot`.)
--
-- Contadores de pg_stat_* zeram em restart. `meta.postmaster_start` identifica
-- o segmento: a análise soma deltas DENTRO de cada segmento, nunca subtrai
-- através de um restart.

SET statement_timeout = '15s';

SELECT json_build_object(
  'meta', json_build_object(
    'taken_at',          now(),
    'postmaster_start',  pg_postmaster_start_time(),
    'stats_reset',       (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()),
    'server_version',    current_setting('server_version'),
    'pgss_stats_reset',  (SELECT stats_reset FROM pg_stat_statements_info)
  ),

  -- Q1 — uso por índice nas 3 tabelas (last_idx_scan existe desde o PG16).
  'q1_index_usage', (
    SELECT json_agg(json_build_object(
      'table',         s.relname,
      'index',         s.indexrelname,
      'indexrelid',    s.indexrelid,
      'idx_scan',      s.idx_scan,
      'idx_tup_read',  s.idx_tup_read,
      'idx_tup_fetch', s.idx_tup_fetch,
      'last_idx_scan', s.last_idx_scan,
      'size_bytes',    pg_relation_size(s.indexrelid),
      'is_unique',     i.indisunique,
      'is_valid',      i.indisvalid,
      'def',           pg_get_indexdef(s.indexrelid)
    ) ORDER BY s.relname, s.indexrelname)
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.schemaname = 'public'
      AND s.relname IN ('whatsapp_messages', 'whatsapp_conversation_summary', 'whatsapp_conversations')
  ),

  -- Q2 — escrita e HOT de whatsapp_messages.
  'q2_table_writes', (
    SELECT json_build_object(
      'n_tup_ins',         t.n_tup_ins,
      'n_tup_upd',         t.n_tup_upd,
      'n_tup_hot_upd',     t.n_tup_hot_upd,
      'n_tup_newpage_upd', t.n_tup_newpage_upd,
      'n_dead_tup',        t.n_dead_tup,
      'n_live_tup',        t.n_live_tup,
      'autovacuum_count',  t.autovacuum_count,
      'last_autovacuum',   t.last_autovacuum,
      'heap_bytes',        pg_relation_size(t.relid),
      'toast_bytes',       COALESCE(pg_relation_size(c.reltoastrelid), 0),
      'indexes_bytes',     pg_indexes_size(t.relid),
      'reloptions',        c.reloptions
    )
    FROM pg_stat_user_tables t
    JOIN pg_class c ON c.oid = t.relid
    WHERE t.schemaname = 'public' AND t.relname = 'whatsapp_messages'
  ),

  -- Q3 — custo de cache por índice.
  'q3_index_io', (
    SELECT json_agg(json_build_object(
      'table',         relname,
      'index',         indexrelname,
      'idx_blks_read', idx_blks_read,
      'idx_blks_hit',  idx_blks_hit
    ) ORDER BY relname, indexrelname)
    FROM pg_statio_user_indexes
    WHERE schemaname = 'public'
      AND relname IN ('whatsapp_messages', 'whatsapp_conversation_summary', 'whatsapp_conversations')
  ),

  -- Q4 — INSERT/UPDATE em whatsapp_messages (pg_stat_statements). O PostgREST
  -- embrulha em `WITH pgrst_source AS (UPDATE "public"."whatsapp_messages" …`,
  -- então o padrão não é ancorado no início (conferido em prod, 2026-10-05).
  'q4_write_statements', (
    SELECT json_agg(json_build_object(
      'queryid',                  queryid,
      'calls',                    calls,
      'mean_ms',                  round(mean_exec_time::numeric, 3),
      'max_ms',                   round(max_exec_time::numeric, 3),
      'wal_bytes_per_call',       round(wal_bytes / NULLIF(calls, 0), 1),
      'shared_blks_dirtied_per_call', round(shared_blks_dirtied::numeric / NULLIF(calls, 0), 2),
      'query',                    left(query, 300)
    ) ORDER BY calls DESC)
    FROM pg_stat_statements
    WHERE query ~* '(insert\s+into|update)\s+("?public"?\.)?"?whatsapp_messages"?(\s|\()'
  )
) AS snapshot;
