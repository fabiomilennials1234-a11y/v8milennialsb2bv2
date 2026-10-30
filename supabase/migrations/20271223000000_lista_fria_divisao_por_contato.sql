-- Lista Fria: divisão dos contatos por tipo (com @, com telefone, com e-mail) e seleção "E" para importar.
--
-- A revisão da busca passa a mostrar quantos contatos novos têm cada tipo de contato e deixa marcar mais de um tipo:
-- marcar vários vale como "E" (só quem tem TODOS os tipos marcados). Duas RPCs, ambas do usuário, ambas só leem ou
-- marcam resultados da PRÓPRIA org (a org vem da busca, nunca do cliente):
--   lista_fria_resultados_divisao(busca, com_instagram, com_telefone, com_email)   -> jsonb com as contagens
--   lista_fria_resultados_selecionar_por_contato(busca, com_instagram, com_telefone, com_email) -> integer
-- "Novo" = ainda não é lead e ainda não foi importado: é o único que a importação leva.

CREATE FUNCTION public.lista_fria_resultados_divisao(
  p_busca uuid,
  p_com_instagram boolean DEFAULT false,
  p_com_telefone boolean DEFAULT false,
  p_com_email boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
  v_r jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;
  PERFORM private.lista_fria_exigir(v_org, 'view');

  SELECT jsonb_build_object(
    'novos',                      count(*),
    'com_instagram',              count(*) FILTER (WHERE instagram IS NOT NULL),
    'com_telefone',               count(*) FILTER (WHERE telefone IS NOT NULL),
    'com_email',                  count(*) FILTER (WHERE email IS NOT NULL),
    'combinacao',                 count(*) FILTER (WHERE (NOT COALESCE(p_com_instagram, false) OR instagram IS NOT NULL)
                                                     AND (NOT COALESCE(p_com_telefone, false)  OR telefone IS NOT NULL)
                                                     AND (NOT COALESCE(p_com_email, false)     OR email IS NOT NULL)),
    'selecionados',               count(*) FILTER (WHERE selecionado),
    'selecionados_com_instagram', count(*) FILTER (WHERE selecionado AND instagram IS NOT NULL),
    'selecionados_com_telefone',  count(*) FILTER (WHERE selecionado AND telefone IS NOT NULL),
    'selecionados_com_email',     count(*) FILTER (WHERE selecionado AND email IS NOT NULL)
  ) INTO v_r
  FROM public.lista_fria_resultados
  WHERE busca_id = p_busca AND lead_id IS NULL AND NOT ja_e_lead;

  RETURN v_r;
END
$fn$;

-- Marca EXATAMENTE quem tem todos os tipos pedidos e desmarca o resto dos novos. Nenhum tipo pedido = marca todos os
-- novos (o mesmo que "marcar todos"). Devolve quantos ficaram marcados.
CREATE FUNCTION public.lista_fria_resultados_selecionar_por_contato(
  p_busca uuid,
  p_com_instagram boolean DEFAULT false,
  p_com_telefone boolean DEFAULT false,
  p_com_email boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
  v_n integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;
  PERFORM private.lista_fria_exigir(v_org, 'edit');

  UPDATE public.lista_fria_resultados r
     SET selecionado = ((NOT COALESCE(p_com_instagram, false) OR r.instagram IS NOT NULL)
                    AND (NOT COALESCE(p_com_telefone, false)  OR r.telefone IS NOT NULL)
                    AND (NOT COALESCE(p_com_email, false)     OR r.email IS NOT NULL))
   WHERE r.busca_id = p_busca AND r.lead_id IS NULL AND NOT r.ja_e_lead;

  SELECT count(*)::integer INTO v_n
    FROM public.lista_fria_resultados
   WHERE busca_id = p_busca AND lead_id IS NULL AND NOT ja_e_lead AND selecionado;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_fria_resultados_divisao(uuid, boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lista_fria_resultados_selecionar_por_contato(uuid, boolean, boolean, boolean) TO authenticated, service_role;
