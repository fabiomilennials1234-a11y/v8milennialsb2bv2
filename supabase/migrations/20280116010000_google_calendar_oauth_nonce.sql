-- Nonce de uso único do state OAuth do Google Calendar.
--
-- O state OAuth era base64 puro e o google-calendar-callback (público, roda com
-- service_role) confiava no userId/orgId dele: forjar o state vinculava o
-- Google do atacante à conta de outro usuário/outra org. Agora o state é
-- assinado (HMAC-SHA256, _shared/google-calendar-oauth-state.ts) e carrega um
-- nonce que o connect grava aqui e o callback consome uma única vez.
--
-- Mesmo desenho de meta_oauth_nonces / meta_consume_oauth_nonce (20271215010000).
-- Ordem de deploy: esta migration ANTES de google-calendar-connect e
-- google-calendar-callback.

CREATE TABLE public.google_calendar_oauth_nonces (
  nonce           uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX google_calendar_oauth_nonces_user_idx
  ON public.google_calendar_oauth_nonces (user_id);

-- Só o backend (service_role) toca: nenhum caminho de browser lê ou escreve.
ALTER TABLE public.google_calendar_oauth_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_oauth_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_calendar_oauth_nonces TO service_role;

-- Consome o nonce (DELETE ... RETURNING: atômico, um único vencedor) e
-- revalida a membership ATUAL — o usuário pode ter sido removido da org
-- durante a ida ao Google. Também varre os nonces vencidos do usuário.
CREATE FUNCTION public.google_calendar_consume_oauth_nonce(
  p_nonce uuid,
  p_user_id uuid,
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  consumed uuid;
BEGIN
  DELETE FROM public.google_calendar_oauth_nonces
   WHERE nonce = p_nonce
     AND user_id = p_user_id
     AND organization_id = p_organization_id
     AND expires_at > now()
  RETURNING nonce INTO consumed;

  DELETE FROM public.google_calendar_oauth_nonces
   WHERE user_id = p_user_id
     AND expires_at <= now();

  IF consumed IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.team_members
     WHERE user_id = p_user_id
       AND organization_id = p_organization_id
       AND is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_consume_oauth_nonce(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_consume_oauth_nonce(uuid, uuid, uuid)
  TO service_role;
