-- Campos personalizados do lead seguem a org EM USO, não a primeira do usuário.
--
-- ── O DEFEITO ───────────────────────────────────────────────────────────────
-- As quatro policies de `lead_custom_fields` resolviam o tenant com
-- `get_user_organization_id()`, que é:
--
--     SELECT organization_id FROM team_members
--     WHERE user_id = auth.uid() AND is_active
--     ORDER BY created_at ASC, id ASC
--     LIMIT 1
--
-- ou seja: a PRIMEIRA org do usuário, por data de vínculo — não a org que ele
-- selecionou no switcher. Para quem pertence a uma org só, os dois valores
-- coincidem e nada aparece. Para quem pertence a duas ou mais, a RLS entrega as
-- definições da org errada.
--
-- Medido em prod (2026-09-02), org Sampaio e Moraes
-- (`b48d14fe-2d4f-481b-9209-61c22f8df6bc`): João Victor é admin de 5 orgs e a
-- primeira dele é a Bolivar. O front pede `lead_custom_fields` com
-- `.eq("organization_id", <Sampaio>)` (`useLeadCustomFields.ts:36`) e a RLS só
-- devolve linhas da Bolivar — interseção vazia. Como `separarCamposDaOrg`
-- (`useLeadCardData.ts:151`) itera as DEFINIÇÕES, o bloco "Perfil" do card do
-- Negócio nasce sem nenhum campo do formulário e "Campos a preencher" some
-- inteiro. Os outros 4 membros da org, de org única, viam os 6 campos normal.
--
-- Não há bypass de admin nessa policy: ser admin não ajudava. Quem enxergava
-- era só o master, pelas `master_ghost_*`, que não filtram org — e é por isso
-- que o bug se apresenta como "no master eu vejo, no cliente não".
--
-- ── A CORREÇÃO ──────────────────────────────────────────────────────────────
-- `organization_id IN (SELECT get_my_organization_ids())` — o conjunto de orgs
-- do usuário, que é o mesmo predicado que `leads`, `deals` e `pipeline_entries`
-- já usam. Continua estritamente escopado por tenant: ninguém passa a ver org de
-- que não participa. Três efeitos colaterais, todos desejados:
--
--   1. multi-org passa a ver os campos de QUALQUER org sua — o front já filtra
--      pela org selecionada, então na tela aparece exatamente a org em uso;
--   2. gestor de portfólio passa a ver as definições das orgs que gerencia.
--      `get_my_member_organization_ids()` faz UNION com
--      `get_my_gestor_organization_ids()`. Isto fecha uma assimetria real:
--      `lead_custom_field_values` JÁ tinha cláusula de gestor, e as definições
--      não — o gestor via as respostas e nenhum rótulo. (0 gestores ativos em
--      prod hoje, então é correção latente.)
--   3. org com cobrança suspensa/cancelada/expirada sai do conjunto —
--      `get_my_organization_ids()` filtra por `org_access_blocked()`. É um
--      aperto, não uma folga, e alinha esta tabela com o resto do schema.
--
-- ⚠️ ESCOPO: só a resolução do tenant muda. Quem pode ESCREVER continua sendo
-- qualquer membro autenticado da org, como era antes desta migration — se isso
-- deve virar admin-only é outra decisão, e não se toma de carona.
--
-- As policies `master_ghost_*` não são tocadas.

BEGIN;

-- SELECT ---------------------------------------------------------------------
DROP POLICY IF EXISTS lead_custom_fields_select_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_select_organization
  ON public.lead_custom_fields
  FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- INSERT ---------------------------------------------------------------------
DROP POLICY IF EXISTS lead_custom_fields_insert_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_insert_organization
  ON public.lead_custom_fields
  FOR INSERT
  TO authenticated
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

-- UPDATE ---------------------------------------------------------------------
DROP POLICY IF EXISTS lead_custom_fields_update_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_update_organization
  ON public.lead_custom_fields
  FOR UPDATE
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()));

-- DELETE ---------------------------------------------------------------------
DROP POLICY IF EXISTS lead_custom_fields_delete_organization ON public.lead_custom_fields;
CREATE POLICY lead_custom_fields_delete_organization
  ON public.lead_custom_fields
  FOR DELETE
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- As RESPOSTAS: a policy irmã em `lead_custom_field_values` tinha o mesmo
-- `get_user_organization_id()` singular e adoecia do mesmo jeito para o
-- multi-org. Aqui ela some, e não é troca por equivalente: a outra policy de
-- SELECT da mesma tabela (`lead_custom_field_values_select_by_lead`) já cobre o
-- caso legítimo com o predicado CERTO — org plural E o mesmo recorte de
-- responsabilidade que `leads` usa (admin, responsável, sem-dono, gestor).
--
-- A que sai era mais LARGA que a RLS de `leads`: liberava as respostas de
-- QUALQUER lead da org a qualquer autenticado dela, mesmo quando a policy de
-- `leads` escondia o lead daquela pessoa. Numa org que restringe visibilidade
-- por vendedor (HGE, SORVFOODS, Bolivar têm as chaves `leads.view_*` em false),
-- as respostas do formulário — comprador, faturamento, volume — vazavam por
-- chamada direta ao PostgREST. A UI nunca expôs esse caminho porque o modal
-- precisa do lead; a RLS expunha.
--
-- ⚠️ NÃO basta apagar a larga e ficar com a `_select_by_lead` que existe hoje:
-- o recorte dela é MAIS ESTREITO que o de `leads`. Falta-lhe
-- `has_feature_permission('leads.view_all')` — cujo default de catálogo é
-- `true` — e `is_user_responsible_in_any_pipe()`. Um membro que enxerga o lead
-- por `view_all`, e não por responsabilidade, perderia as respostas: regressão
-- silenciosa em toda org que nunca mexeu nessas chaves, que são quase todas.
--
-- Por isso ela é REESCRITA espelhando termo a termo a
-- `leads_select_by_responsibility_and_permissions`, mais a cláusula de gestor
-- que já existia. A regra passa a ser exatamente esta: **quem enxerga o lead
-- enxerga as respostas dele; quem não enxerga, não.** Único desvio deliberado
-- do espelho: não se replica o `deleted_at IS NULL`, porque a policy antiga
-- também não filtrava, e a ficha do lead na lixeira já tem estado próprio.
DROP POLICY IF EXISTS lead_custom_field_values_select_organization ON public.lead_custom_field_values;
DROP POLICY IF EXISTS lead_custom_field_values_select_by_lead ON public.lead_custom_field_values;
CREATE POLICY lead_custom_field_values_select_by_lead
  ON public.lead_custom_field_values
  FOR SELECT
  TO authenticated
  USING (
    lead_id IN (
      SELECT l.id
      FROM public.leads l
      WHERE l.organization_id IN (SELECT public.get_my_organization_ids())
        AND (
          (SELECT public.is_user_admin())
          OR public.has_feature_permission('leads.view_all', l.organization_id)
          OR public.is_user_responsible(l.pre_sale_responsible_id, l.sale_responsible_id)
          OR public.can_see_lead_by_permissions(l.sdr_id, l.closer_id)
          OR public.is_user_responsible_in_any_pipe(l.id)
          OR l.organization_id IN (SELECT public.get_my_gestor_organization_ids())
        )
    )
  );

COMMIT;
