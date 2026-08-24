-- 20270825000000_is_org_admin_helper.sql
--
-- Dois helpers que faltavam para escrever "admin DESTA org" sem repetir SQL.
--
-- ─── Por que nascem agora ────────────────────────────────────────────────────
--
-- O repo já tinha `is_user_admin()`, mas ela responde outra pergunta: "é admin
-- de ALGUMA org?". Devolve `true` para o admin da org A quando a pergunta era
-- sobre a org B. Isso é deliberado no isolamento de chat (o cabeçalho de
-- `20270818130000_chat_owner_isolation.sql` explica: espelhar a policy de
-- `leads`), mas é buraco em qualquer regra que precise de escopo por
-- organização — e a regra de visibilidade do Comando precisa.
--
-- `is_org_admin` NÃO existia em nenhuma migration ativa (conferido por grep em
-- 2026-08-24). O que existia era `is_org_admin_or_master`, e só em
-- `migrations/archive/20261026000000_admin_reassign_credit_rpcs.sql` — ausente
-- do baseline, ou seja, provavelmente nunca aplicada. Não reusei.
--
-- ─── Por que SECURITY DEFINER ────────────────────────────────────────────────
--
-- `is_org_admin` é chamada de dentro de uma policy RLS (`acoes_do_dia`, na
-- migration 20270825000030). Um `SELECT ... FROM team_members` inline na
-- EXPRESSÃO de uma policy causa recursão infinita no `apply_rls()` do Realtime
-- — é a regra do CLAUDE.md raiz. Dentro de uma função DEFINER o EXISTS é
-- seguro, e é exatamente o molde que `set_org_chat_restriction`
-- (20270818130000:174-186) já usa.
--
-- ─── Master ──────────────────────────────────────────────────────────────────
--
-- Master atravessa, como em todo o resto do produto: `is_master_user()` é a
-- primeira linha de `has_feature_permission` e de `can_see_chat`. Master não é
-- valor do enum `app_role` — é a camada de cima.

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_admin(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(public.is_master_user(), false)
      OR EXISTS (
           SELECT 1
           FROM public.team_members tm
           WHERE tm.user_id         = auth.uid()
             AND tm.organization_id = p_organization_id
             AND tm.is_active       = true
             AND tm.role            = 'admin'::public.app_role
         );
$$;

COMMENT ON FUNCTION public.is_org_admin(uuid) IS
  'O chamador é admin DESTA organização (ou master)? Escopado por org, ao '
  'contrário de is_user_admin(), que responde "admin de qualquer org".';

REVOKE ALL     ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────

-- O `team_members.id` do chamador NESTA org — a ponte entre o espaço de
-- `auth.users.id` (o que a sessão tem) e o de `team_members.id` (o que as
-- colunas de responsável guardam).
--
-- ⚠️ Devolve NULL para master e para gestor de portfólio: eles não têm linha
-- real em `team_members` (o front fabrica um id virtual `master-virtual-…`,
-- que NUNCA existe no banco — ADR-0021). Quem consome tem de tratar o NULL
-- como "não filtre por dono", nunca como "filtre por NULL" — senão a lista do
-- master nasce vazia.
CREATE OR REPLACE FUNCTION public.my_team_member_id(p_organization_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tm.id
  FROM public.team_members tm
  WHERE tm.user_id         = auth.uid()
    AND tm.organization_id = p_organization_id
    AND tm.is_active       = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.my_team_member_id(uuid) IS
  'team_members.id do chamador nesta org. NULL para master/gestor (sem linha '
  'real) — tratar NULL como "sem recorte por dono", nunca como filtro.';

REVOKE ALL     ON FUNCTION public.my_team_member_id(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_team_member_id(uuid) TO authenticated, service_role;
