-- 20270828000010_metrics_studio_panel_por_org.sql
--
-- O painel do Estúdio deixa de ser POR MEMBRO e passa a ser DA ORGANIZAÇÃO:
-- admin de equipe e master editam, todo membro visualiza.
-- Decisão do CTO em 2026-08-25.
--
-- POR QUE A MUDANÇA DE SEMÂNTICA É NECESSÁRIA, e não só o gate de escrita.
-- A tabela nasceu com um painel por (org, membro) — cada pessoa montava o seu.
-- Tirar a edição do membro sem mudar isso deixaria cada membro preso ao painel
-- DELE, vazio, para sempre: não existiria nada para "visualizar". Um painel só,
-- da org, é o que faz "todos visualizam" ter objeto.
--
-- ESTE É O MOMENTO MAIS BARATO. Medido em prod 2026-08-25, minutos antes:
-- `metrics_studio_panels` tem ZERO linhas em todas as 107 orgs. Nenhum cliente
-- perde painel montado, porque não há painel montado. Depois de a feature rodar
-- uma semana, esta mesma migration precisaria escolher QUAL painel vira o da
-- org — e essa escolha não tem resposta certa.
--
-- `team_member_id` vira NULÁVEL e muda de sentido: era o DONO, passa a ser
-- QUEM EDITOU POR ÚLTIMO. Nulável porque master não tem linha em `team_members`
-- e o front monta para ele um id virtual (`master-virtual-<uuid>`), que não é
-- uuid de `team_members` — era exatamente isto que impedia master de salvar
-- painel. Com a coluna nulável, o front manda NULL em vez do id virtual.
--
-- ROLLBACK pareado: rollback/20270828000010_metrics_studio_panel_por_org.sql

-- ── Guarda ANTES de qualquer DDL ────────────────────────────────────────────
-- Se alguma org já tiver mais de um painel, a unicidade por org não pode ser
-- criada sem ESCOLHER um e descartar os outros. Escolher dado de cliente não é
-- trabalho de migration (guarda F4): aborta e deixa a decisão para um humano.
DO $$
DECLARE
  v_org uuid;
  v_qtd bigint;
BEGIN
  SELECT organization_id, count(*)
    INTO v_org, v_qtd
    FROM public.metrics_studio_panels
   GROUP BY organization_id
  HAVING count(*) > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'org % tem % painéis; resolva qual vira o painel da organização antes de aplicar',
      v_org, v_qtd;
  END IF;
END $$;

ALTER TABLE public.metrics_studio_panels
  ALTER COLUMN team_member_id DROP NOT NULL;

COMMENT ON COLUMN public.metrics_studio_panels.team_member_id IS
  'Quem editou por último — NÃO é dono. NULL quando quem editou foi master '
  '(não tem linha em team_members). O painel pertence à organização.';

-- A unicidade passa a ser por ORG. A antiga era `(organization_id,
-- team_member_id)` e permitia N painéis por org — é justamente o que deixa de
-- valer. Nomes conferidos em prod: a unicidade é CONSTRAINT (`contype = 'u'`),
-- então sai por ALTER TABLE; `DROP INDEX` no nome dela erraria com
-- "cannot drop index ... because constraint requires it".
ALTER TABLE public.metrics_studio_panels
  DROP CONSTRAINT IF EXISTS metrics_studio_panels_unico_por_membro;

-- O índice de busca por (org, membro) perde a razão de existir: ninguém mais
-- consulta por membro, e ele passaria a ser escrita paga sem leitura.
DROP INDEX IF EXISTS public.idx_metrics_studio_panels_org_member;

CREATE UNIQUE INDEX IF NOT EXISTS metrics_studio_panels_org_unico
  ON public.metrics_studio_panels (organization_id);

-- ── Policies ────────────────────────────────────────────────────────────────
-- Forma IDÊNTICA à de `metric_custom_definitions`, que já passou pelo crivo de
-- segurança: leitura por membro da org, escrita por admin de equipe, master por
-- policy própria. Repetir a forma é deliberado — duas tabelas da mesma feature
-- com regras diferentes é como nasce o buraco que ninguém enxerga.
DROP POLICY IF EXISTS metrics_studio_panels_select ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_insert ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_update ON public.metrics_studio_panels;
DROP POLICY IF EXISTS metrics_studio_panels_delete ON public.metrics_studio_panels;

-- LEITURA: qualquer membro ativo da org. É o "todos podem visualizar".
CREATE POLICY metrics_studio_panels_select
  ON public.metrics_studio_panels
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- ESCRITA: admin de equipe (`role = 'admin' AND is_active`), e mais nada.
-- `get_my_team_admin_organization_ids()`, NÃO `get_my_admin_organization_ids()`
-- — a segunda inclui o GESTOR DE PORTFÓLIO (ADR-0021), que é escopado a funis e
-- não deve reescrever o painel da organização inteira.
CREATE POLICY metrics_studio_panels_insert
  ON public.metrics_studio_panels
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

CREATE POLICY metrics_studio_panels_update
  ON public.metrics_studio_panels
  FOR UPDATE
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

CREATE POLICY metrics_studio_panels_delete
  ON public.metrics_studio_panels
  FOR DELETE
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));

DROP POLICY IF EXISTS master_ghost_all_metrics_studio_panels ON public.metrics_studio_panels;

CREATE POLICY master_ghost_all_metrics_studio_panels
  ON public.metrics_studio_panels
  FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));

-- ── Guarda de saída ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_leitura text;
  v_escrita text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'metrics_studio_panels_org_unico'
  ) THEN
    RAISE EXCEPTION 'unicidade por org não foi criada — painel da org não é único';
  END IF;

  SELECT pg_get_expr(polqual, polrelid) INTO v_leitura
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'metrics_studio_panels' AND p.polname = 'metrics_studio_panels_select';

  IF v_leitura IS NULL OR v_leitura NOT LIKE '%get_my_organization_ids%' THEN
    RAISE EXCEPTION 'policy de leitura ausente ou fora de get_my_organization_ids';
  END IF;

  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_escrita
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'metrics_studio_panels' AND p.polname = 'metrics_studio_panels_insert';

  -- Se a escrita cair na helper permissiva, o gestor de portfólio ganha o
  -- painel da org inteira sem ninguém perceber. Reprova alto.
  IF v_escrita IS NULL OR v_escrita NOT LIKE '%get_my_team_admin_organization_ids%' THEN
    RAISE EXCEPTION 'policy de escrita ausente ou usando a helper errada';
  END IF;
END $$;
