-- Roll back application deployment first. Do not restore browser access to credentials.
-- Preserve app binding, nullable expiries and nonce history. No credential/data backfill.
REVOKE ALL ON public.meta_oauth_nonces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meta_consume_oauth_nonce(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
