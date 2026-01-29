-- Corrigir função is_team_member para verificar team_members em vez de apenas user_roles
CREATE OR REPLACE FUNCTION public.is_team_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members
    WHERE user_id = _user_id
      AND is_active = true
  ) OR EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
  )
$$;

-- Adicionar tabelas ao realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.team_members;