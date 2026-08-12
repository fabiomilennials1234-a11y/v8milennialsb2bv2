-- Rollback de 20270812185700_payment_link_buyers_legal_name_comment.sql
--
-- Devolve o comentário da coluna ao estado em que a 20270812111845 o deixou:
-- INEXISTENTE. `COMMENT ... IS NULL` é a forma de remover comentário no
-- Postgres — não há `DROP COMMENT`.
--
-- Reverter aqui não tem custo de schema nem de dado. O custo é de LEITURA: o
-- próximo a olhar `legal_name` volta a ver um nome que sugere "razão social",
-- que é dado público, quando metade das linhas guarda nome civil de pessoa
-- física. Foi exatamente essa leitura que quase deixou a coluna fora da redação
-- de PII do logger.

COMMENT ON COLUMN public.payment_link_buyers.legal_name IS NULL;
