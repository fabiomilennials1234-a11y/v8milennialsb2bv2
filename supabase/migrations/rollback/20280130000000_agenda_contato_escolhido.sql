-- Rollback de 20280130000000_agenda_contato_escolhido.sql
-- Volta as duas RPCs aos corpos de 20280117020000/20280110000000 e remove o
-- contato escolhido. 🔴 Perde QUAL contato cada agenda/reunião tinha: exporte
-- `agenda_contatos(id, lead_phone_id)` e `meetings(id, lead_phone_id)` antes se
-- houver dado a preservar. Rode o rollback ANTES de reverter o front (o front
-- novo chama `p_lead_phone`, que deixa de existir).

BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.agenda_contato_marcar(uuid, uuid, date, text, uuid, uuid);

CREATE FUNCTION public.agenda_contato_marcar(
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

REVOKE ALL ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_contato_marcar(uuid, uuid, date, text, uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_agenda_contatos(uuid, boolean, integer);

CREATE FUNCTION public.get_agenda_contatos(p_org uuid, p_somente_meus boolean DEFAULT false, p_limite integer DEFAULT 500)
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

REVOKE ALL ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agenda_contatos(uuid, boolean, integer) TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_meeting_contato_do_lead ON public.meetings;
DROP TRIGGER IF EXISTS trg_agenda_contatos_contato_do_lead ON public.agenda_contatos;
DROP FUNCTION IF EXISTS public.fn_lead_phone_do_mesmo_lead();

DROP INDEX IF EXISTS public.meetings_lead_phone_id_idx;
DROP INDEX IF EXISTS public.agenda_contatos_lead_phone_id_idx;
ALTER TABLE public.meetings DROP COLUMN IF EXISTS lead_phone_id;
ALTER TABLE public.agenda_contatos DROP COLUMN IF EXISTS lead_phone_id;

COMMIT;

NOTIFY pgrst, 'reload schema';
