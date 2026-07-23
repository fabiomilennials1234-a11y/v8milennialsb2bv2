-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260711033436  name: help_feedback_summary_rpc
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.get_help_article_feedback_summaries()
RETURNS TABLE (
  article_id    uuid,
  helpful_up    integer,
  helpful_down  integer,
  reasons       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.article_id,
    count(*) FILTER (WHERE f.helpful)::int        AS helpful_up,
    count(*) FILTER (WHERE NOT f.helpful)::int     AS helpful_down,
    COALESCE(
      array_agg(f.reason ORDER BY f.updated_at DESC)
        FILTER (WHERE f.reason IS NOT NULL AND btrim(f.reason) <> ''),
      ARRAY[]::text[]
    ) AS reasons
  FROM public.help_article_feedback f
  JOIN public.help_articles a ON a.id = f.article_id
  WHERE
    (a.organization_id IS NULL AND public.is_master_user())
    OR (a.organization_id = public.get_user_organization_id() AND public.is_user_admin())
  GROUP BY f.article_id;
$$;

COMMENT ON FUNCTION public.get_help_article_feedback_summaries() IS
  'Agregado anônimo (👍/👎 + motivos, sem user_id) do Feedback do Artigo, só para artigos que o chamador possui (master → globais; admin → da sua org). B3, PRD #1055.';

REVOKE ALL ON FUNCTION public.get_help_article_feedback_summaries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_help_article_feedback_summaries() TO authenticated;
