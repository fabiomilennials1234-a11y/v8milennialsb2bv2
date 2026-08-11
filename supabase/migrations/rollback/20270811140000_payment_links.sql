-- Rollback de 20270811140000_payment_links.sql
--
-- ATENÇÃO — este rollback DESTRÓI PROPOSTA. `payment_links` guarda o preço
-- congelado de cada proposta enviada, e `payment_link_charges` guarda a amarra
-- com a cobrança no gateway. Derrubar as tabelas apaga as duas coisas, e o
-- link já enviado ao cliente deixa de resolver — sem possibilidade de
-- reconstrução, porque o token nunca foi guardado em lugar nenhum.
--
-- Só use enquanto a fatia estiver INERTE (nenhum link gerado). Depois disso, o
-- caminho é revogar os links pela função e deixar as tabelas de pé: revogação
-- é estado, e o histórico da proposta tem valor de auditoria.
--
-- As linhas em `master_audit_logs` ficam. Elas são o rastro de quem gerou e
-- revogou o quê, e apagá-las destruiria a auditoria justamente do que esta
-- fatia existe para registrar.

DROP FUNCTION IF EXISTS public.billing_attach_link_charge(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.billing_resolve_payment_link(text);
DROP FUNCTION IF EXISTS public.billing_revoke_payment_link(uuid, text);
DROP FUNCTION IF EXISTS public.billing_create_payment_link(text, uuid, text, uuid, integer, text, text, timestamptz);

DROP TABLE IF EXISTS public.payment_link_charges;
DROP TABLE IF EXISTS public.payment_links;
