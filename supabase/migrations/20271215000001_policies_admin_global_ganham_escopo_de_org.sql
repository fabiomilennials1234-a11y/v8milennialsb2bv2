-- =============================================================================
-- Policies de "admin" sem escopo de org ganham escopo de org
-- =============================================================================
--
-- NUMERAÇÃO: 20271215000001 é provisória (irmã de 20271215000000). Renumerar
-- IMEDIATAMENTE antes do apply, acima do topo do ledger de prod, e reensaiar.
--
-- O QUE É
-- `has_role(uid,'admin')` e `is_user_admin()` respondem "é admin EM ALGUMA
-- org?" — não "é admin DESTA org". Medido em prod em 23/10/2026 (pg_policy):
-- seis policies usam esse booleano global SEM amarrar a linha à org de quem
-- chama. Com o checkout self-serve, qualquer desconhecido cria conta + org,
-- vira admin dela e alcança:
--
--   commissions             "Apenas admins podem gerenciar comissões" (ALL)
--                           → lê, cria, altera e apaga comissão de TODAS as
--                             orgs (409 linhas, 13 orgs).
--   commissions             "Usuários podem ver próprias comissões" (SELECT)
--                           → `has_role(admin) OR …`: lê de todas.
--   follow_up_automations   "Apenas admins podem gerenciar automações" (ALL,
--                           TO public) → lê e reescreve a automação de qualquer
--                           org; e o front (useAutoFollowUp) do admin aplica as
--                           regras ALHEIAS que enxerga ao mover card.
--   user_roles              "Apenas admins podem inserir roles" (INSERT) e
--                           "… deletar roles" (DELETE) → grava role='admin'
--                           para QUALQUER user_id e apaga a de qualquer um. Como
--                           has_role/is_user_admin leem user_roles, é escalada:
--                           o alvo vira "admin" em toda policy que confia nesses
--                           helpers, inclusive em orgs onde é só membro.
--   pipe_dispatch_rules     pipe_dispatch_rules_insert (INSERT)
--                           → `org ∈ minhas OR is_user_admin()`: admin de
--                             qualquer org cria regra de disparo de WhatsApp na
--                             org da vítima.
--
-- CONSERTO
--   * commissions / follow_up_automations: "admin" vira
--     `organization_id IN (SELECT get_my_admin_organization_ids())` — o mesmo
--     conceito de admin que user_roles_select_org_admin já usa (admin ativo da
--     org ou gestor dela; org bloqueada fica fora). commissions.organization_id
--     não tem NULL nem diverge da org do team_member (medido: 0 e 0).
--   * user_roles: as duas policies de admin SAEM. user_roles é espelho de
--     team_members.role mantido pelo trigger DEFINER trg_sync_user_roles
--     (sync_user_roles_from_team_members). A escrita direta do admin em
--     Equipe.tsx era redundante com o trigger (e, pior, apagava TODAS as roles
--     do usuário, inclusive as de outra org); sai no mesmo PR. Master segue
--     escrevendo por master_all_user_roles; edge fns por service_role.
--   * pipe_dispatch_rules_insert: perde o ramo `OR is_user_admin()` e passa a
--     exigir org em get_my_organization_ids() (membro ativo, org não
--     bloqueada), igual a pipe_dispatch_rules_select.
--   * Front: useFollowUps sempre grava organization_id (a criação "por etapa"
--     omitia e nascia GLOBAL — origem das linhas com org NULL), e a leitura
--     das regras ao mover card filtra org do lead + template global.
--   ALTER POLICY mantém nome e não abre janela sem policy.
--
-- MUDA DE COMPORTAMENTO (decisão do CTO, não aplicada aqui)
--   follow_up_automations tem 8 linhas com organization_id NULL (7 inativas
--   e 1 ativa: 7d80c6e9-ae66-40a5-9b77-22472eb64678, whatsapp/novo,
--   stage_change, "Primeiro contato com lead"). A ativa funciona de fato como
--   template global: o front do admin (triggerFollowUpAutomation, via
--   useFunilMoveFlow e useCampanhas) gerou com ela 116 follow-ups em 13 orgs
--   em 90 dias. Hoje só admin a lê, por causa da policy global. Para não
--   mudar comportamento antes da decisão do CTO, a nova policy
--   follow_up_automations_select_global devolve EXATAMENTE essa leitura
--   (org NULL, só admin, só SELECT). Escrita nelas: só master. Ampliar para
--   todo authenticated é decisão pendente do CTO. Nada é apagado.
--
-- FORA DE ESCOPO (anotado no PR): policies que fazem
-- `is_user_admin() AND org ∈ minhas` dão poder de admin em org B a quem é
-- admin só em org A e membro em B. Não é cross-tenant para desconhecido, é
-- confusão de papel intra-usuário — trilho próprio.
--
-- GUARDA: md5 de USING|WITH CHECK de cada policy alvo tem de bater com o
-- medido em prod (ou a policy já estar no estado novo / já ter saído). Senão
-- P0001 (NUNCA 40001).
--
-- Rollback: supabase/migrations/rollback/20271215000001_policies_admin_global_ganham_escopo_de_org.sql
-- Teste:    tests/integration/policies-admin-global-escopo-de-org.test.ts
-- =============================================================================

SET LOCAL lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- Guarda
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE
  r record;
  v_expr text;
  v_found boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('commissions',           'Apenas admins podem gerenciar comissões',  '2746d36a52677cf5b07c2d3d47e7f550'),
      ('commissions',           'Usuários podem ver próprias comissões',    '45cf1bf2b59e70b99794120f6cec6166'),
      ('follow_up_automations', 'Apenas admins podem gerenciar automações', '2746d36a52677cf5b07c2d3d47e7f550'),
      ('user_roles',            'Apenas admins podem inserir roles',        '3ca918b0d4d2dcd58fdd26610a1f980e'),
      ('user_roles',            'Apenas admins podem deletar roles',        '9256ff0464c9a58efe2a4b4462e9423e'),
      ('pipe_dispatch_rules',   'pipe_dispatch_rules_insert',               '58571a2d4f80387116cc011071df0446')
    ) AS t(tabela, policy, md5_prod)
  LOOP
    SELECT true,
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
      INTO v_found, v_expr
      FROM pg_policy pol
     WHERE pol.polrelid = ('public.' || r.tabela)::regclass
       AND pol.polname = r.policy;

    IF NOT FOUND THEN
      -- Só as de user_roles podem já ter saído (reaplicação).
      IF r.tabela = 'user_roles' THEN CONTINUE; END IF;
      RAISE EXCEPTION 'guarda admin_global: policy %.% não existe', r.tabela, r.policy
        USING ERRCODE = 'P0001';
    END IF;

    IF md5(v_expr) <> r.md5_prod
       AND v_expr ~ '(has_role|is_user_admin)\(' THEN
      RAISE EXCEPTION 'guarda admin_global: policy %.% divergiu do medido em prod (md5 %)',
        r.tabela, r.policy, md5(v_expr)
        USING ERRCODE = 'P0001',
              HINT = 'Alguém mudou a policy depois do inventário. Reler e reavaliar.';
    END IF;
  END LOOP;

  -- Premissa do DROP em user_roles: o trigger que espelha team_members.role
  -- existe, está ligado e é DEFINER.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.team_members'::regclass
       AND t.tgname = 'trg_sync_user_roles'
       AND t.tgenabled <> 'D'
       AND p.proname = 'sync_user_roles_from_team_members'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'guarda admin_global: trg_sync_user_roles ausente/desligado — user_roles ficaria sem escritor'
      USING ERRCODE = 'P0001';
  END IF;
END
$guard$;

-- -----------------------------------------------------------------------------
-- commissions
-- -----------------------------------------------------------------------------
ALTER POLICY "Apenas admins podem gerenciar comissões" ON public.commissions
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

ALTER POLICY "Usuários podem ver próprias comissões" ON public.commissions
  USING (
    organization_id IN (SELECT public.get_my_admin_organization_ids())
    OR team_member_id IN (SELECT public.get_my_team_member_ids())
  );

-- -----------------------------------------------------------------------------
-- follow_up_automations
-- -----------------------------------------------------------------------------
ALTER POLICY "Apenas admins podem gerenciar automações" ON public.follow_up_automations
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

-- Template global (org NULL): mesma leitura de hoje, sem escrita e sem
-- enxergar automação de outra org. is_user_admin() aqui é deliberado: a linha
-- não pertence a org nenhuma.
DROP POLICY IF EXISTS follow_up_automations_select_global ON public.follow_up_automations;
CREATE POLICY follow_up_automations_select_global ON public.follow_up_automations
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (organization_id IS NULL AND (SELECT public.is_user_admin()));

-- -----------------------------------------------------------------------------
-- user_roles: só trigger (DEFINER), master e service_role escrevem
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Apenas admins podem inserir roles" ON public.user_roles;
DROP POLICY IF EXISTS "Apenas admins podem deletar roles" ON public.user_roles;

-- -----------------------------------------------------------------------------
-- pipe_dispatch_rules: INSERT sem o ramo de admin global
-- -----------------------------------------------------------------------------
-- get_my_organization_ids(): membro ATIVO de org NÃO bloqueada — igual a
-- pipe_dispatch_rules_select. (UPDATE/DELETE seguem com o subselect inline
-- herdado, sem is_active; trilho próprio.)
ALTER POLICY pipe_dispatch_rules_insert ON public.pipe_dispatch_rules
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

-- -----------------------------------------------------------------------------
-- Asserções
-- -----------------------------------------------------------------------------
DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('commissions', 'follow_up_automations', 'user_roles', 'pipe_dispatch_rules')
       AND NOT (pol.polname = 'follow_up_automations_select_global' AND pol.polcmd = 'r')
       AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
           ~ '(has_role|is_user_admin)\('
  ) THEN
    RAISE EXCEPTION 'asserção admin_global: sobrou policy com admin global nas 4 tabelas'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.user_roles'::regclass AND polname = 'master_all_user_roles') THEN
    RAISE EXCEPTION 'asserção admin_global: master perdeu a escrita em user_roles'
      USING ERRCODE = 'P0001';
  END IF;
END
$assert$;
