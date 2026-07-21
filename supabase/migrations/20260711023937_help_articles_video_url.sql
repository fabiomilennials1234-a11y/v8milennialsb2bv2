-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260711023937  name: help_articles_video_url
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

ALTER TABLE public.help_articles
  ADD COLUMN IF NOT EXISTS video_url text;
COMMENT ON COLUMN public.help_articles.video_url IS
  'URL de origem do Vídeo do Artigo (Central de Ajuda, ADR-0019). Host da allowlist (Loom/YouTube); normalizada para embed e sandboxed no cliente via parseVideoEmbed. NULL = artigo sem vídeo.';
