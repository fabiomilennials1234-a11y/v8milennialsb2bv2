-- Central de Ajuda — Vídeo do Artigo (ADR-0019)
--
-- Um artigo pode ter um vídeo em destaque (hero 16:9) no topo do
-- HelpArticleDialog. O vídeo NÃO é HTML cru no corpo Markdown (o corpo é
-- renderizado sem rehype-raw); é um campo dedicado que guarda a URL de origem
-- (Loom ou YouTube). O frontend valida/normaliza via parseVideoEmbed contra a
-- allowlist antes de embedar num <iframe> com sandbox — host fora da allowlist
-- ou esquema perigoso (javascript:, data:) é recusado e nenhum vídeo é exibido.
ALTER TABLE public.help_articles
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.help_articles.video_url IS
  'URL de origem do Vídeo do Artigo (Central de Ajuda, ADR-0019). Host da allowlist (Loom/YouTube); normalizada para embed e sandboxed no cliente via parseVideoEmbed. NULL = artigo sem vídeo.';
