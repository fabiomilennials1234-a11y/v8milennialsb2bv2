-- =============================================================================
-- lead_comments.mentions uuid[] + trigger pra notifications
-- Issue: #312 (PRD #284 — @mention autocomplete + notifications)
-- Date: 2026-10-31 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Tabela notifications já existe desde 20260316. Reaproveita schema:
-- type='mention', lead_id, link, title, description.
--
-- Trigger AFTER INSERT/UPDATE OF mentions em lead_comments — pra cada uuid
-- novo em mentions[] cria 1 notification (skip se já existe).

-- 1. Coluna
ALTER TABLE public.lead_comments
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.lead_comments.mentions IS
  'Array de user_ids (auth.users.id) mencionados no body via @nome. Trigger fn_lead_comment_mentions cria notifications para cada um.';

-- 2. Trigger
CREATE OR REPLACE FUNCTION public.fn_lead_comment_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mention uuid;
  v_old_set uuid[] := COALESCE(OLD.mentions, '{}');
  v_lead_name text;
  v_actor_name text;
BEGIN
  -- Skip if mentions is empty or unchanged on update
  IF NEW.mentions IS NULL OR array_length(NEW.mentions, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_lead_name FROM public.leads WHERE id = NEW.lead_id;
  SELECT full_name INTO v_actor_name
  FROM public.profiles WHERE id = NEW.author_user_id;

  FOREACH v_mention IN ARRAY NEW.mentions LOOP
    -- Skip if mention was already there on UPDATE (idempotente)
    IF TG_OP = 'UPDATE' AND v_mention = ANY(v_old_set) THEN
      CONTINUE;
    END IF;

    -- Skip self-mention
    IF v_mention = NEW.author_user_id THEN
      CONTINUE;
    END IF;

    -- Skip if user is not a team_member of the org (cross-org guard)
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = v_mention
        AND organization_id = NEW.organization_id
        AND is_active = true
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (
      organization_id, user_id, type, title, description, lead_id, link
    )
    VALUES (
      NEW.organization_id,
      v_mention,
      'mention',
      COALESCE(v_actor_name, 'Alguém') || ' mencionou você',
      'No lead ' || COALESCE(v_lead_name, 'sem nome'),
      NEW.lead_id,
      '/leads?leadId=' || NEW.lead_id::text || '&comment=' || NEW.id::text
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_comment_mentions ON public.lead_comments;
CREATE TRIGGER trg_lead_comment_mentions
  AFTER INSERT OR UPDATE OF mentions ON public.lead_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_lead_comment_mentions();

COMMENT ON FUNCTION public.fn_lead_comment_mentions() IS
  'PRD #284 — emite notification por @mention. Skip self-mention, cross-org, e mentions já existentes em UPDATE.';
