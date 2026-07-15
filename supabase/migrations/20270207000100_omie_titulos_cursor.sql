-- 20270207000100_omie_titulos_cursor.sql
-- S8: cursor separado para paginação resumível dos títulos (contas a receber),
-- distinto do financeiro_cursor (NF-e). Aditivo.
ALTER TABLE public.omie_connections ADD COLUMN IF NOT EXISTS titulos_cursor INTEGER;
