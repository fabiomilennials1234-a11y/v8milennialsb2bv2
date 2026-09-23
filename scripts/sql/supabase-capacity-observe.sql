-- Read-only capacity snapshot. Run before release and at comparable intervals.
-- Catalog/statistics only: no application-table scans, EXPLAIN ANALYZE, reset,
-- maintenance or customer content. Statement counters are cumulative, not p95.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT now() AS observed_at,
       current_database() AS database_name,
       pg_database_size(current_database()) AS database_bytes,
       (SELECT stats_reset FROM pg_stat_database
        WHERE datname = current_database()) AS database_stats_reset,
       (SELECT stats_reset FROM extensions.pg_stat_statements_info)
         AS statement_stats_reset;

SELECT now() AS observed_at, s.relid, s.relname,
       pg_table_size(s.relid) AS table_bytes,
       pg_indexes_size(s.relid) AS index_bytes,
       pg_total_relation_size(s.relid) AS total_bytes,
       s.n_live_tup, s.n_dead_tup, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
       s.n_mod_since_analyze, s.last_autoanalyze, s.last_autovacuum
FROM pg_stat_user_tables s
WHERE s.schemaname = 'public'
  AND s.relname IN ('whatsapp_messages', 'runtime_logs',
                   'whatsapp_conversation_summary', 'conversation_read_state');

SELECT now() AS observed_at, s.indexrelid, s.relname, s.indexrelname,
       pg_relation_size(s.indexrelid) AS index_bytes,
       s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
       x.indisunique, x.indisprimary, x.indisvalid, x.indisreplident,
       pg_get_indexdef(s.indexrelid) AS definition,
       (SELECT string_agg(c.conname, ', ' ORDER BY c.conname)
        FROM pg_constraint c WHERE c.conindid = s.indexrelid) AS constraints
FROM pg_stat_user_indexes s
JOIN pg_index x ON x.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.relname IN ('whatsapp_messages', 'runtime_logs')
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- Exact structural matches only. A match is a review candidate, never automatic
-- permission to drop: inspect constraints, dependencies and replica identity.
SELECT a.indexrelid::regclass AS index_a, b.indexrelid::regclass AS index_b
FROM pg_index a
JOIN pg_index b ON a.indrelid = b.indrelid AND a.indexrelid < b.indexrelid
JOIN pg_class ca ON ca.oid = a.indexrelid
JOIN pg_class cb ON cb.oid = b.indexrelid
WHERE a.indrelid IN ('public.whatsapp_messages'::regclass, 'public.runtime_logs'::regclass)
  AND ca.relam = cb.relam
  AND a.indisvalid AND b.indisvalid
  AND a.indisunique = b.indisunique
  AND a.indnullsnotdistinct = b.indnullsnotdistinct
  AND a.indnkeyatts = b.indnkeyatts AND a.indnatts = b.indnatts
  AND a.indkey = b.indkey AND a.indclass = b.indclass
  AND a.indcollation = b.indcollation AND a.indoption = b.indoption
  AND a.indpred::text IS NOT DISTINCT FROM b.indpred::text
  AND a.indexprs::text IS NOT DISTINCT FROM b.indexprs::text;

-- Do not export query text: it can contain literals or operational secrets.
-- queryid+dbid+userid+toplevel identify counters across comparable snapshots.
WITH rpc_names(name) AS (
  VALUES ('get_whatsapp_conversation_list_multi'),
         ('get_conversations_awaiting_human_reply'),
         ('get_whatsapp_unread_count_multi')
)
SELECT now() AS observed_at, n.name, s.queryid, s.dbid, s.userid, s.toplevel,
       s.calls, s.total_exec_time, s.mean_exec_time, s.max_exec_time,
       s.rows, s.shared_blks_hit, s.shared_blks_read,
       s.temp_blks_read, s.temp_blks_written
FROM extensions.pg_stat_statements s
JOIN rpc_names n ON position(n.name IN s.query) > 0
WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY s.total_exec_time DESC;

ROLLBACK;
