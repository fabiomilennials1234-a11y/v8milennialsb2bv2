-- ROLLBACK de 20270826000010_master_set_org_suspension.sql
--
-- Some com a RPC. O botão "Suspender" do Master volta a escrever
-- `subscription_status` direto (comportamento anterior), o que significa que a
-- suspensão volta a NÃO limpar o billing_override.
DROP FUNCTION IF EXISTS public.master_set_org_suspension(uuid, boolean, text);
