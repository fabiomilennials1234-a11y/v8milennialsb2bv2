-- ============================================
-- Corrigir duplicata em team_members (mesmo user_id 2x)
-- ============================================
-- Situação: o mesmo user_id (gabrielgipp04@gmail.com) tem 2 linhas:
--   - "Vendedor" (sdr)  e  "Gabriel" (admin)
-- O app espera 0 ou 1 linha por user_id (maybeSingle), então 2 linhas quebram.
--
-- Este script: mantém só a linha com role admin (Gabriel), remove a outra (Vendedor),
-- e garante organization_id na que ficar.
--
-- Rode no SQL Editor do Supabase (mesmo lugar do set_master).
-- ============================================

DO $$
DECLARE
  v_user_id   UUID;
  v_org_id    UUID;
  v_row_keep  RECORD;
  v_row_del   RECORD;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'gabrielgipp04@gmail.com';
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário gabrielgipp04@gmail.com não encontrado em auth.users';
  END IF;

  -- Pegar uma organização (a primeira)
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma organização encontrada. Rode antes o script set_master_gabrielgipp04.sql';
  END IF;

  -- Manter a linha com role = admin (Gabriel); apagar as outras com esse user_id
  FOR v_row_del IN
    SELECT id, name, role
    FROM public.team_members
    WHERE user_id = v_user_id
    AND role != 'admin'
  LOOP
    DELETE FROM public.team_members WHERE id = v_row_del.id;
    RAISE NOTICE 'Removida duplicata: id=%, name=%, role=%', v_row_del.id, v_row_del.name, v_row_del.role;
  END LOOP;

  -- Garantir que a linha admin tem organization_id e está ativa
  UPDATE public.team_members
  SET organization_id = v_org_id, is_active = true, name = 'Gabriel', role = 'admin', updated_at = NOW()
  WHERE user_id = v_user_id;

  RAISE NOTICE 'Ajustado: uma única linha para este user_id, com organization_id = %. Faça logout e entre de novo.', v_org_id;
END $$;
