-- 20280120000000_setores_fundacao.sql
--
-- Setores (fase 1): fundação + escopo de leads, funis e cards.
--
-- Uma org pode ser dividida em setores. Cada setor tem supervisores e
-- membros. O dado de um setor é exclusivo dele; o admin vê tudo.
--
-- MODO derivado da contagem de setores da org (sem flag):
--   0 setores  -> comportamento de hoje (nenhuma policy nova avalia nada)
--   1 setor    -> só o papel de supervisor; o setor é a org inteira
--   2+ setores -> exclusividade completa
--
-- Lead e funil podem estar em vários setores (lead_sectors, pipeline_sectors).
-- SEM LINHA na relação = pertence ao setor padrão (sectors.is_default). Org de
-- 1 setor nunca escreve nessas tabelas.
--
-- Custo: as policies RESTRICTIVE seguem o padrão do regime estrito
-- (private.strict_lead_member_orgs): um array de orgs "regulamentadas",
-- avaliado UMA vez por consulta (initplan). Fora de org com 2+ setores o array
-- é vazio e o OR curto-circuita antes da função por linha.
--
-- Papel por org: a policy NÃO usa is_user_admin() (global, olha qualquer org).
-- Usa team_members.role da PRÓPRIA org, então admin da org A que é membro da
-- org B continua restrito em B.
--
-- Fora desta fatia (fase 2+): chat/WhatsApp, métricas (RPCs DEFINER),
-- campanhas, instâncias, agenda, tarefas, copilot; o regime strict_owner_*
-- (PR #2310) precisa passar a aceitar supervisor; can_update_lead.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ============================================================================
-- 1. Tabelas
-- ============================================================================

CREATE TABLE public.sectors (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                  text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_default            boolean     NOT NULL DEFAULT false,
  responsible_member_id uuid        REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sectors_org_name_uq ON public.sectors (organization_id, lower(btrim(name)));
CREATE UNIQUE INDEX sectors_one_default_per_org ON public.sectors (organization_id) WHERE is_default;

COMMENT ON TABLE public.sectors IS
  'Setores da org. O 1º setor criado vira o padrão (is_default). Modo: 0 setores = como hoje; 1 = só supervisor; 2+ = exclusividade.';

CREATE TABLE public.sector_members (
  sector_id       uuid        NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  team_member_id  uuid        NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sector_role     text        NOT NULL DEFAULT 'member' CHECK (sector_role IN ('supervisor', 'member')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sector_id, team_member_id)
);

CREATE INDEX sector_members_member_idx ON public.sector_members (team_member_id);
CREATE INDEX sector_members_org_idx    ON public.sector_members (organization_id);

CREATE TABLE public.lead_sectors (
  lead_id         uuid        NOT NULL
                    REFERENCES public.leads(id) ON DELETE CASCADE
                    DEFERRABLE INITIALLY DEFERRED,
  sector_id       uuid        NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, sector_id)
);

CREATE INDEX lead_sectors_sector_idx ON public.lead_sectors (sector_id, lead_id);
CREATE INDEX lead_sectors_org_idx    ON public.lead_sectors (organization_id);

COMMENT ON TABLE public.lead_sectors IS
  'Setores do lead (N:N). SEM linha = setor padrão da org. FK adiada para o trigger de criação do lead poder gravar a linha antes do lead existir.';

CREATE TABLE public.pipeline_sectors (
  pipeline_id     uuid        NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  sector_id       uuid        NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pipeline_id, sector_id)
);

CREATE INDEX pipeline_sectors_sector_idx ON public.pipeline_sectors (sector_id, pipeline_id);
CREATE INDEX pipeline_sectors_org_idx    ON public.pipeline_sectors (organization_id);

COMMENT ON TABLE public.pipeline_sectors IS
  'Setores do funil (N:N). SEM linha = setor padrão da org.';

-- ============================================================================
-- 2. Funções de escopo (schema private, DEFINER, search_path vazio)
-- ============================================================================

-- Todos os setores em que o caller é membro (qualquer papel), org ativa.
CREATE FUNCTION private.my_sector_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT sm.sector_id
      FROM public.sector_members sm
      JOIN public.team_members tm ON tm.id = sm.team_member_id
     WHERE tm.user_id = auth.uid()
       AND tm.is_active
       AND NOT public.org_access_blocked(tm.organization_id)
  ), '{}'::uuid[])
$fn$;

-- Setores que o caller SUPERVISIONA.
CREATE FUNCTION private.my_supervised_sector_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT sm.sector_id
      FROM public.sector_members sm
      JOIN public.team_members tm ON tm.id = sm.team_member_id
     WHERE tm.user_id = auth.uid()
       AND tm.is_active
       AND sm.sector_role = 'supervisor'
       AND NOT public.org_access_blocked(tm.organization_id)
  ), '{}'::uuid[])
$fn$;

-- Orgs em que o caller está SUJEITO à exclusividade: org com 2+ setores onde
-- ele é membro ativo e NÃO admin da própria org. Master, service_role e gestor
-- de portfólio ficam de fora. Papel por org, nunca is_user_admin().
CREATE FUNCTION private.sector_scoped_orgs()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT tm.organization_id
      FROM public.team_members tm
     WHERE tm.user_id = auth.uid()
       AND tm.is_active
       AND tm.role <> 'admin'
       AND COALESCE(auth.role(), '') <> 'service_role'
       AND NOT COALESCE(public.is_master_user(), false)
       AND tm.organization_id NOT IN (SELECT public.get_my_gestor_organization_ids())
       AND (SELECT count(*) FROM public.sectors s WHERE s.organization_id = tm.organization_id) >= 2
  ), '{}'::uuid[])
$fn$;

-- Orgs em que o caller supervisiona ao menos um setor (qualquer modo >= 1).
CREATE FUNCTION private.sector_supervisor_orgs()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT s.organization_id
      FROM public.sectors s
     WHERE s.id = ANY (private.my_supervised_sector_ids())
  ), '{}'::uuid[])
$fn$;

-- O lead está em algum dos setores de p_sectors? Sem linha em lead_sectors, o
-- lead é do setor padrão da org.
--
-- VOLATILE de propósito: o trigger BEFORE INSERT de leads grava lead_sectors no
-- mesmo comando, e a checagem da policy de SELECT (INSERT ... RETURNING) roda
-- depois. Uma função STABLE usa o snapshot do início do comando e não enxerga
-- a linha recém-gravada: o criador tomaria "new row violates row-level
-- security policy". Medido em pgTAP; VOLATILE toma snapshot novo a cada chamada.
CREATE FUNCTION private.lead_in_sectors(p_org uuid, p_lead uuid, p_sectors uuid[])
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM public.lead_sectors ls
            WHERE ls.lead_id = p_lead AND ls.sector_id = ANY (p_sectors)
         )
      OR (
           EXISTS (
             SELECT 1 FROM public.sectors s
              WHERE s.organization_id = p_org AND s.is_default AND s.id = ANY (p_sectors)
           )
           AND NOT EXISTS (SELECT 1 FROM public.lead_sectors ls WHERE ls.lead_id = p_lead)
         )
$fn$;

-- Orgs em que um dos MEUS setores é o padrão ("sem linha = setor padrão").
CREATE FUNCTION private.my_default_sector_orgs()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT s.organization_id FROM public.sectors s
     WHERE s.is_default AND s.id = ANY (private.my_sector_ids())
  ), '{}'::uuid[])
$fn$;

CREATE FUNCTION private.my_default_supervised_orgs()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT s.organization_id FROM public.sectors s
     WHERE s.is_default AND s.id = ANY (private.my_supervised_sector_ids())
  ), '{}'::uuid[])
$fn$;

-- Supervisor de org com UM setor: o setor é a org inteira. Sem custo por linha.
CREATE FUNCTION private.sector_supervisor_orgs_m1()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT s.organization_id FROM public.sectors s
     WHERE s.id = ANY (private.my_supervised_sector_ids())
       AND (SELECT count(*) FROM public.sectors x WHERE x.organization_id = s.organization_id) = 1
  ), '{}'::uuid[])
$fn$;

-- Supervisor de org com 2+ setores: precisa checar o setor do lead.
CREATE FUNCTION private.sector_supervisor_orgs_m2()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT s.organization_id FROM public.sectors s
     WHERE s.id = ANY (private.my_supervised_sector_ids())
       AND (SELECT count(*) FROM public.sectors x WHERE x.organization_id = s.organization_id) >= 2
  ), '{}'::uuid[])
$fn$;

-- Funis dos MEUS setores (ou sem linha em pipeline_sectors, se tenho o setor
-- padrão), nas orgs reguladas. Uma consulta por statement: cards e funis viram
-- `pipeline_id = ANY (...)`, sem função por linha.
CREATE FUNCTION private.my_sector_pipeline_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(ARRAY(
    SELECT p.id
      FROM public.pipelines p
     WHERE p.organization_id = ANY (private.sector_scoped_orgs())
       AND (
         EXISTS (SELECT 1 FROM public.pipeline_sectors ps
                  WHERE ps.pipeline_id = p.id AND ps.sector_id = ANY (private.my_sector_ids()))
         OR (p.organization_id = ANY (private.my_default_sector_orgs())
             AND NOT EXISTS (SELECT 1 FROM public.pipeline_sectors ps2 WHERE ps2.pipeline_id = p.id))
       )
  ), '{}'::uuid[])
$fn$;

-- A transação corrente já escreveu algo? (xid atribuído.) Em transação só de
-- leitura (a maioria das requisições) não há xid e devolve falso/NULL, sem custo.
CREATE FUNCTION private.xact_has_writes()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT pg_current_xact_id_if_assigned() IS NOT NULL
$fn$;
-- Mapa lead -> setor SEM RLS (a view roda com os direitos do dono). Existe só
-- para as policies de leads sondarem por linha com um índice, sem chamar função
-- e sem refazer a RLS de lead_sectors a cada sondagem. Não é exposta pela API.
CREATE VIEW private.lead_sector_map AS
  SELECT lead_id, sector_id FROM public.lead_sectors;

COMMENT ON VIEW private.lead_sector_map IS
  'Mapa lead->setor sem RLS, só para as policies de leads (sondagem por índice). Não exponha.';
REVOKE ALL ON FUNCTION private.my_sector_ids()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.my_supervised_sector_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.sector_scoped_orgs()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.sector_supervisor_orgs()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.lead_in_sectors(uuid, uuid, uuid[])     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.my_sector_ids()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.my_supervised_sector_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sector_scoped_orgs()       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sector_supervisor_orgs()   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.lead_in_sectors(uuid, uuid, uuid[])     TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.my_default_sector_orgs()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.my_default_supervised_orgs()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.sector_supervisor_orgs_m1()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.sector_supervisor_orgs_m2()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.my_sector_pipeline_ids()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.xact_has_writes()             FROM PUBLIC, anon;
REVOKE ALL ON private.lead_sector_map                        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.my_default_sector_orgs()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.my_default_supervised_orgs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sector_supervisor_orgs_m1()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sector_supervisor_orgs_m2()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.my_sector_pipeline_ids()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.xact_has_writes()            TO authenticated, service_role;
GRANT SELECT ON private.lead_sector_map                        TO authenticated, service_role;
-- ============================================================================
-- 3. Integridade: item e setor sempre da mesma org
-- ============================================================================

CREATE FUNCTION private.sectors_check_sector_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sectors s
     WHERE s.id = NEW.sector_id AND s.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'setor de outra organização' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION private.sectors_check_member_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members tm
     WHERE tm.id = NEW.team_member_id AND tm.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'membro de outra organização' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION private.sectors_check_pipeline_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
     WHERE p.id = NEW.pipeline_id AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'funil de outra organização' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;

-- O lead pode não existir ainda quando a linha é gravada (trigger de criação),
-- então a checagem de org do lead é adiada para o fim da transação.
CREATE FUNCTION private.sectors_check_lead_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.id = NEW.lead_id AND l.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'lead de outra organização' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER trg_sector_members_check_sector BEFORE INSERT OR UPDATE ON public.sector_members
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_sector_org();
CREATE TRIGGER trg_sector_members_check_member BEFORE INSERT OR UPDATE ON public.sector_members
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_member_org();
CREATE TRIGGER trg_lead_sectors_check_sector BEFORE INSERT OR UPDATE ON public.lead_sectors
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_sector_org();
CREATE CONSTRAINT TRIGGER trg_lead_sectors_check_lead AFTER INSERT OR UPDATE ON public.lead_sectors
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_lead_org();
CREATE TRIGGER trg_pipeline_sectors_check_sector BEFORE INSERT OR UPDATE ON public.pipeline_sectors
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_sector_org();
CREATE TRIGGER trg_pipeline_sectors_check_pipeline BEFORE INSERT OR UPDATE ON public.pipeline_sectors
  FOR EACH ROW EXECUTE FUNCTION private.sectors_check_pipeline_org();

-- O 1º setor da org vira o padrão.
CREATE FUNCTION private.sectors_first_is_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sectors s WHERE s.organization_id = NEW.organization_id) THEN
    NEW.is_default := true;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_sectors_first_is_default BEFORE INSERT ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION private.sectors_first_is_default();

-- Não se apaga o setor padrão enquanto existirem outros na org. (Apagar a org
-- inteira passa: a org já não existe quando o cascade chega aqui.)
CREATE FUNCTION private.sectors_guard_default_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.is_default
     AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.sectors s
                  WHERE s.organization_id = OLD.organization_id AND s.id <> OLD.id) THEN
    RAISE EXCEPTION 'o setor padrão não pode ser apagado enquanto houver outros setores' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END
$fn$;

CREATE TRIGGER trg_sectors_guard_default_delete BEFORE DELETE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION private.sectors_guard_default_delete();

-- Lead criado por membro de org regulada herda os setores do criador. Sem isto
-- o lead cairia no setor padrão e o próprio criador (de outro setor) deixaria
-- de enxergá-lo.
CREATE FUNCTION private.leads_inherit_creator_sector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]) THEN
    INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
    SELECT NEW.id, sm.sector_id, NEW.organization_id
      FROM public.sector_members sm
      JOIN public.team_members tm ON tm.id = sm.team_member_id
     WHERE tm.user_id = auth.uid()
       AND tm.organization_id = NEW.organization_id
       AND tm.is_active
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trg_leads_inherit_creator_sector BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION private.leads_inherit_creator_sector();

REVOKE ALL ON FUNCTION private.leads_inherit_creator_sector() FROM PUBLIC, anon;

-- ============================================================================
-- 4. RLS das tabelas novas
-- ============================================================================

ALTER TABLE public.sectors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sectors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_sectors ENABLE ROW LEVEL SECURITY;

-- sectors: todo membro da org lê (precisa do nome do setor); escreve o admin
-- da PRÓPRIA org (sem gestor: gestor é só leitura).
CREATE POLICY sectors_read_own_org ON public.sectors FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));
CREATE POLICY sectors_admin_write ON public.sectors FOR ALL
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));
CREATE POLICY sectors_master ON public.sectors FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY sectors_service_role ON public.sectors FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Relações: o membro lê só as linhas dos setores dele; o admin lê e escreve as
-- da org; gestor de portfólio lê.
CREATE POLICY sector_members_read ON public.sector_members FOR SELECT
  USING (
    sector_id = ANY ((SELECT private.my_sector_ids())::uuid[])
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );
CREATE POLICY sector_members_admin_write ON public.sector_members FOR ALL
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));
CREATE POLICY sector_members_master ON public.sector_members FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY sector_members_service_role ON public.sector_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY lead_sectors_read ON public.lead_sectors FOR SELECT
  USING (
    sector_id = ANY ((SELECT private.my_sector_ids())::uuid[])
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );
CREATE POLICY lead_sectors_admin_write ON public.lead_sectors FOR ALL
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));
CREATE POLICY lead_sectors_master ON public.lead_sectors FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY lead_sectors_service_role ON public.lead_sectors FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY pipeline_sectors_read ON public.pipeline_sectors FOR SELECT
  USING (
    sector_id = ANY ((SELECT private.my_sector_ids())::uuid[])
    OR organization_id IN (SELECT public.get_my_admin_organization_ids())
  );
CREATE POLICY pipeline_sectors_admin_write ON public.pipeline_sectors FOR ALL
  USING (organization_id IN (SELECT public.get_my_team_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_team_admin_organization_ids()));
CREATE POLICY pipeline_sectors_master ON public.pipeline_sectors FOR ALL
  USING ((SELECT public.is_master_user()))
  WITH CHECK ((SELECT public.is_master_user()));
CREATE POLICY pipeline_sectors_service_role ON public.pipeline_sectors FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.sectors, public.sector_members, public.lead_sectors, public.pipeline_sectors
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.sectors, public.sector_members, public.lead_sectors, public.pipeline_sectors
  TO authenticated;
GRANT ALL
  ON public.sectors, public.sector_members, public.lead_sectors, public.pipeline_sectors
  TO service_role;

-- ============================================================================
-- 5. Escopo de leads, funis e cards
-- ============================================================================

-- 5a. RESTRICTIVE: em org regulada, todo não-admin só alcança o que é do setor
-- dele. Vale também para quem tem leads.view_all (default true).
--
-- Custo (medido em volume, 13 mil leads): subconsulta ESCALAR com bool_or sobre
-- a view sem RLS = uma sondagem de índice por linha, sem chamar função. Um
-- EXISTS correlacionado seria convertido pelo planejador em SubPlan hashed e
-- leria lead_sectors inteira até para uma lista de 50; a função por linha
-- custava ~28 µs/linha. Lead sem linha em lead_sectors devolve NULL no escalar
-- e cai no COALESCE: é do setor padrão.
--
-- O 3º braço cobre INSERT ... RETURNING: a subconsulta usa o snapshot do
-- comando e não vê a linha de lead_sectors gravada pelo trigger BEFORE INSERT
-- (e a linha nova ainda não existe na checagem, então xmin não ajuda). Só em
-- transação que já escreveu (xid atribuído), reavalia com a função VOLATILE
-- (snapshot novo). Em leitura pura o braço é falso e não custa nada.
CREATE POLICY sector_scope_leads_select ON public.leads AS RESTRICTIVE FOR SELECT
  USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR COALESCE(
         (SELECT bool_or(m.sector_id = ANY ((SELECT private.my_sector_ids())::uuid[]))
            FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
         organization_id = ANY ((SELECT private.my_default_sector_orgs())::uuid[]))
    OR (private.xact_has_writes()
        AND private.lead_in_sectors(organization_id, id, (SELECT private.my_sector_ids())))
  );
CREATE POLICY sector_scope_leads_update ON public.leads AS RESTRICTIVE FOR UPDATE
  USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR COALESCE(
         (SELECT bool_or(m.sector_id = ANY ((SELECT private.my_sector_ids())::uuid[]))
            FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
         organization_id = ANY ((SELECT private.my_default_sector_orgs())::uuid[]))
    OR (private.xact_has_writes()
        AND private.lead_in_sectors(organization_id, id, (SELECT private.my_sector_ids())))
  );
CREATE POLICY sector_scope_leads_delete ON public.leads AS RESTRICTIVE FOR DELETE
  USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR COALESCE(
         (SELECT bool_or(m.sector_id = ANY ((SELECT private.my_sector_ids())::uuid[]))
            FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
         organization_id = ANY ((SELECT private.my_default_sector_orgs())::uuid[]))
  );

CREATE POLICY sector_scope_pipelines_select ON public.pipelines AS RESTRICTIVE FOR SELECT
  USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR id = ANY ((SELECT private.my_sector_pipeline_ids())::uuid[])
  );

CREATE POLICY sector_scope_pipeline_entries_select ON public.pipeline_entries AS RESTRICTIVE FOR SELECT
  USING (
    NOT (organization_id = ANY ((SELECT private.sector_scoped_orgs())::uuid[]))
    OR pipeline_id = ANY ((SELECT private.my_sector_pipeline_ids())::uuid[])
  );

-- 5b. PERMISSIVE: o supervisor enxerga e edita todos os leads dos setores que
-- supervisiona. Org de 1 setor: o setor é a org inteira, decidido por org (sem
-- custo por linha). Org de 2+ setores: confere o setor do lead.
CREATE POLICY sector_supervisor_leads_select ON public.leads FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      organization_id = ANY ((SELECT private.sector_supervisor_orgs_m1())::uuid[])
      OR (
        organization_id = ANY ((SELECT private.sector_supervisor_orgs_m2())::uuid[])
        AND (
          COALESCE(
            (SELECT bool_or(m.sector_id = ANY ((SELECT private.my_supervised_sector_ids())::uuid[]))
               FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
            organization_id = ANY ((SELECT private.my_default_supervised_orgs())::uuid[]))
          OR (private.xact_has_writes()
              AND private.lead_in_sectors(organization_id, id, (SELECT private.my_supervised_sector_ids())))
        )
      )
    )
  );
CREATE POLICY sector_supervisor_leads_update ON public.leads FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      organization_id = ANY ((SELECT private.sector_supervisor_orgs_m1())::uuid[])
      OR (
        organization_id = ANY ((SELECT private.sector_supervisor_orgs_m2())::uuid[])
        AND (
          COALESCE(
            (SELECT bool_or(m.sector_id = ANY ((SELECT private.my_supervised_sector_ids())::uuid[]))
               FROM private.lead_sector_map m WHERE m.lead_id = leads.id),
            organization_id = ANY ((SELECT private.my_default_supervised_orgs())::uuid[]))
          OR (private.xact_has_writes()
              AND private.lead_in_sectors(organization_id, id, (SELECT private.my_supervised_sector_ids())))
        )
      )
    )
  );
-- ============================================================================
-- 6. Backfill ao criar o 2º setor (chamado pelo admin; dry-run por padrão)
-- ============================================================================
-- 1) membros ativos sem setor entram no setor padrão;
-- 2) lead recebe os setores dos funis em que tem card (funil vence);
-- 3) lead sem funil de setor recebe os setores (não padrão) dos donos.
-- Sobra = setor padrão (sem linha).

CREATE FUNCTION public.sectors_backfill(p_org uuid, p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_default uuid;
  v_members integer;
  v_funnel  integer;
  v_owner   integer;
BEGIN
  IF NOT (
    COALESCE(public.is_master_user(), false)
    OR p_org IN (SELECT public.get_my_team_admin_organization_ids())
  ) THEN
    RAISE EXCEPTION 'sem permissão para administrar setores desta organização' USING ERRCODE = '42501';
  END IF;

  SELECT s.id INTO v_default
    FROM public.sectors s
   WHERE s.organization_id = p_org AND s.is_default;
  IF v_default IS NULL THEN
    RAISE EXCEPTION 'a organização ainda não tem setores' USING ERRCODE = 'P0001';
  END IF;

  WITH missing AS (
    SELECT tm.id AS team_member_id
      FROM public.team_members tm
     WHERE tm.organization_id = p_org
       AND tm.is_active
       AND tm.role <> 'admin'
       AND NOT EXISTS (SELECT 1 FROM public.sector_members sm WHERE sm.team_member_id = tm.id)
  ), ins AS (
    INSERT INTO public.sector_members (sector_id, team_member_id, organization_id, sector_role)
    SELECT v_default, m.team_member_id, p_org, 'member' FROM missing m WHERE p_apply
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_members FROM missing;

  WITH f AS (
    SELECT DISTINCT pe.lead_id, ps.sector_id
      FROM public.pipeline_entries pe
      JOIN public.pipeline_sectors ps ON ps.pipeline_id = pe.pipeline_id
     WHERE pe.organization_id = p_org
       AND ps.organization_id = p_org
       AND pe.lead_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.lead_sectors ls
          WHERE ls.lead_id = pe.lead_id AND ls.sector_id = ps.sector_id
       )
  ), owners AS (
    SELECT l.id AS lead_id, x.mid
      FROM public.leads l
     CROSS JOIN LATERAL (VALUES (l.sdr_id), (l.closer_id),
                                (l.pre_sale_responsible_id), (l.sale_responsible_id)) x(mid)
     WHERE l.organization_id = p_org AND l.deleted_at IS NULL AND x.mid IS NOT NULL
    UNION
    SELECT lo.lead_id, lo.team_member_id
      FROM public.lead_owners lo
     WHERE lo.organization_id = p_org
  ), o AS (
    SELECT DISTINCT ow.lead_id, sm.sector_id
      FROM owners ow
      JOIN public.sector_members sm ON sm.team_member_id = ow.mid
      JOIN public.sectors s ON s.id = sm.sector_id AND NOT s.is_default
     WHERE NOT EXISTS (SELECT 1 FROM f WHERE f.lead_id = ow.lead_id)
       AND NOT EXISTS (SELECT 1 FROM public.lead_sectors ls WHERE ls.lead_id = ow.lead_id)
  ), insf AS (
    INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
    SELECT f.lead_id, f.sector_id, p_org FROM f WHERE p_apply
    ON CONFLICT DO NOTHING
    RETURNING 1
  ), inso AS (
    INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
    SELECT o.lead_id, o.sector_id, p_org FROM o WHERE p_apply
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM f), (SELECT count(*) FROM o) INTO v_funnel, v_owner;

  RETURN jsonb_build_object(
    'applied', p_apply,
    'members_to_default_sector', v_members,
    'lead_sector_rows_by_funnel', v_funnel,
    'lead_sector_rows_by_owner', v_owner
  );
END
$fn$;

COMMENT ON FUNCTION public.sectors_backfill(uuid, boolean) IS
  'Backfill de setores de uma org: membros sem setor vão ao padrão; leads herdam setores pelo funil e, na falta, pelo dono. p_apply=false só conta.';

REVOKE ALL ON FUNCTION public.sectors_backfill(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sectors_backfill(uuid, boolean) TO authenticated, service_role;

COMMIT;
