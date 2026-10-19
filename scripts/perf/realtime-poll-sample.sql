-- Amostra do custo do Realtime postgres_changes (poll do WAL) + do Broadcast.
-- Só leitura. Rodar 2× com ~60 min de intervalo, no expediente (12–21 UTC), e
-- subtrair: calls/min e ms/min do poll são a régua da migração para Broadcast.
-- Spec: .specs/perf/realtime-broadcast/S1.md ("Medição").
SELECT json_build_object(
  'at', now(),
  'stats_reset', (SELECT stats_reset FROM pg_stat_statements_info),
  -- O poll do postgres_changes: apply_rls por evento × assinante.
  'poll', (SELECT json_build_object('calls', sum(calls), 'total_ms', round(sum(total_exec_time)), 'mean_ms', round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 2))
             FROM pg_stat_statements WHERE query ILIKE 'select wal->>%'),
  -- Join de assinatura do postgres_changes (churn de canal).
  'sub_join', (SELECT json_build_object('calls', sum(calls), 'total_ms', round(sum(total_exec_time)))
                 FROM pg_stat_statements WHERE query ILIKE 'with sub_tables%'),
  'banco_total_ms', (SELECT round(sum(total_exec_time)) FROM pg_stat_statements),
  -- Assinaturas vivas por tabela (pipeline_entries deve cair nas orgs piloto).
  'subs', (SELECT json_object_agg(t, n) FROM (SELECT entity::text AS t, count(*) AS n FROM realtime.subscription GROUP BY 1) s),
  -- Broadcast: mensagens publicadas na última hora por tópico de tabela.
  'broadcast_1h', (SELECT json_object_agg(sfx, n) FROM (
      SELECT split_part(topic, ':', 3) AS sfx, count(*) AS n
        FROM realtime.messages
       WHERE extension = 'broadcast' AND topic LIKE 'org:%' AND inserted_at > (now() AT TIME ZONE 'utc') - interval '1 hour'
       GROUP BY 1) b),
  -- Orgs com o piloto ligado.
  'orgs_pe', (SELECT json_agg(id) FROM public.organizations WHERE feature_flags @> '{"realtime_broadcast_pe": true}')
) AS amostra;
