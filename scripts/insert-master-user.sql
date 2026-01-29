-- ============================================
-- SCRIPT: Inserir Usuário Master Inicial
-- ============================================
-- 
-- INSTRUÇÕES DE USO:
-- 1. Acesse o Supabase Dashboard > SQL Editor
-- 2. Substitua 'seu-email@dominio.com' pelo seu email
-- 3. Execute este script
-- 
-- IMPORTANTE: O usuário já deve ter feito login pelo menos uma vez
-- para existir na tabela auth.users
--

-- SUBSTITUA O EMAIL ABAIXO PELO SEU EMAIL REAL
DO $$
DECLARE
  v_email TEXT := 'seu-email@dominio.com'; -- <-- MUDE AQUI
  v_user_id UUID;
BEGIN
  -- Buscar user_id
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario com email % nao encontrado. Certifique-se de ter feito login pelo menos uma vez.', v_email;
  END IF;

  -- Inserir como master
  INSERT INTO public.master_users (user_id, notes, permissions)
  VALUES (
    v_user_id,
    'Master inicial - desenvolvedor',
    '{"all": true}'::jsonb
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    is_active = true,
    notes = 'Master inicial - desenvolvedor';

  RAISE NOTICE 'Usuario % adicionado como Master com sucesso!', v_email;
END $$;

-- Verificar se foi inserido corretamente
SELECT 
  m.id,
  u.email,
  m.is_active,
  m.notes,
  m.granted_at
FROM public.master_users m
JOIN auth.users u ON u.id = m.user_id
WHERE m.is_active = true;
