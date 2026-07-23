-- 20270210000000_omie_webhook_secret.sql
-- S11 (#1111): segredo per-org do webhook Omie, no cofre deny-all existente.
-- Guardamos só o HASH (lookup constant-time sem decriptar; segredo cru nunca em repouso).
-- Aditivo. O handler + geração do segredo + registro no Omie ficam pro pós-spike
-- (não confirmado se a Omie oferece webhook outbound nem o formato do payload/auth).
ALTER TABLE public.omie_connection_secrets
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT;
