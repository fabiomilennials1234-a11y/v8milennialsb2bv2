-- Feedback do Artigo ("Foi útil?") — ADR-0018/Central de Ajuda no CONTEXT.md.
--
-- Um voto único e trocável por usuário (unique article+user, upsert). `reason`
-- (o "o que faltou?" do 👎) entra na fatia B2 e nasce nulo aqui. O agregado é
-- anônimo e sai por RPC SECURITY DEFINER na fatia B3 — a RLS abaixo só deixa o
-- usuário ver e mexer no PRÓPRIO voto, nunca no dos outros.

CREATE TABLE IF NOT EXISTS public.help_article_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      uuid NOT NULL REFERENCES public.help_articles(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  helpful         boolean NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_help_article_feedback_article
  ON public.help_article_feedback (article_id);

COMMENT ON TABLE public.help_article_feedback IS
  'Voto "Foi útil?" de um usuário num Artigo de Ajuda. Um por (article, user), trocável. Agregado anônimo via RPC (B3).';

-- ------------------------------------------------------------
-- organization_id é derivado do artigo (tamper-proof): global → null; da org →
-- aquela org. Nunca vem do cliente. `updated_at` avança no update.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_help_feedback_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT organization_id INTO NEW.organization_id
      FROM public.help_articles WHERE id = NEW.article_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_help_feedback_defaults ON public.help_article_feedback;
CREATE TRIGGER trg_help_feedback_defaults
  BEFORE INSERT OR UPDATE ON public.help_article_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_help_feedback_defaults();

-- ------------------------------------------------------------
-- Pode o usuário ler este artigo? Espelha help_articles_read (publicado + global
-- ou da própria org). SECURITY DEFINER pra não recursionar apply_rls ao ser
-- chamada dentro da policy de feedback (regra do CLAUDE.md).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_help_article(p_article_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.help_articles a
    WHERE a.id = p_article_id
      AND a.is_published = true
      AND (a.organization_id IS NULL OR a.organization_id = public.get_user_organization_id())
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_help_article(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_help_article(uuid) TO authenticated;

-- ------------------------------------------------------------
-- RLS: cada um só enxerga e mexe no próprio voto. O agregado (B3) sai por RPC
-- SECURITY DEFINER, que ignora estas policies de propósito.
-- ------------------------------------------------------------
ALTER TABLE public.help_article_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS help_article_feedback_select_own ON public.help_article_feedback;
CREATE POLICY help_article_feedback_select_own ON public.help_article_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS help_article_feedback_insert_own ON public.help_article_feedback;
CREATE POLICY help_article_feedback_insert_own ON public.help_article_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_read_help_article(article_id));

DROP POLICY IF EXISTS help_article_feedback_update_own ON public.help_article_feedback;
CREATE POLICY help_article_feedback_update_own ON public.help_article_feedback
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.help_article_feedback TO authenticated;
