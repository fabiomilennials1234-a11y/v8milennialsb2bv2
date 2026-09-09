-- ============================================================================
-- `REVOKE ... FROM PUBLIC` não tirou o EXECUTE de anon em
-- `fn_carteira_admite_venda()`. Medido em prod 2026-08-06, logo após o apply da
-- migration anterior: `has_function_privilege('anon', …, 'EXECUTE')` = true.
--
-- Motivo: aqui o grant de `anon`/`authenticated` é EXPLÍCITO — vem de um
-- `ALTER DEFAULT PRIVILEGES` que carimba toda função nova do schema `public` —
-- e não do grant a `PUBLIC`. Revogar de PUBLIC não remove grant nominal.
--
-- É o inverso do gotcha registrado no CLAUDE.md ("REVOKE FROM anon é no-op, use
-- FROM PUBLIC"). Os dois casos existem no repo, então a regra real é: revogar
-- dos dois e **verificar com `has_function_privilege` depois** — o privilégio,
-- não o comando, é a prova.
--
-- Exposição real era baixa (função retorna `trigger`, e o PostgREST não expõe
-- essas), mas o padrão do repo é superfície mínima.
--
-- Aplicado em prod 2026-08-06, ledger `20260806142137` — o prefixo `2027…` do
-- arquivo é fictício e não bate com a versão real. Drift esperado: não reaplicar.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.fn_carteira_admite_venda() FROM anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.fn_carteira_admite_venda()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA: anon ainda executa fn_carteira_admite_venda';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_carteira_admite_venda()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA: authenticated ainda executa fn_carteira_admite_venda';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_carteira_admite_venda()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA: service_role perdeu EXECUTE — a trigger roda como definer, mas não regride grant sem intenção';
  END IF;
  RAISE NOTICE 'OK: fn_carteira_admite_venda fechada para anon e authenticated.';
END $$;

COMMIT;
