-- ROLLBACK de 20270730000002_close_open_backup_tables.sql
--
-- NÃO RODE ISTO. Reverter devolve leitura por `anon` (sem login) e escrita por
-- qualquer usuário autenticado de qualquer org a 5.422 linhas de dado de
-- cliente. Não existe caso de uso legítimo para esse estado — ele foi acidente
-- de herança de privilégio do schema `public`, nunca uma decisão.
--
-- Se algum fluxo precisar ler estas tabelas, o caminho é service_role (que
-- bypassa RLS) ou uma policy org-scoped — não desligar a RLS.
--
-- Mantido no repo apenas porque toda migration tem rollback pareado.

-- ALTER TABLE public._backup_stage_faxina_20260727 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public._backup_workflows_faxina_20260727 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public._backup_wf_executions_faxina_20260727 DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.backup_chique_oportunidades_20260729 DISABLE ROW LEVEL SECURITY;

SELECT 'rollback intencionalmente inerte — ver comentário no topo' AS aviso;
