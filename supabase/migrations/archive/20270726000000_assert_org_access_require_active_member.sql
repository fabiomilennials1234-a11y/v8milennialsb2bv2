-- 20270726000000_assert_org_access_require_active_member.sql
--
-- ISSUE #1209 — FURO DE SEGURANÇA: membro DESATIVADO lê receita, ranking e comissão.
--
-- CAUSA-RAIZ
-- ----------
-- public.assert_org_access(uuid) é o gate de tenancy dos leitores canônicos
-- (get_sales_metrics, get_funnel_flow, get_ranking, get_commission_ledger e
-- ~28 outros). Todos são SECURITY DEFINER, portanto BYPASSAM RLS e dependem
-- exclusivamente deste gate.
--
-- O gate checava apenas EXISTÊNCIA do vínculo em team_members:
--
--     SELECT 1 FROM public.team_members
--     WHERE organization_id = p_org_id AND user_id = auth.uid()
--
-- sem `AND is_active = true` — apesar do comentário acima dele dizer
-- "membro ativo da org". O comentário mentia. Desativar um membro no produto
-- NÃO revogava a leitura de dados de dinheiro.
--
-- Levantamento em PROD (jsjsmuncfkbsbzqzqhfq) na data desta migration:
--   223 vínculos em team_members, 15 inativos;
--   12 pares (user_id, organization_id) com vínculo APENAS inativo — isto é,
--   12 usuários que já deveriam estar sem acesso, em 5 organizações distintas,
--   seguiam lendo receita/ranking/comissão da org que os desativou.
--
-- SEGUNDO ACHADO — o caminho do GESTOR estava quebrado
-- ----------------------------------------------------
-- A função irmã get_my_organization_ids() (usada pelas policies RLS) já resolve
-- as duas dimensões de acesso:
--     team_members ativos  UNION  get_my_gestor_organization_ids()
-- (Gestor de Portfólio, ADR-0021 — swap aplicado e vivo em prod.)
--
-- assert_org_access() NUNCA contemplou o ramo do gestor. Verificado no banco de
-- produção: o único gestor ativo (1 gestor, 3 orgs em gestor_organizations) NÃO
-- é team_member de nenhuma das 3 orgs que gerencia, e não é master. Logo o gate
-- já o REJEITAVA — os leitores canônicos estavam inacessíveis pra ele hoje.
-- Incluir o ramo do gestor aqui é CORREÇÃO de um segundo defeito, não
-- afrouxamento: sem isso, apertar is_active manteria o gestor quebrado.
--
-- DECISÃO
-- -------
-- Em vez de repetir a regra de tenancy (e arriscar um terceiro drift entre as
-- duas funções), assert_org_access passa a DELEGAR para
-- get_my_organization_ids(). Fonte única de verdade: quem enxerga a org via RLS
-- é exatamente quem passa no gate dos leitores SECURITY DEFINER. Qualquer
-- evolução futura do modelo de acesso (novo tipo de vínculo) chega nos dois
-- caminhos de uma vez.
--
-- Sem recursão: get_my_organization_ids() é SECURITY DEFINER STABLE e não lê
-- nenhuma tabela cujas policies chamem de volta este gate. auth.uid() lê o GUC
-- do JWT e não é afetado por SECURITY DEFINER.
--
-- Preservado, na ordem original: service_role (backend/cron), master
-- (is_master_user), e agora membro ATIVO + gestor de portfólio.
--
-- ESCOPO ESTENDIDO — assert_org_member(uuid)
-- ------------------------------------------
-- Auditando irmãs, public.assert_org_member(uuid) carrega o MESMO defeito
-- (checa vínculo sem is_active e ignora o gestor). Ela guarda os leitores de
-- dinheiro da Carteira: get_portfolio_clients, get_portfolio_kpis,
-- get_revenue_at_risk, get_vendedor_ranking, get_pending_orders. Mesmo bug,
-- mesma classe de dado, e get_portfolio_* é justamente a superfície do Gestor
-- de Portfólio. Corrigida junto — deixar pra depois seria fechar a porta da
-- frente e manter a dos fundos aberta.
--
-- Prova: supabase/tests/assert_org_access_test.sql (pgTAP) exercita os 5
-- caminhos — ativo / inativo / master / service_role / gestor — e inclui a
-- prova de planted-failure (o teste falha contra a definição antiga).

-- ---------------------------------------------------------------------------
-- 1) assert_org_access — gate dos leitores canônicos (ADR-0017)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_org_access(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- backend (service_role) e jobs internos passam
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;

  -- master vê qualquer org
  IF public.is_master_user() THEN RETURN; END IF;

  -- org nula nunca concede acesso
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  -- membro ATIVO da org, ou gestor de portfólio da org (ADR-0021).
  -- get_my_organization_ids() é a fonte única: team_members com
  -- is_active = true UNION get_my_gestor_organization_ids().
  IF EXISTS (
    SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
    WHERE t.org_id = p_org_id
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
END;
$function$;

COMMENT ON FUNCTION public.assert_org_access(uuid) IS
  'Gate de tenancy dos leitores SECURITY DEFINER (ADR-0017). Passa: service_role, '
  'master, membro ATIVO da org e gestor de portfólio da org (ADR-0021). Delega a '
  'regra de vínculo a get_my_organization_ids() para não divergir do RLS. '
  'Caso contrário RAISE access_denied (P0001). Ver issue #1209.';

-- ---------------------------------------------------------------------------
-- 2) assert_org_member — gate dos leitores de Carteira (mesmo defeito)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_org_member(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;
  IF public.is_master_user() THEN RETURN; END IF;

  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_my_organization_ids() AS t(org_id)
    WHERE t.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.assert_org_member(uuid) IS
  'Gate de tenancy dos leitores de Carteira (get_portfolio_*, get_revenue_at_risk, '
  'get_vendedor_ranking, get_pending_orders). Mesma regra de assert_org_access: '
  'service_role, master, membro ATIVO e gestor de portfólio. Ver issue #1209.';

-- ---------------------------------------------------------------------------
-- 3) Grants — preserva o estado observado em prod (authenticated + service_role).
--    CREATE OR REPLACE preserva ACL existente; explicitado por idempotência em
--    ambientes onde a função for criada do zero.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.assert_org_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assert_org_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_org_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_org_member(uuid) TO authenticated, service_role;
