-- Rollback de 20271212000010_cobranca_endurecer_acl.sql
-- Devolve as ACLs ao estado medido em prod antes do endurecimento (22/10).

BEGIN;

GRANT ALL ON public.cobranca_titulos_saldo, public.cobranca_inadimplentes_resumo TO authenticated;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.cobranca_eventos_id_seq TO anon, authenticated;

COMMIT;
