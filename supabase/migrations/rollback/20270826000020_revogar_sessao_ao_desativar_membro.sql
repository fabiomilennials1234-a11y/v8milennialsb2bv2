-- ROLLBACK de 20270826000020_revogar_sessao_ao_desativar_membro.sql
DROP TRIGGER IF EXISTS trg_revogar_sessoes_ao_desativar ON public.team_members;
DROP FUNCTION IF EXISTS public.revogar_sessoes_de_membro_desativado();
