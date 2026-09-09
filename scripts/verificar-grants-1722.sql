-- VERIFICAÇÃO DE GRANTS — #1722. Rodar CONTRA O ALVO DO APPLY, logo depois de
-- aplicar `20270824000000_blast_official_worker.sql`. Somente leitura.
--
-- POR QUE ISTO EXISTE, e por que a migration verde não substitui:
-- o grant é concedido pelo BANCO no momento do `CREATE`, não pelo seu SQL. Neste
-- projeto o EXECUTE chega por DOIS caminhos que se escondem um atrás do outro:
--
--   1. implícito, via PUBLIC — toda função nasce com EXECUTE TO PUBLIC, e um
--      `REVOKE FROM anon` sozinho é no-op (anon nunca teve grant próprio);
--   2. explícito, via ALTER DEFAULT PRIVILEGES — o projeto concede EXECUTE a
--      `anon` e `authenticated` NOMINALMENTE em toda função nova do schema
--      public, e um `REVOKE FROM PUBLIC` sozinho não toca nesses.
--
-- A migration revoga dos três e concede só a `service_role`. Esta consulta é o
-- que PROVA que funcionou.
--
-- Custou caro em 2026-07-29: `import_lead_into_custom_pipeline` subiu com o
-- revoke feito pela metade e ficou executável por `anon` por 40 segundos.
--
-- ESPERADO: anon=false, authenticated=false, service_role=true, nas DUAS linhas.
-- Qualquer outra coisa é bloqueante — `claim_blast_recipients` é SECURITY DEFINER
-- e devolve destinatários de TODAS as organizações por desenho.

SELECT
  'claim_blast_recipients'                                                          AS funcao,
  has_function_privilege('anon',          'public.claim_blast_recipients(int,int)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.claim_blast_recipients(int,int)', 'EXECUTE') AS authenticated,
  has_function_privilege('service_role',  'public.claim_blast_recipients(int,int)', 'EXECUTE') AS service_role
UNION ALL
SELECT
  'invoke_process_blast_recipients',
  has_function_privilege('anon',          'public.invoke_process_blast_recipients()', 'EXECUTE'),
  has_function_privilege('authenticated', 'public.invoke_process_blast_recipients()', 'EXECUTE'),
  has_function_privilege('service_role',  'public.invoke_process_blast_recipients()', 'EXECUTE');

-- Sobrecarga acidental: mais de uma assinatura com o mesmo nome faz o PostgREST
-- resolver por nome+argumentos e devolver PGRST202 — que a UI mostra como coluna
-- vazia, não como erro. `sig_count` tem de ser 1 nas duas.
SELECT p.proname, count(*) AS sig_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('claim_blast_recipients', 'invoke_process_blast_recipients')
GROUP BY p.proname;

-- E o job do cron existe uma vez só, com o nome versionado.
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'process-blast-recipients';
