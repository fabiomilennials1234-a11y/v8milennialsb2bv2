-- Aviso para quem pode consertar. Issue #1886, ADR-0035.
--
-- Falha de automação não é assunto de vendedor: ele recebe, não pode resolver, e
-- aprende a ignorar o sino. Vai para os administradores da organização — os que
-- têm conta de usuário, porque Aviso se endereça a um login.
--
-- Cada administrador recebe o SEU Aviso, com a mesma chave de agrupamento: um
-- lê e fecha o dele sem apagar o do outro.

CREATE OR REPLACE FUNCTION public.fn_emit_aviso_admins(
  p_organization_id uuid,
  p_type            text,
  p_group_key       text,
  p_title           text,
  p_description     text        DEFAULT NULL,
  p_link            text        DEFAULT NULL,
  p_entity_id       uuid        DEFAULT NULL,
  p_occurred_at     timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  uuid;
  v_total integer := 0;
BEGIN
  IF p_organization_id IS NULL OR p_group_key IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_user IN
    SELECT DISTINCT tm.user_id
      FROM public.team_members tm
     WHERE tm.organization_id = p_organization_id
       AND tm.role = 'admin'::app_role
       AND tm.is_active
       AND tm.user_id IS NOT NULL
  LOOP
    PERFORM public.fn_emit_aviso(
      p_organization_id => p_organization_id,
      p_user_id         => v_user,
      p_type            => p_type,
      p_group_key       => p_group_key,
      p_title           => p_title,
      p_description     => p_description,
      p_link            => p_link,
      p_entity_id       => p_entity_id,
      p_occurred_at     => p_occurred_at
    );
    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.fn_emit_aviso_admins IS
  'Emite o mesmo Aviso para cada administrador ativo com conta de usuário da organização (#1886). Devolve quantos receberam.';

REVOKE ALL ON FUNCTION public.fn_emit_aviso_admins(uuid, text, text, text, text, text, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_emit_aviso_admins(uuid, text, text, text, text, text, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.fn_emit_aviso_admins(uuid, text, text, text, text, text, uuid, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_emit_aviso_admins(uuid, text, text, text, text, text, uuid, timestamptz) TO service_role;
