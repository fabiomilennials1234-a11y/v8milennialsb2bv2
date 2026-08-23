-- 20270811110000_metrics_studio_panels.sql
--
-- SCRUM-309: o painel do Estúdio de Métricas passa a viver no servidor, não no
-- localStorage do navegador.
--
-- POR QUE TABELA NOVA E NÃO dashboard_pages/dashboard_widgets
--
-- A spec mandava reusar. Medido em prod (2026-08-11), o reuso não encaixa em
-- QUATRO pontos, e três deles exigiriam alterar uma tabela de que a TV depende:
--
--   1. FORMA. dashboard_widgets é GRADE: grid_col, grid_row, grid_w, grid_h.
--      Zero colunas de pixel. O Estúdio é canvas livre (x, y, w, h em px).
--      Guardar px naquelas colunas seria mentir para o renderer da TV, que lê
--      as mesmas colunas como célula de grade.
--   2. SUPERFÍCIE. dashboard_pages.surface tem CHECK ('tv','command'). Só 'tv'
--      em uso.
--   3. ACOPLAMENTO. validate_widget_against_catalog exige
--      composable_metrics_enabled = true (P0001). Salvar do Estúdio obrigaria
--      a org a ter também a flag da TV — exatamente o acoplamento que o G5
--      rejeitou ao criar metrics_studio_enabled.
--   4. DONO. Escrita em dashboard_widgets é admin-only. O painel do Estúdio é
--      DO USUÁRIO: um membro precisa salvar o dele sem ser admin.
--
-- Painel compartilhado da org fica para outro ticket. Aqui, um painel por
-- (org, membro) — a mesma granularidade que o localStorage já tinha.
--
-- SEM FUNÇÃO NOVA. Leitura e escrita vão por PostgREST com RLS, então não há a
-- armadilha do GRANT em SECURITY DEFINER. O isolamento é o mesmo do resto do
-- sistema: get_my_organization_ids() e get_my_team_member_ids(), nunca
-- subquery inline em team_members (recursão no apply_rls do Realtime).
--
-- DDL PURA (guarda F4): cria tabela, índice e policies. Nenhum dado de cliente
-- é escrito ou migrado. Quem já tem painel em localStorage continua com ele até
-- salvar pela primeira vez.
--
-- ROLLBACK pareado: rollback/20270811110000_metrics_studio_panels.sql

CREATE TABLE IF NOT EXISTS public.metrics_studio_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,

  -- Lista de janelas. Formato validado no cliente (metrics-studio-engine-map)
  -- e limitado aqui em quantidade: jsonb sem teto é vetor de inchaço de linha.
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metrics_studio_panels_layout_is_array
    CHECK (jsonb_typeof(layout) = 'array'),
  -- 24 janelas é o dobro do teto da parede da TV (12) e muito acima do uso
  -- real. Existe para impedir payload absurdo, não para limitar o usuário.
  CONSTRAINT metrics_studio_panels_layout_max
    CHECK (jsonb_array_length(layout) <= 24),
  -- Um painel por membro por org. O upsert do cliente depende desta chave.
  CONSTRAINT metrics_studio_panels_unico_por_membro
    UNIQUE (organization_id, team_member_id)
);

COMMENT ON TABLE public.metrics_studio_panels IS
  'Painel do Estúdio de Métricas (/metricas), por membro. SCRUM-309. Substitui '
  'o localStorage. NÃO reusa dashboard_widgets porque aquela é grade, é '
  'admin-only e o trigger dela exige composable_metrics_enabled.';

CREATE INDEX IF NOT EXISTS idx_metrics_studio_panels_org_member
  ON public.metrics_studio_panels (organization_id, team_member_id);

ALTER TABLE public.metrics_studio_panels ENABLE ROW LEVEL SECURITY;

-- Cada um enxerga e mexe SÓ no próprio painel, dentro da própria org.
-- As duas condições juntas: org por get_my_organization_ids(), membro por
-- get_my_team_member_ids(). Sem WITH CHECK, INSERT/UPDATE seriam escalada.
DROP POLICY IF EXISTS metrics_studio_panels_select ON public.metrics_studio_panels;
CREATE POLICY metrics_studio_panels_select
  ON public.metrics_studio_panels FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND team_member_id IN (SELECT public.get_my_team_member_ids())
  );

DROP POLICY IF EXISTS metrics_studio_panels_insert ON public.metrics_studio_panels;
CREATE POLICY metrics_studio_panels_insert
  ON public.metrics_studio_panels FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND team_member_id IN (SELECT public.get_my_team_member_ids())
  );

DROP POLICY IF EXISTS metrics_studio_panels_update ON public.metrics_studio_panels;
CREATE POLICY metrics_studio_panels_update
  ON public.metrics_studio_panels FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND team_member_id IN (SELECT public.get_my_team_member_ids())
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND team_member_id IN (SELECT public.get_my_team_member_ids())
  );

DROP POLICY IF EXISTS metrics_studio_panels_delete ON public.metrics_studio_panels;
CREATE POLICY metrics_studio_panels_delete
  ON public.metrics_studio_panels FOR DELETE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND team_member_id IN (SELECT public.get_my_team_member_ids())
  );

-- Master NÃO ganha policy aqui de propósito: painel pessoal de membro não é
-- dado de operação que o master precise ler, e toda superfície a mais é
-- superfície a defender. Se virar necessidade (suporte reproduzindo tela do
-- cliente), entra numa migration própria, com o motivo escrito.

-- Sem GRANT a anon. `authenticated` já recebe o grant padrão do schema; o que
-- barra é a RLS acima.
REVOKE ALL ON TABLE public.metrics_studio_panels FROM anon;

-- updated_at automático, no padrão do repo.
DROP TRIGGER IF EXISTS trg_metrics_studio_panels_updated_at ON public.metrics_studio_panels;
CREATE TRIGGER trg_metrics_studio_panels_updated_at
  BEFORE UPDATE ON public.metrics_studio_panels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
