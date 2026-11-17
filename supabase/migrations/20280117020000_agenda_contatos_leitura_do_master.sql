-- 20280117020000_agenda_contatos_leitura_do_master.sql
--
-- Master (sem vínculo com a org) recebia "forbidden: org not accessible" na Agenda
-- de contatos do Comando: a guarda das RPCs de leitura e a policy de SELECT só
-- aceitavam quem está em get_my_organization_ids(). Master ficava de fora mesmo
-- sendo is_org_admin de qualquer org.
--
-- SÓ LEITURA. Marcar, fechar e reabrir seguem exigindo membro da org: a agenda
-- é de um team_member (created_by/owner_id), e o master não tem linha real.
--
-- Os corpos abaixo são os VIGENTES em prod (pg_get_functiondef), com uma única
-- mudança: a guarda ganha `public.is_master_user() OR`. As funções seguem
-- SECURITY INVOKER; ACL e COMMENT são preservados pelo CREATE OR REPLACE.

BEGIN;

DROP POLICY IF EXISTS agenda_contatos_select ON public.agenda_contatos;
CREATE POLICY agenda_contatos_select ON public.agenda_contatos
  FOR SELECT TO authenticated
  USING (
    public.is_master_user()
    OR (
      organization_id IN (SELECT g.org_id FROM public.get_my_organization_ids() AS g(org_id))
      AND (owner_id = public.my_team_member_id(organization_id) OR public.is_org_admin(organization_id))
    )
  );

CREATE OR REPLACE FUNCTION public.get_agenda_contatos(p_org uuid, p_somente_meus boolean DEFAULT false, p_limite integer DEFAULT 500)
 RETURNS TABLE(id uuid, lead_id uuid, lead_name text, lead_company text, lead_phone text, lead_phones text[], lead_erp_code text, lead_uf text, lead_cidade text, erp_representante text, owner_id uuid, owner_name text, data_agenda date, observacao text, situacao text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_hoje date;
  v_me   uuid;
BEGIN
  IF p_org IS NULL OR NOT (
       public.is_master_user()
       OR EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org)) THEN
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

CREATE OR REPLACE FUNCTION public.get_agenda_contatos_resumo(p_org uuid, p_somente_meus boolean DEFAULT false)
 RETURNS TABLE(dia date, situacao text, total bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_hoje date;
  v_me   uuid;
BEGIN
  IF p_org IS NULL OR NOT (
       public.is_master_user()
       OR EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS g(org_id) WHERE g.org_id = p_org)) THEN
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

COMMIT;
