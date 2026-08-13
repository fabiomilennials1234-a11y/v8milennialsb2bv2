-- ROLLBACK de 20270812000000_revoke_anon_metric_period_bounds.sql
--
-- Devolve a `metric_period_bounds` o grant que o dump do baseline dava a anon.
--
-- ⚠ Rodar isto reabre o acesso anônimo à função. Ele existe para simetria e
-- para que o par migration↔rollback continue completo, não porque voltar seja
-- desejável: produção já roda SEM esse grant desde antes desta migration, e é o
-- repo que estava divergindo. Se o objetivo for reverter o gate de pgTAP, o
-- caminho é discutir o teste, não reconceder EXECUTE a anon.

GRANT EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) TO anon;
