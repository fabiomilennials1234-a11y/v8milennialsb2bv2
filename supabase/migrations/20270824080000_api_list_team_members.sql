-- ============================================================================
-- `GET /api/v1/team-members` — o catálogo de quem pode ser responsável.
--
-- POR QUE EXISTE: os campos de responsável da API (`owner_id` do Negócio,
-- `responsible_id`, `sale_responsible_id` e `pre_sale_responsible_id` do Lead)
-- são UUID, e não havia como descobri-los pela API. Quem integra tinha que abrir
-- a tela de Equipe e copiar o código à mão, por pessoa.
--
-- O QUE DEVOLVE, E O QUE NÃO DEVOLVE: id, nome, e-mail, cargo, papel e ativo.
-- Telefone e dados de remuneração (`ote_base`, `ote_bonus`, os percentuais de
-- comissão) ficam FORA de propósito — a rota existe para preencher um seletor,
-- e ninguém precisa saber quanto o vendedor ganha para escolhê-lo numa lista.
-- O e-mail fica porque homônimo é comum e é ele que desempata.
--
-- SOBRE PRÉ-VENDA E VENDAS: o Torque não marca no MEMBRO quem é pré-venda e quem
-- é vendas. Isso é decidido por Lead, nos campos `pre_sale_responsible_id` e
-- `sale_responsible_id` — a mesma pessoa pode ser pré-venda num Lead e vendas em
-- outro. `job_title` existe mas é texto livre (medido em prod: "Closer", "SDR",
-- "CEO", "Cliente", "Agency", vazio e nulo), então serve como dica na tela, NÃO
-- como filtro. É por isso que esta rota devolve uma lista só, e é a mesma lista
-- que a tela do produto usa nos dois campos (`useTeamMembers`, sem filtro).
--
-- `is_active` vem junto em vez de filtrar aqui: quem monta seletor quer só os
-- ativos, mas quem sincroniza histórico precisa resolver o nome de quem já saiu.
-- Filtrar na origem tiraria a segunda leitura sem avisar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_list_team_members(p_org uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'name', tm.name,
    'email', tm.email,
    'job_title', NULLIF(btrim(COALESCE(tm.job_title, '')), ''),
    'role', tm.role,
    'is_active', tm.is_active
  ) ORDER BY tm.is_active DESC, tm.name), '[]'::jsonb)
  FROM public.team_members tm
  WHERE tm.organization_id = p_org;
$$;

COMMENT ON FUNCTION public.api_list_team_members(uuid) IS
  'GET /api/v1/team-members (escopo team:read). Catálogo de membros para preencher os campos de responsável. Não expõe telefone nem remuneração.';

REVOKE ALL ON FUNCTION public.api_list_team_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_list_team_members(uuid) TO service_role;
