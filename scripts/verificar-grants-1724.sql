-- VERIFICAÇÃO DE GRANTS — #1724. Rodar CONTRA O ALVO DO APPLY, logo depois de
-- aplicar `20270903000030_blast_ciclo_de_entrega.sql`. Somente leitura.
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
-- Custou caro em 2026-07-29: `import_lead_into_custom_pipeline` subiu com o
-- revoke feito pela metade e ficou executável por `anon` por 40 segundos.
--
-- ESPERADO: anon=false, authenticated=false, service_role=true.
--
-- Qualquer outra coisa é BLOQUEANTE. `encerrar_entregas_vencidas` é
-- SECURITY DEFINER e escreve em `blast_plan_recipients` de TODAS as organizações
-- por desenho — ela não recebe parâmetro nenhum, então não há IDOR possível, mas
-- EXECUTE aberto significa que qualquer usuário logado pode disparar uma escrita
-- em massa no ledger de entrega de todos os tenants.

SELECT
  'encerrar_entregas_vencidas'                                                        AS funcao,
  has_function_privilege('anon',          'public.encerrar_entregas_vencidas()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.encerrar_entregas_vencidas()', 'EXECUTE') AS authenticated,
  has_function_privilege('service_role',  'public.encerrar_entregas_vencidas()', 'EXECUTE') AS service_role;

-- ─── E o job existe, com o agendamento certo ────────────────────────────────
-- Job fora do ledger é como o buraco entre os 53 de prod e os do repo se abriu.
-- ESPERADO: uma linha, `17 4 * * *`, active = true.

SELECT jobname, schedule, active, command
  FROM cron.job
 WHERE jobname = 'encerrar-entregas-vencidas';

-- ─── E a varredura NÃO encostou em ninguém no apply ─────────────────────────
-- A migration é só schema: nenhuma linha pode ter mudado de estado por causa
-- dela. ESPERADO: zero linhas em `unconfirmed` logo após o apply (o primeiro
-- tique do cron é que pode produzi-las, e só para quem passou dos 30 dias).

SELECT status, count(*)
  FROM public.blast_plan_recipients
 GROUP BY status
 ORDER BY status;
