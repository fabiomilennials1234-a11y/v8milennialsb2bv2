-- 20280110000000_agenda_de_contatos.sql
--
-- Agenda de contatos: o marcador de PRÓXIMO PONTO DE CONTATO com o cliente
-- (Café Jurerê, 10/11). Hoje ela vive numa planilha fora do Torque — Cliente,
-- Empresa, Data da agenda, dados do cliente. Aqui ela vira uma linha por
-- (cliente, dono): marcar de novo o mesmo cliente REMARCA a data, não cria
-- uma segunda agenda. A agenda só sai quando o dono clica no X (`concluida_em`);
-- atrasada continua na lista, em vermelho, até alguém agir.
--
-- ADITIVA: tabela nova + 5 funções novas. Nada existente muda. O Comando só
-- mostra a agenda com a flag `comando_agenda_contatos` (front); sem ela a
-- tabela fica vazia e nada lê dela.
--
-- ── Segurança ────────────────────────────────────────────────────────────
-- Funções SECURITY INVOKER: quem decide é a RLS da tabela, igual ao resto do
-- Comando. Ver: dono vê as suas; admin da org vê todas. Escrever: só via as
-- funções (sem policy de DELETE — fechar é soft, pelo X). Membro só marca
-- agenda para si; admin pode marcar para outro membro da MESMA org. O lead
-- tem que ser da org e não estar apagado.
--
-- Rollback: supabase/migrations/rollback/20280110000000_agenda_de_contatos.sql

CREATE TABLE IF NOT EXISTS public.agenda_contatos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  -- De quem é a agenda (team_members.id). É a pessoa que vai entrar em contato.
  owner_id        uuid NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  -- Dia, não hora: a planilha marca o dia. A cor sai da comparação com o "hoje"
  -- no fuso da org (azul futura, amarelo hoje, vermelho atrasada).
  data_agenda     date NOT NULL,
  observacao      text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  created_by      uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  concluida_em    timestamptz,
  concluida_por   uuid REFERENCES public.team_members(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.agenda_contatos IS
  'Próximo ponto de contato com o cliente (Comando › Agenda). Uma ativa por (org, lead, dono); sai só pelo X (concluida_em).';

-- Uma agenda ATIVA por cliente e dono: marcar de novo remarca.
CREATE UNIQUE INDEX IF NOT EXISTS agenda_contatos_ativa_uq
  ON public.agenda_contatos (organization_id, lead_id, owner_id)
  WHERE concluida_em IS NULL;

-- A lista do Comando: ativas do dono, por data.
CREATE INDEX IF NOT EXISTS agenda_contatos_dono_data_idx
  ON public.agenda_contatos (organization_id, owner_id, data_agenda)
  WHERE concluida_em IS NULL;

ALTER TABLE public.agenda_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_contatos_select ON public.agenda_contatos;
CREATE POLICY agenda_contatos_select ON public.agenda_contatos
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT g.org_id FROM public.get_my_organization_ids() AS g(org_id))
    AND (owner_id = public.my_team_member_id(organization_id) OR public.is_org_admin(organization_id))
  );

DROP POLICY IF EXISTS agenda_contatos_insert ON public.agenda_contatos;
CREATE POLICY agenda_contatos_insert ON public.agenda_contatos
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT g.org_id FROM public.get_my_organization_ids() AS g(org_id))
    AND created_by = public.my_team_member_id(organization_id)
    AND (owner_id = public.my_team_member_id(organization_id) OR public.is_org_admin(organization_id))
    AND EXISTS (SELECT 1 FROM public.leads l
                 WHERE l.id = lead_id AND l.organization_id = agenda_contatos.organization_id
                   AND l.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.team_members tm
                 WHERE tm.id = owner_id AND tm.organization_id = agenda_contatos.organization_id)
  );

DROP POLICY IF EXISTS agenda_contatos_update ON public.agenda_contatos;
CREATE POLICY agenda_contatos_update ON public.agenda_contatos
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT g.org_id FROM public.get_my_organization_ids() AS g(org_id))
    AND (owner_id = public.my_team_member_id(organization_id) OR public.is_org_admin(organization_id))
  )
  WITH CHECK (
    organization_id IN (SELECT g.org_id FROM public.get_my_organization_ids() AS g(org_id))
    AND (owner_id = public.my_team_member_id(organization_id) OR public.is_org_admin(organization_id))
  );

REVOKE ALL ON public.agenda_contatos FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.agenda_contatos TO authenticated;
GRANT ALL ON public.agenda_contatos TO service_role;

-- Os campos que identificam a agenda não mudam depois de criada: remarcar muda
-- a data, nunca o cliente, a org ou o dono.
CREATE OR REPLACE FUNCTION public.agenda_contatos_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agenda_contatos: org, cliente e dono não mudam' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agenda_contatos_imutaveis ON public.agenda_contatos;
CREATE TRIGGER trg_agenda_contatos_imutaveis
  BEFORE UPDATE ON public.agenda_contatos
  FOR EACH ROW EXECUTE FUNCTION public.agenda_contatos_imutaveis();

-- ── Helper: "hoje" no fuso da org ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agenda_contatos_hoje(p_org uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
            (SELECT NULLIF(o.timezone, '') FROM public.organizations o WHERE o.id = p_org),
            'America/Sao_Paulo'))::date
$function$;

-- ── Listar ───────────────────────────────────────────────────────────────
-- Ativas, atrasadas primeiro (mais antiga no topo), depois hoje, depois futuras.
-- Admin vê a equipe; `p_somente_meus` recorta para as do próprio usuário
-- ("Minha central"). Membro sempre vê só as dele (a RLS garante).
--
-- As colunas espelham a planilha da Café: Cód. Cliente (`erp_code`), Cliente
-- (razão social = `leads.name`), Nome Fantasia (`leads.company`), Telefones
-- (todos os de `lead_phones`, principal primeiro), Cidade e Representante (do
-- ERP, em `upsell_clients`, 1:1 com o lead). Sem cadastro do ERP, cidade cai
-- no UF do lead e o representante fica nulo.
CREATE OR REPLACE FUNCTION public.get_agenda_contatos(
  p_org uuid,
  p_somente_meus boolean DEFAULT false,
  p_limite integer DEFAULT 500
)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  lead_name text,
  lead_company text,
  lead_phone text,
  lead_phones text[],
  lead_erp_code text,
  lead_uf text,
  lead_cidade text,
  erp_representante text,
  owner_id uuid,
  owner_name text,
  data_agenda date,
  observacao text,
  situacao text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_hoje date;
  v_me   uuid;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  v_hoje := public.agenda_contatos_hoje(p_org);
  v_me := public.my_team_member_id(p_org);

  RETURN QUERY
  SELECT a.id, a.lead_id, l.name::text, l.company::text, l.phone::text,
         COALESCE(fones.lista, CASE WHEN l.phone IS NOT NULL THEN ARRAY[l.phone::text] END),
         l.erp_code::text,
         COALESCE(NULLIF(btrim(u.erp_uf), ''), l.uf)::text,
         NULLIF(btrim(u.erp_city), '')::text,
         NULLIF(btrim(u.erp_owner_name), '')::text,
         a.owner_id, tm.name::text, a.data_agenda, a.observacao,
         CASE WHEN a.data_agenda < v_hoje THEN 'atrasada'
              WHEN a.data_agenda = v_hoje THEN 'hoje'
              ELSE 'futura' END,
         a.created_at
    FROM public.agenda_contatos a
    JOIN public.leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
    LEFT JOIN public.team_members tm ON tm.id = a.owner_id
    -- upsell_clients é 1:1 com o lead (medido em prod: no máximo 1 por lead);
    -- o LATERAL com LIMIT 1 garante que uma duplicata futura não duplique a agenda.
    LEFT JOIN LATERAL (
      SELECT uc.erp_city, uc.erp_uf, uc.erp_owner_name
        FROM public.upsell_clients uc
       WHERE uc.lead_id = l.id AND uc.organization_id = p_org
       ORDER BY uc.updated_at DESC NULLS LAST
       LIMIT 1
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(lp.phone::text ORDER BY lp.is_primary DESC, lp.created_at ASC) AS lista
        FROM public.lead_phones lp
       WHERE lp.lead_id = l.id AND lp.organization_id = p_org AND lp.deleted_at IS NULL
         AND NULLIF(btrim(lp.phone), '') IS NOT NULL
    ) fones ON true
   WHERE a.organization_id = p_org
     AND a.concluida_em IS NULL
     AND (NOT COALESCE(p_somente_meus, false) OR a.owner_id = v_me)
   ORDER BY a.data_agenda ASC, l.name ASC, a.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 500), 1), 1000);
END;
$function$;

-- ── Resumo: contadores por cor + os próximos 7 dias ──────────────────────
CREATE OR REPLACE FUNCTION public.get_agenda_contatos_resumo(
  p_org uuid,
  p_somente_meus boolean DEFAULT false
)
RETURNS TABLE(dia date, situacao text, total bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_hoje date;
  v_me   uuid;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  v_hoje := public.agenda_contatos_hoje(p_org);
  v_me := public.my_team_member_id(p_org);

  -- Atrasadas viram UMA linha (dia = null); hoje e futuras, uma linha por dia.
  RETURN QUERY
  SELECT CASE WHEN a.data_agenda < v_hoje THEN NULL ELSE a.data_agenda END AS dia,
         CASE WHEN a.data_agenda < v_hoje THEN 'atrasada'
              WHEN a.data_agenda = v_hoje THEN 'hoje'
              ELSE 'futura' END AS situacao,
         count(*)::bigint
    FROM public.agenda_contatos a
    JOIN public.leads l ON l.id = a.lead_id AND l.deleted_at IS NULL
   WHERE a.organization_id = p_org
     AND a.concluida_em IS NULL
     AND (NOT COALESCE(p_somente_meus, false) OR a.owner_id = v_me)
   GROUP BY 1, 2
   ORDER BY 1 ASC NULLS FIRST;
END;
$function$;

-- ── Marcar / remarcar ────────────────────────────────────────────────────
-- Uma agenda ativa por (cliente, dono): se já existe, só troca a data (e a
-- observação, quando vier). Devolve o id da agenda.
CREATE OR REPLACE FUNCTION public.agenda_contato_marcar(
  p_org uuid,
  p_lead uuid,
  p_data date,
  p_observacao text DEFAULT NULL,
  p_owner uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_me    uuid;
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_lead IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Escolha o cliente e a data da agenda.' USING ERRCODE = '22023';
  END IF;

  v_me := public.my_team_member_id(p_org);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Só um membro da equipe pode marcar agenda.' USING ERRCODE = '42501';
  END IF;
  v_owner := COALESCE(p_owner, v_me);
  IF v_owner <> v_me AND NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Só o admin marca agenda para outra pessoa.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agenda_contatos (organization_id, lead_id, owner_id, data_agenda, observacao, created_by)
  VALUES (p_org, p_lead, v_owner, p_data, NULLIF(btrim(p_observacao), ''), v_me)
  ON CONFLICT (organization_id, lead_id, owner_id) WHERE concluida_em IS NULL
  DO UPDATE SET data_agenda = EXCLUDED.data_agenda,
                observacao  = COALESCE(EXCLUDED.observacao, public.agenda_contatos.observacao)
  RETURNING public.agenda_contatos.id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── X: fechar a agenda ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agenda_contato_concluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT a.organization_id INTO v_org FROM public.agenda_contatos a WHERE a.id = p_id;
  -- A RLS esconde a linha de quem não pode vê-la: "não achei" e "não pode" dão
  -- a mesma resposta, sem revelar que a agenda existe.
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Agenda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.agenda_contatos a
     SET concluida_em = now(),
         concluida_por = public.my_team_member_id(v_org)
   WHERE a.id = p_id AND a.concluida_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta agenda já foi fechada.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- ── Desfazer o X ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agenda_contato_reabrir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.agenda_contatos a
     SET concluida_em = NULL, concluida_por = NULL
   WHERE a.id = p_id AND a.concluida_em IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agenda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este cliente já tem outra agenda aberta.' USING ERRCODE = '23505';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_agenda_contatos_resumo(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_contato_concluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_contato_reabrir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_contatos_hoje(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_contatos_imutaveis() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_agenda_contatos_resumo(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_contato_concluir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_contato_reabrir(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_contatos_hoje(uuid) TO authenticated, service_role;
