-- Add NF-e detail columns to tinyerp_order_mappings
-- Used by tinyerp-fetch-nfe to store NF-e link, number, key and status

ALTER TABLE public.tinyerp_order_mappings
  ADD COLUMN IF NOT EXISTS nfe_link TEXT,
  ADD COLUMN IF NOT EXISTS nfe_numero TEXT,
  ADD COLUMN IF NOT EXISTS nfe_chave TEXT,
  ADD COLUMN IF NOT EXISTS nfe_status TEXT,
  ADD COLUMN IF NOT EXISTS nfe_updated_at TIMESTAMPTZ;
