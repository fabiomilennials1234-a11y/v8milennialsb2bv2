-- ROLLBACK de 20270829000011_lead_comment_entry_coerente_revoga_anon.sql
--
-- ⚠️ ORDEM: rollback roda em ordem DECRESCENTE. Este é o PRIMEIRO do par —
-- rode-o ANTES de rollback/20270829000001_lead_comments_por_negocio.sql, que
-- dropa a própria função sobre a qual este arquivo faz GRANT. Invertido, este
-- morre com 42883 (a função já não existe).
--
-- CONSEQUÊNCIA CONHECIDA de rodar isto: devolve o EXECUTE de `anon` numa função
-- `SECURITY DEFINER`. Não abre caminho de dado — `prorettype` é `trigger` e o
-- Postgres recusa chamada direta com `0A000` —, mas devolve a divergência de
-- postura contra as outras duas funções-gatilho de `lead_comments`, e volta a
-- reprovar o item de grants do rubric de segurança.
--
-- Não há motivo real para rodar isto. Existe pelo pareamento do diretório.

GRANT EXECUTE ON FUNCTION public.fn_lead_comment_entry_coerente() TO anon;
