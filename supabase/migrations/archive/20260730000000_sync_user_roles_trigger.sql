-- ============================================================
-- Sincronização user_roles ← team_members
--
-- PROBLEMA: user_roles e team_members.role guardam o mesmo dado
-- e podem desincronizar. user_roles é a fonte lida por has_role(),
-- RLS e vários hooks do frontend.
--
-- SOLUÇÃO:
-- 1) One-time sync: garante que todo team_member ativo com role
--    admin/sdr/closer/bdr que NÃO tem entrada em user_roles ganha uma.
-- 2) Trigger: toda vez que team_members.role muda (INSERT/UPDATE),
--    user_roles é atualizado automaticamente.
--
-- DEPRECATION NOTICE: user_roles é deprecated. Numa migration futura
-- ela será removida e has_role() passará a ler apenas team_members.
-- Enquanto isso, este trigger mantém compatibilidade com código legado.
-- ============================================================

-- 1) Sync existente: inserir user_roles faltantes
--    JOIN auth.users para excluir team_members órfãos (user_id inexistente)
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT tm.user_id, tm.role
FROM public.team_members tm
JOIN auth.users au ON au.id = tm.user_id
WHERE tm.user_id IS NOT NULL
  AND tm.is_active = true
  AND tm.role IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = tm.user_id AND ur.role = tm.role
  )
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) Função de trigger: sincroniza user_roles quando team_members muda
CREATE OR REPLACE FUNCTION public.sync_user_roles_from_team_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só sincroniza se tem user_id
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Se o membro foi desativado, remover a role antiga (se não tiver outro team_member ativo com essa role)
  IF NEW.is_active = false AND (TG_OP = 'UPDATE' AND OLD.is_active = true) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = NEW.user_id
        AND role = OLD.role
        AND is_active = true
        AND id != NEW.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = NEW.user_id AND role = OLD.role;
    END IF;
    RETURN NEW;
  END IF;

  -- Se role mudou em UPDATE, remover a role antiga (se não tiver outro team_member ativo com ela)
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = NEW.user_id
        AND role = OLD.role
        AND is_active = true
        AND id != NEW.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = NEW.user_id AND role = OLD.role;
    END IF;
  END IF;

  -- Upsert da nova role (INSERT ou UPDATE com nova role)
  IF NEW.is_active = true AND NEW.role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger em team_members
DROP TRIGGER IF EXISTS trg_sync_user_roles ON public.team_members;
CREATE TRIGGER trg_sync_user_roles
  AFTER INSERT OR UPDATE OF role, is_active, user_id
  ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_roles_from_team_members();

-- 4) Comentário de deprecação
COMMENT ON TABLE public.user_roles IS
  'DEPRECATED: será removida numa migration futura. '
  'A fonte de verdade é team_members.role. '
  'O trigger trg_sync_user_roles mantém esta tabela sincronizada automaticamente.';
