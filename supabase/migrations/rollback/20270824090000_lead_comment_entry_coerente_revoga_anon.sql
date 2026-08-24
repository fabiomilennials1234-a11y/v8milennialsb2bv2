-- ROLLBACK de 20270824090000_lead_comment_entry_coerente_revoga_anon.sql
--
-- CONSEQUÊNCIA CONHECIDA de rodar isto: devolve o EXECUTE de `anon` numa função
-- `SECURITY DEFINER`. Não abre caminho de dado — `prorettype` é `trigger` e o
-- Postgres recusa chamada direta com `0A000` —, mas devolve a divergência de
-- postura contra as outras duas funções-gatilho de `lead_comments`, e volta a
-- reprovar o item de grants do rubric de segurança.
--
-- Não há motivo real para rodar isto. Existe pelo pareamento do diretório.

GRANT EXECUTE ON FUNCTION public.fn_lead_comment_entry_coerente() TO anon;
