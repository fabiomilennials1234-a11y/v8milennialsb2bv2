-- ROLLBACK de 20270730000001_deny_all_pipeline_entries_revert_backup.sql
--
-- Reverter REABRE a segunda porta de uma tabela com dado de 24 clientes. O
-- único motivo legítimo seria alguém precisar ler a tabela com role
-- `authenticated` — e nesse caso o certo é escrever uma policy org-scoped, não
-- desligar a RLS.
--
-- Os GRANTs NÃO são restaurados: eles não existiam antes desta migration.

ALTER TABLE public.pipeline_entries_revert_20260514 DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pipeline_entries_revert_20260514 IS NULL;
