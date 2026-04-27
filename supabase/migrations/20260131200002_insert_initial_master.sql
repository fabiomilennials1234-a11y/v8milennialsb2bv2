-- Migration: Insert Initial Master User
-- Description: Insere o primeiro usuário master (desenvolvedor)
-- Date: 2026-01-31
-- 
-- INSTRUÇÕES:
-- 1. Substitua 'seu-email@dominio.com' pelo seu email real
-- 2. Execute esta migration apenas uma vez
-- 3. O usuário já deve existir no auth.users (ter feito login antes)

-- ============================================
-- INSERIR MASTER INICIAL
-- ============================================

-- Opção 1: Inserir por email (mais seguro)
-- Descomente e ajuste o email

/*
INSERT INTO public.master_users (user_id, notes, permissions)
SELECT 
  id,
  'Master inicial - desenvolvedor principal',
  '{"all": true}'::jsonb
FROM auth.users
WHERE email = 'seu-email@dominio.com'
ON CONFLICT (user_id) DO NOTHING;
*/

-- Opção 2: Inserir o primeiro usuário da tabela auth.users como master
-- (útil para ambiente de desenvolvimento)

/*
INSERT INTO public.master_users (user_id, notes, permissions)
SELECT 
  id,
  'Master inicial - primeiro usuário',
  '{"all": true}'::jsonb
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;
*/

-- ============================================
-- FUNÇÕES AUXILIARES PARA GERENCIAR MASTERS
-- ============================================

-- Função para adicionar um novo master (somente master existente pode executar)
CREATE OR REPLACE FUNCTION public.master_add_user(
  _email TEXT,
  _notes TEXT DEFAULT 'Adicionado via função'
)
RETURNS UUID AS $$
DECLARE
  v_target_user_id UUID;
  v_new_master_id UUID;
BEGIN
  -- Verificar se quem está executando é master
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem adicionar novos masters';
  END IF;

  -- Buscar user_id pelo email
  SELECT id INTO v_target_user_id
  FROM auth.users
  WHERE email = _email;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario com email % nao encontrado', _email;
  END IF;

  -- Inserir como master
  INSERT INTO public.master_users (user_id, granted_by, notes, permissions)
  VALUES (
    v_target_user_id,
    auth.uid(),
    _notes,
    '{"all": true}'::jsonb
  )
  RETURNING id INTO v_new_master_id;

  -- Log da ação
  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  SELECT 
    m.id,
    auth.uid(),
    'MASTER_ADD',
    'user',
    v_target_user_id,
    jsonb_build_object('email', _email, 'notes', _notes)
  FROM public.master_users m 
  WHERE m.user_id = auth.uid();

  RETURN v_new_master_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para remover um master
CREATE OR REPLACE FUNCTION public.master_remove_user(_target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Verificar se quem está executando é master
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Acesso negado: apenas usuarios master podem remover masters';
  END IF;

  -- Não permitir remover a si mesmo
  IF _target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Voce nao pode remover a si mesmo como master';
  END IF;

  -- Desativar (não deletar para manter histórico)
  UPDATE public.master_users
  SET is_active = false
  WHERE user_id = _target_user_id;

  -- Log da ação
  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  SELECT 
    m.id,
    auth.uid(),
    'MASTER_REMOVE',
    'user',
    _target_user_id,
    '{}'::jsonb
  FROM public.master_users m 
  WHERE m.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- COMENTÁRIOS
-- ============================================

COMMENT ON FUNCTION public.master_add_user IS 'Adiciona um novo usuario master (requer ser master)';
COMMENT ON FUNCTION public.master_remove_user IS 'Remove/desativa um usuario master (requer ser master)';
