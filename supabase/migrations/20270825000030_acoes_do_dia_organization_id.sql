-- 20270825000030_acoes_do_dia_organization_id.sql
--
-- "Tarefas do dia": o admin passa a enxergar as tarefas do time.
--
-- ─── O que já estava certo ───────────────────────────────────────────────────
--
-- A metade "usuário comum vê só as dele" JÁ funcionava, e por RLS de verdade:
-- as 4 policies de negócio de `acoes_do_dia` são `auth.uid() = user_id`
-- (SELECT/INSERT/UPDATE/DELETE), e o hook ainda reforça com `.eq("user_id")`.
-- Nada disso muda aqui. Um membro nunca leu tarefa de outro.
--
-- ─── O que faltava, e por que dá trabalho ────────────────────────────────────
--
-- A metade "admin vê todas" não existia: não há policy de admin, e — a parte
-- que morde — **`acoes_do_dia` não tem `organization_id`** (12 colunas,
-- conferidas contra o PROD em 2026-08-24). Sem ela, "o admin vê todas" não tem
-- como ser escrito sem virar "vê as de TODAS as orgs", que é vazamento entre
-- tenants. A coluna é pré-requisito da permissão, não enfeite.
--
-- É também a regra 3 do `supabase/migrations/CLAUDE.md`: "organization_id em
-- toda tabela com dados de cliente. Não negociável." Esta tabela estava fora
-- da regra desde que nasceu.
--
-- ─── Por que a coluna é NULLABLE e não tem backfill aqui ─────────────────────
--
-- A guarda F4 do repo diz que migration é só schema: `scripts/db-push-branch.sh`
-- recusa migration que toque dado de cliente sem `--allow-dml`. Então o
-- backfill sai em script separado — `scripts/backfill-acoes-do-dia-org.sql` —
-- para ser rodado depois do apply.
--
-- A tabela tolera o meio-termo com segurança: enquanto `organization_id` for
-- NULL, a linha continua visível só para o dono (a policy nova exige
-- `organization_id IS NOT NULL`). Ninguém vê o que não devia em momento algum.
--
-- 🔴 MAS ATENÇÃO ao lado do CLIENTE, que é onde isso morde: `organization_id =
-- <uuid>` **não casa NULL** e não levanta erro — devolve lista vazia. Entre
-- este apply e o backfill, um filtro só por org zeraria o card do admin,
-- inclusive as tarefas dele. Por isso `useAcoesDoDia` consulta
-- `organization_id = <org> OR user_id = <eu>`: o segundo termo é o piso, e
-- garante que o admin nunca enxergue MENOS do que via antes. Sem ele, a tela
-- afirmaria "Ninguém do time tem tarefa aberta" — falso — e o operador
-- despriorizaria o script manual, que é justamente como passo manual vira
-- passo esquecido neste repo.
--
-- Volume medido no PROD em 2026-08-24: **63 linhas**, 20 usuários, 51 com
-- `lead_id`. E **zero** usuários em mais de uma org ativa — ou seja, o ramo 2
-- do trigger abaixo (o `LIMIT 1`, que seria arbitrário para alguém multi-org)
-- hoje é determinístico para 100% da base. O backfill é trivial e sem
-- ambiguidade; foi medido justamente porque essa ambiguidade era o risco
-- apontado.

-- ─── Coluna ──────────────────────────────────────────────────────────────────

ALTER TABLE public.acoes_do_dia
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES public.organizations(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.acoes_do_dia.organization_id IS
  'Org da tarefa. Preenchida pelo trigger no INSERT. NULL = linha anterior a '
  '20270825000030 ainda nao backfilada: visivel so para o dono.';

-- ─── Índices ─────────────────────────────────────────────────────────────────
-- `user_id` é o filtro principal do hook e não tinha índice nenhum (só a PK) —
-- era seq scan desde sempre. Com 63 linhas não doía; com a leitura de admin
-- por org passa a doer.

CREATE INDEX IF NOT EXISTS idx_acoes_do_dia_user_id
  ON public.acoes_do_dia(user_id);

CREATE INDEX IF NOT EXISTS idx_acoes_do_dia_organization_id
  ON public.acoes_do_dia(organization_id);

-- ─── Trigger de preenchimento ────────────────────────────────────────────────
-- O front não manda `organization_id` (multi-tenancy neste produto nunca vem
-- do cliente — vem do contexto de auth). Quem resolve é o banco.
--
-- A ordem de resolução copia a que `enqueue_acoes_do_dia_webhooks` já usa
-- nesta mesma tabela, para não inventar um segundo vocabulário: primeiro o
-- lead, senão a assinatura ativa do usuário.

CREATE OR REPLACE FUNCTION public.acoes_do_dia_set_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1) A org do lead, quando a tarefa nasce presa a um (51 das 63 linhas hoje).
  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.organization_id INTO NEW.organization_id
    FROM public.leads l
    WHERE l.id = NEW.lead_id;
  END IF;

  -- 2) Senao, a org onde o usuario tem assento ativo.
  --    O LIMIT 1 seria arbitrario para usuario multi-org; medido em 2026-08-24,
  --    nenhum usuario com tarefa esta em mais de uma org ativa. Se isso mudar,
  --    e aqui que a escolha precisa deixar de ser arbitraria.
  IF NEW.organization_id IS NULL THEN
    SELECT tm.organization_id INTO NEW.organization_id
    FROM public.team_members tm
    WHERE tm.user_id   = NEW.user_id
      AND tm.is_active = true
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_acoes_do_dia_set_organization ON public.acoes_do_dia;

CREATE TRIGGER trg_acoes_do_dia_set_organization
  BEFORE INSERT ON public.acoes_do_dia
  FOR EACH ROW
  EXECUTE FUNCTION public.acoes_do_dia_set_organization();

-- ─── Policy de leitura do admin ──────────────────────────────────────────────
-- Policies do Postgres são OR entre si: esta SOMA à do dono, não a substitui.
-- O membro continua lendo as dele por `auth.uid() = user_id`.
--
-- ⚠️ `is_org_admin()` é SECURITY DEFINER de propósito. Um
-- `SELECT ... FROM team_members` inline aqui causaria recursão infinita no
-- `apply_rls()` do Realtime — a regra do CLAUDE.md raiz. É por isso que o
-- helper existe (20270825000000).
--
-- Só SELECT: o pedido é de visibilidade ("ter uma visão geral da produtividade
-- e das pendências"). Admin não ganha poder de concluir nem apagar tarefa
-- alheia — isso seria escalada que ninguém pediu.

DROP POLICY IF EXISTS "Org admins can view team daily actions" ON public.acoes_do_dia;

CREATE POLICY "Org admins can view team daily actions"
  ON public.acoes_do_dia
  FOR SELECT
  USING (
    organization_id IS NOT NULL
    AND public.is_org_admin(organization_id)
  );
