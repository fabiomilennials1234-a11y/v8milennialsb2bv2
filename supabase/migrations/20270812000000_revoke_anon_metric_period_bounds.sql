-- 20270812000000_revoke_anon_metric_period_bounds.sql
--
-- Alinha o repo com produção e devolve o gate de pgTAP à cor certa.
--
-- O QUE ESTAVA ERRADO
--
-- `supabase/tests/metric_period_bounds_test.sql:79` afirma que anon NÃO executa
-- `metric_period_bounds`. Em prod isso é verdade — medido em 2026-08-11,
-- `has_function_privilege('anon', ...) = false`. No schema que o CI constrói a
-- partir de `supabase/migrations/`, é falso, e o teste reprova.
--
-- A causa está no próprio dump do baseline, que concede de forma explícita:
--
--   20260101000000_baseline_prod_schema.sql:43411
--     GRANT ALL ON FUNCTION "public"."metric_period_bounds"(...) TO "anon";
--
-- Produção revogou isso depois, numa migration que **não tem arquivo no repo**
-- — uma das 59 versões que estão no ledger de prod e não aqui (medido
-- 2026-08-11: prod 94 versões, repo 76 arquivos, 41 pendentes, 59 órfãs).
--
-- Portanto o teste nunca esteve errado. O repo é que constrói um schema mais
-- permissivo que o de produção, e o gate estava vermelho apontando para isso.
--
-- POR QUE OS DOIS REVOKES
--
-- A armadilha do grant tem duas metades independentes, e uma esconde a outra:
--
--   1. o grant NOMINAL, escrito no dump (`TO "anon"`) — só sai com
--      `REVOKE ... FROM anon`;
--   2. o grant herdado de PUBLIC, que `ALTER DEFAULT PRIVILEGES` distribui —
--      `REVOKE ... FROM anon` é NO-OP contra ele, e some só com
--      `REVOKE ... FROM PUBLIC`.
--
-- Revogar só um deixa `has_function_privilege` continuar `true` e dá a
-- impressão de que o REVOKE "não pegou". Os dois, nesta ordem.
--
-- `authenticated` e `service_role` mantêm o EXECUTE por grant explícito:
-- `metric_period_bounds` é chamada pelo motor e pelos leitores canônicos.
--
-- DDL PURA (guarda F4): nenhuma linha de dado é tocada.
--
-- ROLLBACK pareado: rollback/20270812000000_revoke_anon_metric_period_bounds.sql

REVOKE EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.metric_period_bounds(uuid, text, date, date, date) TO service_role;

-- ===========================================================================
-- GUARDA QUE ABORTA
-- ===========================================================================
-- Migration verde não prova nada: quem concede é o banco, no CREATE. Só
-- has_function_privilege fecha o item — e é exatamente a asserção que o pgTAP
-- faz, trazida para dentro do apply para o erro aparecer aqui, e não três
-- etapas depois.
DO $guard$
DECLARE
  v_fn regprocedure := 'public.metric_period_bounds(uuid, text, date, date, date)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon ainda executa % — uma das duas metades do grant sobrou', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu % — o motor e os leitores param', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role perdeu %', v_fn;
  END IF;
END
$guard$;
