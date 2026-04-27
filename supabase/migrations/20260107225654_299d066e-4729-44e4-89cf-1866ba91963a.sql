-- Alterar faturamento de numeric para text para aceitar valores flexíveis
ALTER TABLE public.leads 
ALTER COLUMN faturamento TYPE text USING faturamento::text;