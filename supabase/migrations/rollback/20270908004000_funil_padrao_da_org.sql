-- rollback/20270908004000_funil_padrao_da_org.sql — SCRUM-624
--
-- Desfaz a 20270908004000 por inteiro: guarda de deleção, índice e coluna.
-- O DROP COLUMN descarta o backfill junto (o dado é derivável: reaplique a
-- migration e o backfill reaponta para o funil slug 'whatsapp' de cada org).
--
-- ⚠️ Rode só se a 20270908004000 tiver sido aplicada e o CTO autorizar o
-- revert. Depois do revert, o lead-webhook deployado com o fallback do funil
-- padrão degrada para "org sem funil padrão" (lead sem card) — se o revert
-- for durar, reverta também o deploy da função.

DROP TRIGGER IF EXISTS trg_guard_default_pipeline_delete ON public.pipelines;
DROP FUNCTION IF EXISTS public.fn_guard_default_pipeline_delete();
DROP INDEX IF EXISTS public.idx_organizations_default_pipeline;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS default_pipeline_id;
