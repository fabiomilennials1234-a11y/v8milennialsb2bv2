-- RPC genérica para incrementar coluna numérica (ex.: campaign_templates.times_used).
-- Restrita a pares (tabela, coluna) permitidos para evitar SQL injection.
CREATE OR REPLACE FUNCTION public.increment(
  table_name text,
  row_id uuid,
  column_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF table_name = 'campaign_templates' AND column_name = 'times_used' THEN
    UPDATE public.campaign_templates
    SET times_used = COALESCE(times_used, 0) + 1
    WHERE id = row_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.increment(text, uuid, text) IS
  'Incrementa coluna numérica em tabelas permitidas (ex: campaign_templates.times_used).';
