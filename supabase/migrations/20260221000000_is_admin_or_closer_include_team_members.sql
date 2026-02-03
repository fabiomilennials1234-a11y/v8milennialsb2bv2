-- Description: is_admin_or_closer() passa a considerar team_members além de user_roles.
-- Closers/Admins definidos apenas em Equipe (team_members) passam a ser autorizados pelo RLS.

CREATE OR REPLACE FUNCTION public.is_admin_or_closer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'closer')
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'closer')
  );
$$;

COMMENT ON FUNCTION public.is_admin_or_closer IS 'True se o usuário é admin ou closer em user_roles OU em team_members (Equipe).';

-- Validação: após aplicar, testar com usuário apenas Closer em Equipe (sem linha em user_roles):
-- 1. Criar copilot (Copilot → Novo Copilot).
-- 2. Criar instância WhatsApp (Configurações → WhatsApp) e escanear QR.
-- 3. Definir vendedores por instância (allowed members). Não deve haver erro de RLS.
