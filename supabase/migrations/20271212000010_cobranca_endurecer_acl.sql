-- 20271212000010_cobranca_endurecer_acl.sql
--
-- Cobrança · endurece as ACLs que a 20271212000000 deixou frouxas.
-- ROLLBACK pareado: rollback/20271212000010_cobranca_endurecer_acl.sql
--
-- Medido em prod logo após o apply da fundação (22/10), por pg_class.relacl:
--   - as duas views saíram com authenticated=arwdDxtm. Os default privileges do
--     Supabase dão ALL a authenticated em toda relação nova, e o REVOKE da
--     fundação tirou só PUBLIC e anon;
--   - a sequence de cobranca_eventos saiu com anon=rwU e authenticated=rwU,
--     pelo mesmo motivo.
-- Nenhum dos dois era explorável: as views são security_invoker sobre tabelas
-- em que authenticated só tem SELECT, e cobranca_eventos só recebe linha pelas
-- funções SECURITY DEFINER (dono postgres). Mas a ACL é a primeira linha de
-- defesa e tem de dizer o que o desenho diz: leitura, e nada mais.

BEGIN;

REVOKE ALL ON public.cobranca_titulos_saldo, public.cobranca_inadimplentes_resumo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cobranca_titulos_saldo, public.cobranca_inadimplentes_resumo TO authenticated;

REVOKE ALL ON SEQUENCE public.cobranca_eventos_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cobranca_eventos_id_seq TO service_role;

COMMIT;
