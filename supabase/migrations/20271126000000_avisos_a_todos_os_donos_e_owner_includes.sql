-- 20271126000000_avisos_a_todos_os_donos_e_owner_includes.sql
--
-- Chamado 793f4b05 · PR4b/5 — decisão 5 do CTO: aviso de mensagem nova para
-- TODOS os donos do lead + operador "está entre os donos" (owner_includes) nas
-- condições guiadas de workflow. "Responsável é X" continua no principal.
--
-- GATE: tudo que lê lead_owners fica neutro fora das orgs com a flag
-- feature_flags.lead_owners_n_donos (PR1): sem linhas 'co' o ramo novo é sempre
-- falso, e fn_donos_do_lead devolve só o principal (= fn_dono_do_lead).
--
-- O QUE MUDA
--  1. public.fn_donos_do_lead(lead) -> uuid[]  (NOVA; principal primeiro, dedup
--     por usuário). fn_dono_do_lead NÃO muda: comissão, round-robin e quem lê "o"
--     dono seguem no principal.
--  2. Avisos que usavam fn_dono_do_lead para NOTIFICAR passam a usar o array:
--     fn_aviso_de_lead_novo, fn_aviso_de_reuniao_marcada e as duas varreduras
--     (follow-up e reunião próxima, no ramo "sem atribuído"). Um usuário em dois
--     papéis recebe UM aviso (dedup no array; group_key por usuário).
--  3. Aviso de MENSAGEM: fn_aviso_de_mensagem não usa fn_dono_do_lead; ele avisa
--     quem tem o número (whatsapp_instance_allowed_members) E passa em
--     private.chat_scope_for_recipient. É esse escopo que ganha o co-dono (ramo
--     lead_owners role='co'). Vale também para o push (fn_avisos_pendentes_de_push)
--     e para public.can_see_chat_scope, que usam o mesmo escopo. fn_aviso_de_mensagem
--     em si NÃO muda.
--  4. Operador owner_includes (campo lead.owners): valid_guided_data_scopes,
--     read_guided_condition_data (7 args), read_guided_condition_custom_data,
--     test_guided_condition_responsibles e finalize_guided_workflow_publication
--     aceitam o escopo 'lead.owners'; os leitores devolvem
--     responsibles.field_values.owner_member_ids (principais + co-donos).
--
-- Cada função recriada parte da definição VIGENTE de prod (conferida por
-- md5(prosrc) contra o arquivo do repo em 19/10; chat_scope_for_recipient por
-- pg_get_functiondef, porque o repo não tem o ramo strict_lead_owner_access).
-- CREATE OR REPLACE preserva owner e ACL de cada uma.
--
-- ORDEM: aplicar DEPOIS do PR1 (lead_owners, lead_owners_enabled) e ANTES do
-- deploy das edge functions que importam guided-condition.ts
-- (supabase/functions/_shared). Edge: deploy com --import-map.
--
-- ROLLBACK: supabase/migrations/rollback/20271126000000_avisos_a_todos_os_donos_e_owner_includes.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─── 1. fn_donos_do_lead ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_donos_do_lead(p_lead_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org       uuid;
  v_principal uuid;
BEGIN
  v_principal := public.fn_dono_do_lead(p_lead_id);
  SELECT l.organization_id INTO v_org FROM public.leads l WHERE l.id = p_lead_id;

  -- Org sem N donos (ou lead inexistente): o aviso de sempre, só o principal.
  IF v_org IS NULL OR NOT public.lead_owners_enabled(v_org) THEN
    RETURN CASE WHEN v_principal IS NULL THEN '{}'::uuid[] ELSE ARRAY[v_principal] END;
  END IF;

  -- Principal primeiro (o mesmo que fn_dono_do_lead devolve), depois venda,
  -- pré-venda e co-donos. Uma conta em dois papéis aparece UMA vez, na posição
  -- do primeiro papel: a deduplicação é por usuário, não por membro.
  RETURN COALESCE((
    SELECT array_agg(c.user_id ORDER BY c.ord, c.ts, c.user_id)
    FROM (
      SELECT u.user_id, min(u.ord) AS ord, min(u.ts) AS ts
      FROM (
        SELECT v_principal AS user_id, 0 AS ord, 'epoch'::timestamptz AS ts
        UNION ALL
        SELECT tm.user_id, 1, 'epoch'::timestamptz
          FROM public.leads l
          JOIN public.team_members tm ON tm.id = l.sale_responsible_id
         WHERE l.id = p_lead_id AND tm.organization_id = l.organization_id
           AND tm.is_active AND tm.user_id IS NOT NULL
        UNION ALL
        SELECT tm.user_id, 2, 'epoch'::timestamptz
          FROM public.leads l
          JOIN public.team_members tm ON tm.id = l.pre_sale_responsible_id
         WHERE l.id = p_lead_id AND tm.organization_id = l.organization_id
           AND tm.is_active AND tm.user_id IS NOT NULL
        UNION ALL
        SELECT tm.user_id,
               CASE o.role WHEN 'venda' THEN 3 WHEN 'pre_venda' THEN 4 ELSE 5 END,
               o.added_at
          FROM public.lead_owners o
          JOIN public.team_members tm ON tm.id = o.team_member_id
         WHERE o.lead_id = p_lead_id AND o.organization_id = v_org
           AND tm.organization_id = v_org
           AND tm.is_active AND tm.user_id IS NOT NULL
      ) u
      WHERE u.user_id IS NOT NULL
      GROUP BY u.user_id
    ) c
  ), '{}'::uuid[]);
END;
$fn$;

COMMENT ON FUNCTION public.fn_donos_do_lead(uuid) IS
  'Contas de usuário que recebem o aviso do lead: TODOS os donos (principais por papel + co-donos de lead_owners), principal primeiro, sem repetir usuário. Org sem a flag lead_owners_n_donos: só o principal (= fn_dono_do_lead). fn_dono_do_lead segue existindo para quem lê o principal. Chamado 793f4b05 · PR4b.';

REVOKE ALL ON FUNCTION public.fn_donos_do_lead(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_donos_do_lead(uuid) TO service_role;

-- ─── 2. fn_aviso_de_lead_novo  (parte de: 20260831220000_avisos_produtor_lead_novo.sql) ───
CREATE OR REPLACE FUNCTION public.fn_aviso_de_lead_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dono uuid;
BEGIN
  -- Todos os donos do lead (Chamado 793f4b05 · PR4b), principal primeiro. Sem
  -- dono não nasce Aviso. Org sem N donos: só o principal, como sempre.
  FOREACH v_dono IN ARRAY public.fn_donos_do_lead(NEW.id) LOOP
    PERFORM public.fn_emit_aviso(
      p_organization_id => NEW.organization_id,
      p_user_id         => v_dono,
      p_type            => 'lead_new',
      p_group_key       => 'lead:' || NEW.id::text,
      p_title           => COALESCE(NULLIF(NEW.name, ''), 'Lead novo'),
      p_description     => NULLIF(concat_ws(' · ',
                             NULLIF(NEW.company, ''),
                             NULLIF(NEW.origin, '')), ''),
      p_link            => '/leads',
      p_lead_id         => NEW.id,
      p_entity_id       => NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ─── 3. fn_aviso_de_reuniao_marcada  (parte de: 20260831230000_avisos_produtor_reuniao.sql) ───
CREATE OR REPLACE FUNCTION public.fn_aviso_de_reuniao_marcada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono  uuid;
  v_ator  uuid;
  v_lead  record;
BEGIN
  IF NEW.event_type <> 'meeting_booked' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_ator := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_ator := NULL;
  END;

  SELECT name, company INTO v_lead FROM public.leads WHERE id = NEW.lead_id;

  -- Todos os donos do lead (Chamado 793f4b05 · PR4b); quem agendou não é avisado
  -- da própria ação.
  FOREACH v_dono IN ARRAY public.fn_donos_do_lead(NEW.lead_id) LOOP
    CONTINUE WHEN v_ator IS NOT NULL AND v_ator = v_dono;
    PERFORM public.fn_emit_aviso(
      p_organization_id => NEW.organization_id,
      p_user_id         => v_dono,
      p_type            => 'meeting_booked',
      p_group_key       => 'meet:' || NEW.lead_id::text,
      p_title           => 'Reunião marcada',
      p_description     => NULLIF(concat_ws(' · ',
                             NULLIF(v_lead.name, ''),
                             NULLIF(v_lead.company, ''),
                             to_char(NEW.meeting_date AT TIME ZONE 'America/Sao_Paulo',
                                     'DD/MM "às" HH24"h"MI')), ''),
      p_link            => '/pipe-confirmacao',
      p_lead_id         => NEW.lead_id,
      p_entity_id       => NEW.id,
      p_occurred_at     => COALESCE(NEW.occurred_at, now())
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ─── 4. fn_varredura_avisos_followups  (parte de: 20271022000000_agenda_notification_reminders.sql) ───
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_followups()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_key text;
  v_total integer := 0;
  v_dia text := to_char(timezone('America/Sao_Paulo', now()), 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:followups', 0)) THEN RETURN 0; END IF;
  FOR r IN
    SELECT f.*, l.name AS lead_nome, tm.user_id AS destinatario
    FROM public.follow_ups f
    JOIN public.leads l ON l.id = f.lead_id AND l.organization_id = f.organization_id
    JOIN public.team_members tm ON tm.organization_id = f.organization_id
      AND tm.is_active AND tm.user_id IS NOT NULL
      -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
      -- (Chamado 793f4b05 · PR4b); um membro em dois papéis é um usuário só.
      AND tm.user_id = ANY(CASE WHEN EXISTS (SELECT 1 FROM public.team_members a WHERE a.id = f.assigned_to
          AND a.organization_id = f.organization_id AND a.is_active AND a.user_id IS NOT NULL)
        THEN ARRAY[(SELECT a.user_id FROM public.team_members a WHERE a.id = f.assigned_to
          AND a.organization_id = f.organization_id AND a.is_active AND a.user_id IS NOT NULL)]
        ELSE public.fn_donos_do_lead(f.lead_id) END)
    WHERE f.completed_at IS NULL AND f.archived_at IS NULL AND l.deleted_at IS NULL
      AND f.due_date <= now() + interval '15 minutes'
      -- Old overdue tasks remain a morning reminder, not a midnight alarm.
      AND (f.due_date >= now() - interval '1 hour'
        OR extract(hour FROM timezone('America/Sao_Paulo', now())) >= 7)
  LOOP
    v_key := 'fup:' || r.organization_id || ':' || r.id || ':' ||
      extract(epoch FROM r.due_date)::text || ':' || v_dia;
    -- Reading a reminder must never re-arm the same scheduled occurrence.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = r.destinatario AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.due_date < now() THEN 'follow_up_overdue' ELSE 'follow_up_due' END,
      p_group_key => v_key,
      p_title => CASE WHEN r.due_date < now() THEN 'Follow-up atrasado' ELSE 'Follow-up em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.due_date), 'DD/MM HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ─── 5. fn_varredura_avisos_reuniao_proxima  (parte de: 20271022000000_agenda_notification_reminders.sql) ───
CREATE OR REPLACE FUNCTION public.fn_varredura_avisos_reuniao_proxima()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_data timestamptz;
  v_dono uuid;
  v_donos uuid[];
  v_lead_nome text;
  v_key text;
  v_total integer := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('avisos:reunioes', 0)) THEN RETURN 0; END IF;

  -- Includes meetings without a lead/deal and follow-ups created as agenda
  -- activities. Creator + invited active members, never an organization broadcast.
  FOR r IN
    SELECT DISTINCT m.id, m.organization_id, m.lead_id, m.title, m.start_at,
      m.event_type, tm.user_id AS destinatario, l.name AS lead_nome
    FROM public.meetings m
    LEFT JOIN public.leads l ON l.id = m.lead_id AND l.organization_id = m.organization_id
    JOIN public.team_members tm ON tm.organization_id = m.organization_id
      AND tm.is_active AND tm.user_id IS NOT NULL
      AND (tm.user_id = m.created_by OR EXISTS (
        SELECT 1 FROM public.meeting_participants mp WHERE mp.meeting_id = m.id
          AND mp.team_member_id = tm.id AND mp.status <> 'declined'))
    WHERE m.status = 'scheduled' AND NOT m.all_day
      AND m.event_type IN ('meeting', 'call', 'follow_up', 'task', 'other')
      AND (m.lead_id IS NULL OR (l.id IS NOT NULL AND l.deleted_at IS NULL))
      AND m.start_at BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes'
  LOOP
    v_key := 'agenda:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM r.start_at)::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
      WHERE n.organization_id = r.organization_id AND n.user_id = r.destinatario AND n.group_key = v_key);
    PERFORM public.fn_emit_aviso(
      p_organization_id => r.organization_id, p_user_id => r.destinatario,
      p_type => CASE WHEN r.event_type = 'follow_up' THEN 'follow_up_due' ELSE 'meeting_soon' END,
      p_group_key => v_key,
      p_title => CASE WHEN r.start_at <= now() THEN
          CASE WHEN r.event_type = 'follow_up' THEN 'Follow-up para agora' ELSE 'Compromisso começando agora' END
        WHEN r.event_type = 'follow_up' THEN 'Follow-up em até 15 minutos' ELSE 'Compromisso em até 15 minutos' END,
      p_description => concat_ws(' · ', NULLIF(r.title, ''), r.lead_nome,
        to_char(timezone('America/Sao_Paulo', r.start_at), 'HH24:MI')),
      p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
    v_total := v_total + 1;
  END LOOP;

  -- Preserve appointments created in funnels, which need not have a meetings
  -- row. A malformed legacy date must not stop all organizations' reminders.
  FOR r IN
    SELECT pe.*
    FROM public.pipeline_entries pe
    WHERE pe.closed_at IS NULL
      AND NULLIF(pe.metadata ->> 'meeting_date', '') IS NOT NULL
  LOOP
    BEGIN
      v_data := (r.metadata ->> 'meeting_date')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
    END;
    CONTINUE WHEN v_data NOT BETWEEN now() - interval '5 minutes' AND now() + interval '15 minutes';
    SELECT l.name INTO v_lead_nome FROM public.leads l
      WHERE l.id = r.lead_id AND l.organization_id = r.organization_id AND l.deleted_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    -- The canonical agenda row owns its status and participants. Suppress its
    -- projection even when cancelled/completed, otherwise it resurrects here.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meetings m
      WHERE m.organization_id = r.organization_id AND (
        m.id::text = r.metadata #>> '{agenda_espelho,meeting_id}'
        OR ((m.pipeline_entry_id = r.id OR m.deal_id = r.deal_id) AND m.start_at = v_data)
        -- Lead/time is only a legacy fallback. Explicit links above already
        -- cover matching IDs; a different meeting, entry or deal is another
        -- appointment even when its lead and scheduled instant coincide.
        OR (m.lead_id = r.lead_id AND m.start_at = v_data
          AND NULLIF(r.metadata #>> '{agenda_espelho,meeting_id}', '') IS NULL
          AND m.pipeline_entry_id IS NULL
          AND (m.deal_id IS NULL OR r.deal_id IS NULL))));
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.meeting_events booked
      JOIN public.meeting_events outcome ON outcome.booked_event_id = booked.id
        AND outcome.organization_id = booked.organization_id
        AND outcome.event_type IN ('meeting_held', 'meeting_no_show')
      WHERE booked.organization_id = r.organization_id AND booked.source_entry_id = r.id
        AND booked.meeting_date = v_data);
    -- Atribuído a alguém: só essa pessoa. Sem atribuído: TODOS os donos do lead
    -- (Chamado 793f4b05 · PR4b). Um usuário em dois papéis recebe um aviso.
    v_donos := ARRAY(SELECT tm.user_id FROM public.team_members tm WHERE tm.id = r.assigned_to
      AND tm.organization_id = r.organization_id AND tm.is_active AND tm.user_id IS NOT NULL);
    IF cardinality(v_donos) = 0 THEN
      v_donos := public.fn_donos_do_lead(r.lead_id);
    END IF;
    v_key := 'meet_soon:' || r.organization_id || ':' || r.id || ':' || extract(epoch FROM v_data)::text;
    FOREACH v_dono IN ARRAY v_donos LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.team_members tm
        WHERE tm.organization_id = r.organization_id AND tm.user_id = v_dono AND tm.is_active);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.notifications n
        WHERE n.organization_id = r.organization_id AND n.user_id = v_dono AND n.group_key = v_key);
      PERFORM public.fn_emit_aviso(
        p_organization_id => r.organization_id, p_user_id => v_dono, p_type => 'meeting_soon',
        p_group_key => v_key,
        p_title => CASE WHEN v_data <= now() THEN 'Reunião começando agora' ELSE 'Reunião em até 15 minutos' END,
        p_description => concat_ws(' · ', v_lead_nome, to_char(timezone('America/Sao_Paulo', v_data), 'HH24:MI')),
        p_link => '/agenda', p_lead_id => r.lead_id, p_entity_id => r.id);
      v_total := v_total + 1;
    END LOOP;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ─── 6. chat_scope_for_recipient  (parte de: pg_get_functiondef em prod (19/10); o repo (20271021000013) não tem o ramo strict_lead_owner_access) ───
CREATE OR REPLACE FUNCTION private.chat_scope_for_recipient(p_user_id uuid, p_org_id uuid, p_lead_id uuid, p_normalized_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user(p_user_id) THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = p_user_id
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org_id AND feature_flags @> '{"strict_lead_owner_access":true}'::jsonb) THEN
    RETURN EXISTS(SELECT 1 FROM public.team_members WHERE id=v_team_member_id AND role='admin')
      OR EXISTS(SELECT 1 FROM public.leads l WHERE l.organization_id=p_org_id
        AND ((p_lead_id IS NOT NULL AND l.id=p_lead_id) OR (p_lead_id IS NULL AND l.normalized_phone=p_normalized_phone))
        AND private.strict_lead_owned_by(p_org_id,l.id,p_user_id));
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin') OR EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND role = 'admin' AND is_active) THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal: com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer, so override EXPLICITO abre.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND (
        (p_lead_id IS NOT NULL AND l.id = p_lead_id)
        OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone)
      )
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        -- Co-dono (Chamado 793f4b05 · PR4b, decisão 5): o aviso de mensagem vai
        -- a TODOS os donos. Linha 'co' só existe em org com lead_owners_n_donos.
        OR EXISTS (
          SELECT 1 FROM public.lead_owners lo
          WHERE lo.lead_id = l.id AND lo.team_member_id = v_team_member_id AND lo.role = 'co'
        )
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$function$;


-- ─── 7. valid_guided_data_scopes  (parte de: 20271020000054_guided_product_relation.sql) ───
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text','message.waiting.elapsed','activity.follow_up','product.trigger_business_item','product.lead_association','product.won_deal_history']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;

-- ─── 8. read_guided_condition_data  (parte de: 20271020000030_guided_custom_field_authorization.sql (assinatura de 7 argumentos)) ───
CREATE OR REPLACE FUNCTION public.read_guided_condition_data(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[], p_tag_ids uuid[], p_origin_ids uuid[], p_member_ids uuid[]
) RETURNS TABLE(id uuid, organization_id uuid, field_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_organization_id uuid; v_tag_ids uuid[]; v_origin_ids uuid[]; v_member_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 18
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[])
    OR p_member_ids IS NULL OR array_position(p_member_ids, NULL) IS NOT NULL
    OR (cardinality(p_member_ids) > 0 AND NOT (p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[]))
    OR p_origin_ids IS NULL OR array_position(p_origin_ids, NULL) IS NOT NULL
    OR (cardinality(p_origin_ids) > 0 AND NOT ('lead.origin' = ANY(p_fields)))
    OR p_tag_ids IS NULL OR array_position(p_tag_ids, NULL) IS NOT NULL
    OR (('lead.tags' = ANY(p_fields)) IS DISTINCT FROM (cardinality(p_tag_ids) > 0)) THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT w.organization_id INTO v_organization_id
    FROM public.workflows w JOIN public.workflow_data_grants g
      ON g.workflow_id = w.id AND g.organization_id = w.organization_id
    WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id
      AND g.resource_scope = 'organization_leads' AND p_fields <@ g.fields
      AND NOT public.org_access_blocked(w.organization_id)
    FOR SHARE OF w, g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id = p_lead_id
    AND l.organization_id = v_organization_id AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_tag_ids
    FROM unnest(p_tag_ids) AS requested(id);
  IF cardinality(v_tag_ids) > 0 THEN
    -- Lock referenced catalogue rows so removal cannot race validation/read.
    PERFORM 1 FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id) <> cardinality(v_tag_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_origin_ids
    FROM unnest(p_origin_ids) AS requested(id);
  IF cardinality(v_origin_ids) > 0 THEN
    PERFORM 1 FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id) <> cardinality(v_origin_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_member_ids
    FROM unnest(p_member_ids) AS requested(id);
  IF cardinality(v_member_ids) > 0 THEN
    PERFORM 1 FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id AND NOT public.is_master_user(m.user_id)) <> cardinality(v_member_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  -- One statement projects scalar data and membership; no independently stale
  -- scalar/tag snapshots and no unrequested scalar values in the response.
  RETURN QUERY SELECT l.id, l.organization_id,
    (CASE WHEN 'lead.name' = ANY(p_fields) THEN jsonb_build_object('name', l.name) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.company' = ANY(p_fields) THEN jsonb_build_object('company', l.company) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.email' = ANY(p_fields) THEN jsonb_build_object('email', l.email) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.phone' = ANY(p_fields) THEN jsonb_build_object('phone', l.phone) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.qualification_score' = ANY(p_fields) THEN jsonb_build_object('qualification_score', l.qualification_score) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_campaign' = ANY(p_fields) THEN jsonb_build_object('utm_campaign', l.utm_campaign) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_source' = ANY(p_fields) THEN jsonb_build_object('utm_source', l.utm_source) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_medium' = ANY(p_fields) THEN jsonb_build_object('utm_medium', l.utm_medium) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_content' = ANY(p_fields) THEN jsonb_build_object('utm_content', l.utm_content) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_term' = ANY(p_fields) THEN jsonb_build_object('utm_term', l.utm_term) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.segment' = ANY(p_fields) THEN jsonb_build_object('segment', l.segment) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.urgency' = ANY(p_fields) THEN jsonb_build_object('urgency', l.urgency) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.faturamento' = ANY(p_fields) THEN jsonb_build_object('faturamento', l.faturamento) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.tags' = ANY(p_fields) THEN jsonb_build_object('tags', (
      SELECT jsonb_agg(jsonb_build_object('tag_id', t.id, 'tag_name', t.name, 'assigned', EXISTS (
        SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = t.id
      )) ORDER BY t.id) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = v_organization_id
    )) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.origin' = ANY(p_fields) THEN jsonb_build_object('origin',
      jsonb_build_object('actual_origin', l.origin, 'origins', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug) ORDER BY o.id), '[]'::jsonb)
        FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids) AND o.organization_id = v_organization_id
      ))) ELSE '{}'::jsonb END)
    || (CASE WHEN p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[] THEN jsonb_build_object('responsibles',
      jsonb_build_object('field_values',
        (CASE WHEN 'lead.pre_sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('pre_sale_responsible_id', l.pre_sale_responsible_id) ELSE '{}'::jsonb END)
        || (CASE WHEN 'lead.sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('sale_responsible_id', l.sale_responsible_id) ELSE '{}'::jsonb END)
        || (CASE WHEN 'lead.owners' = ANY(p_fields) THEN jsonb_build_object('owner_member_ids', coalesce((
          SELECT jsonb_agg(o.tm ORDER BY o.tm) FROM (
            SELECT l.pre_sale_responsible_id AS tm UNION SELECT l.sale_responsible_id
            UNION SELECT lo.team_member_id FROM public.lead_owners lo
              WHERE lo.lead_id = l.id AND lo.organization_id = l.organization_id
          ) o WHERE o.tm IS NOT NULL), '[]'::jsonb)) ELSE '{}'::jsonb END),
        'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.id), '[]'::jsonb)
          FROM public.team_members m WHERE m.id = ANY(v_member_ids) AND m.organization_id = v_organization_id
            AND NOT public.is_master_user(m.user_id))
      )) ELSE '{}'::jsonb END)
    FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_organization_id AND l.deleted_at IS NULL;
END;
$$;

-- ─── 9. read_guided_condition_custom_data  (parte de: 20271020000036_guided_custom_select_publication.sql) ───
CREATE OR REPLACE FUNCTION public.read_guided_condition_custom_data(
  p_workflow_id uuid, p_organization_id uuid, p_lead_id uuid, p_fields text[], p_tag_ids uuid[], p_origin_ids uuid[], p_member_ids uuid[]
) RETURNS TABLE(id uuid, organization_id uuid, field_values jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_organization_id uuid; v_tag_ids uuid[]; v_origin_ids uuid[]; v_member_ids uuid[]; v_custom_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.valid_guided_data_scopes(p_fields) OR cardinality(p_fields) = 0
    OR p_member_ids IS NULL OR array_position(p_member_ids, NULL) IS NOT NULL
    OR (cardinality(p_member_ids) > 0 AND NOT (p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[]))
    OR p_origin_ids IS NULL OR array_position(p_origin_ids, NULL) IS NOT NULL
    OR (cardinality(p_origin_ids) > 0 AND NOT ('lead.origin' = ANY(p_fields)))
    OR p_tag_ids IS NULL OR array_position(p_tag_ids, NULL) IS NOT NULL
    OR (('lead.tags' = ANY(p_fields)) IS DISTINCT FROM (cardinality(p_tag_ids) > 0)) THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  SELECT w.organization_id INTO v_organization_id
    FROM public.workflows w JOIN public.workflow_data_grants g
      ON g.workflow_id = w.id AND g.organization_id = w.organization_id
    WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id
      AND g.resource_scope = 'organization_leads' AND p_fields <@ g.fields
      AND NOT public.org_access_blocked(w.organization_id)
    FOR SHARE OF w, g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.leads l WHERE l.id = p_lead_id
    AND l.organization_id = v_organization_id AND l.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT substr(scope, 13)::uuid), '{}'::uuid[]) INTO v_custom_ids
    FROM unnest(p_fields) AS requested(scope) WHERE scope LIKE 'lead.custom:%';
  IF cardinality(v_custom_ids) = 0 THEN RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.lead_custom_fields f WHERE f.id = ANY(v_custom_ids)
    AND f.organization_id = v_organization_id FOR SHARE;
  IF (SELECT count(*) FROM public.lead_custom_fields f WHERE f.id = ANY(v_custom_ids)
    AND f.organization_id = v_organization_id) <> cardinality(v_custom_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_tag_ids
    FROM unnest(p_tag_ids) AS requested(id);
  IF cardinality(v_tag_ids) > 0 THEN
    -- Lock referenced catalogue rows so removal cannot race validation/read.
    PERFORM 1 FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.tags t WHERE t.id = ANY(v_tag_ids)
      AND t.organization_id = v_organization_id) <> cardinality(v_tag_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_origin_ids
    FROM unnest(p_origin_ids) AS requested(id);
  IF cardinality(v_origin_ids) > 0 THEN
    PERFORM 1 FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids)
      AND o.organization_id = v_organization_id) <> cardinality(v_origin_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_member_ids
    FROM unnest(p_member_ids) AS requested(id);
  IF cardinality(v_member_ids) > 0 THEN
    PERFORM 1 FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id FOR SHARE;
    IF (SELECT count(*) FROM public.team_members m WHERE m.id = ANY(v_member_ids)
      AND m.organization_id = v_organization_id AND NOT public.is_master_user(m.user_id)) <> cardinality(v_member_ids) THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
    END IF;
  END IF;
  -- One statement projects scalar data and membership; no independently stale
  -- scalar/tag snapshots and no unrequested scalar values in the response.
  RETURN QUERY SELECT l.id, l.organization_id,
    (CASE WHEN 'lead.name' = ANY(p_fields) THEN jsonb_build_object('name', l.name) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.company' = ANY(p_fields) THEN jsonb_build_object('company', l.company) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.email' = ANY(p_fields) THEN jsonb_build_object('email', l.email) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.phone' = ANY(p_fields) THEN jsonb_build_object('phone', l.phone) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.qualification_score' = ANY(p_fields) THEN jsonb_build_object('qualification_score', l.qualification_score) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_campaign' = ANY(p_fields) THEN jsonb_build_object('utm_campaign', l.utm_campaign) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_source' = ANY(p_fields) THEN jsonb_build_object('utm_source', l.utm_source) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_medium' = ANY(p_fields) THEN jsonb_build_object('utm_medium', l.utm_medium) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_content' = ANY(p_fields) THEN jsonb_build_object('utm_content', l.utm_content) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.utm_term' = ANY(p_fields) THEN jsonb_build_object('utm_term', l.utm_term) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.segment' = ANY(p_fields) THEN jsonb_build_object('segment', l.segment) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.urgency' = ANY(p_fields) THEN jsonb_build_object('urgency', l.urgency) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.faturamento' = ANY(p_fields) THEN jsonb_build_object('faturamento', l.faturamento) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.tags' = ANY(p_fields) THEN jsonb_build_object('tags', (
      SELECT jsonb_agg(jsonb_build_object('tag_id', t.id, 'tag_name', t.name, 'assigned', EXISTS (
        SELECT 1 FROM public.lead_tags lt WHERE lt.lead_id = l.id AND lt.tag_id = t.id
      )) ORDER BY t.id) FROM public.tags t WHERE t.id = ANY(v_tag_ids) AND t.organization_id = v_organization_id
    )) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.origin' = ANY(p_fields) THEN jsonb_build_object('origin',
      jsonb_build_object('actual_origin', l.origin, 'origins', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug) ORDER BY o.id), '[]'::jsonb)
        FROM public.lead_origins o WHERE o.id = ANY(v_origin_ids) AND o.organization_id = v_organization_id
      ))) ELSE '{}'::jsonb END)
    || (CASE WHEN p_fields && ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[] THEN jsonb_build_object('responsibles',
      jsonb_build_object('field_values',
        (CASE WHEN 'lead.pre_sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('pre_sale_responsible_id', l.pre_sale_responsible_id) ELSE '{}'::jsonb END)
        || (CASE WHEN 'lead.sale_responsible_id' = ANY(p_fields) THEN jsonb_build_object('sale_responsible_id', l.sale_responsible_id) ELSE '{}'::jsonb END)
        || (CASE WHEN 'lead.owners' = ANY(p_fields) THEN jsonb_build_object('owner_member_ids', coalesce((
          SELECT jsonb_agg(o.tm ORDER BY o.tm) FROM (
            SELECT l.pre_sale_responsible_id AS tm UNION SELECT l.sale_responsible_id
            UNION SELECT lo.team_member_id FROM public.lead_owners lo
              WHERE lo.lead_id = l.id AND lo.organization_id = l.organization_id
          ) o WHERE o.tm IS NOT NULL), '[]'::jsonb)) ELSE '{}'::jsonb END),
        'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.id), '[]'::jsonb)
          FROM public.team_members m WHERE m.id = ANY(v_member_ids) AND m.organization_id = v_organization_id
            AND NOT public.is_master_user(m.user_id))
      )) ELSE '{}'::jsonb END)
    || jsonb_build_object('custom_fields', (
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.field_name, 'field_type', f.field_type, 'value', v.value) || CASE WHEN f.field_type = 'select' THEN jsonb_build_object('field_options', f.field_options) ELSE '{}'::jsonb END ORDER BY f.id)
      FROM public.lead_custom_fields f
      LEFT JOIN public.lead_custom_field_values v ON v.field_id = f.id AND v.lead_id = l.id
      WHERE f.id = ANY(v_custom_ids) AND f.organization_id = v_organization_id
    ))
    FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_organization_id AND l.deleted_at IS NULL;
END;
$$;

-- ─── 10. test_guided_condition_responsibles  (parte de: 20271020000023_guided_personal_responsible_test.sql) ───
CREATE OR REPLACE FUNCTION public.test_guided_condition_responsibles(
  p_organization_id uuid, p_lead_id uuid, p_fields text[], p_member_ids uuid[]
) RETURNS TABLE(field_values jsonb, members jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_ids uuid[]; v_values jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  IF p_fields IS NULL OR cardinality(p_fields) = 0 OR cardinality(p_fields) > 3
    OR array_position(p_fields, NULL) IS NOT NULL
    OR NOT (p_fields <@ ARRAY['lead.pre_sale_responsible_id','lead.sale_responsible_id','lead.owners']::text[])
    OR p_member_ids IS NULL OR array_position(p_member_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  SELECT (CASE WHEN 'lead.pre_sale_responsible_id' = ANY(p_fields)
      THEN jsonb_build_object('pre_sale_responsible_id', l.pre_sale_responsible_id) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.sale_responsible_id' = ANY(p_fields)
      THEN jsonb_build_object('sale_responsible_id', l.sale_responsible_id) ELSE '{}'::jsonb END)
    || (CASE WHEN 'lead.owners' = ANY(p_fields) THEN jsonb_build_object('owner_member_ids', coalesce((
          SELECT jsonb_agg(o.tm ORDER BY o.tm) FROM (
            SELECT l.pre_sale_responsible_id AS tm UNION SELECT l.sale_responsible_id
            UNION SELECT lo.team_member_id FROM public.lead_owners lo
              WHERE lo.lead_id = l.id AND lo.organization_id = l.organization_id
          ) o WHERE o.tm IS NOT NULL), '[]'::jsonb)) ELSE '{}'::jsonb END)
    INTO v_values FROM public.leads l
    WHERE l.id = p_lead_id AND l.organization_id = p_organization_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE = 'PT404'; END IF;
  SELECT coalesce(array_agg(DISTINCT requested.id), '{}'::uuid[]) INTO v_ids
    FROM unnest(p_member_ids) AS requested(id);
  -- Preserve the existing visible-member catalogue. Check master status through
  -- its authoritative helper as master_users rows may be hidden by caller RLS.
  IF (SELECT count(*) FROM public.org_visible_members m WHERE m.organization_id = p_organization_id
    AND m.id = ANY(v_ids) AND NOT public.is_master_user(m.user_id)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422';
  END IF;
  RETURN QUERY SELECT v_values, coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) ORDER BY m.id), '[]'::jsonb)
    FROM public.org_visible_members m WHERE m.organization_id = p_organization_id
      AND m.id = ANY(v_ids) AND NOT public.is_master_user(m.user_id);
END;
$$;

-- ─── 11. finalize_guided_workflow_publication  (parte de: 20271020000036_guided_custom_select_publication.sql) ───
CREATE OR REPLACE FUNCTION public.finalize_guided_workflow_publication(
  p_workflow_id uuid, p_organization_id uuid, p_actor_id uuid, p_expected_revision integer,
  p_definition jsonb, p_settings jsonb, p_required_fields text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_draft public.workflow_guided_drafts;
  v_version public.workflow_guided_versions;
  v_number integer;
  v_tag_ids uuid[];
  v_tag_references jsonb;
  v_origin_ids uuid[];
  v_origin_references jsonb;
  v_invalid_node_ids text[];
  v_member_ids uuid[];
  v_member_references jsonb;
  v_custom_references jsonb;
  v_custom_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.organizations o WHERE o.id = p_organization_id
    AND NOT public.org_access_blocked(o.id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;

  -- Actor comes from verified edge identity, not the browser request. Recheck
  -- current authority and hold the row until publication commits.
  SELECT true INTO v_authorized FROM public.team_members t
    WHERE t.user_id = p_actor_id AND t.organization_id = p_organization_id
      AND t.role = 'admin' AND t.is_active = true FOR SHARE;
  IF NOT coalesce(v_authorized, false) THEN
    SELECT true INTO v_authorized FROM public.master_users m
      WHERE m.user_id = p_actor_id AND m.is_active = true
        AND m.permissions -> 'all' = 'true'::jsonb FOR SHARE;
  END IF;
  IF NOT coalesce(v_authorized, false) THEN
    SELECT true INTO v_authorized FROM public.gestores g
      JOIN public.gestor_organizations go ON go.gestor_id = g.id
      WHERE g.user_id = p_actor_id AND g.is_active = true AND go.organization_id = p_organization_id
      FOR SHARE OF g, go;
  END IF;
  IF NOT coalesce(v_authorized, false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workflows w
    WHERE w.id = p_workflow_id AND w.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_draft FROM public.workflow_guided_drafts d
    WHERE d.workflow_id = p_workflow_id AND d.organization_id = p_organization_id;
  IF NOT FOUND OR v_draft.revision IS DISTINCT FROM p_expected_revision
    OR v_draft.definition IS DISTINCT FROM p_definition OR v_draft.settings IS DISTINCT FROM p_settings THEN
    RAISE EXCEPTION 'draft_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings -> 'name') IS DISTINCT FROM 'string'
    OR btrim(p_settings ->> 'name') = ''
    OR NOT public.valid_guided_data_scopes(p_required_fields) THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE = '22023';
  END IF;
  -- Every custom rule refers to a definition, including empty/filled checks.
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id,
      'fieldId', condition ->> 'fieldId', 'fieldType', condition ->> 'fieldType',
      'operator', condition ->> 'operator', 'value', condition -> 'value')), '[]'::jsonb)
    INTO v_custom_references FROM conditions WHERE condition ->> 'field' = 'lead.custom';
  IF jsonb_array_length(v_custom_references) > 0 THEN
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_custom_references) AS r
      WHERE r ->> 'fieldId' IS NULL OR r ->> 'fieldId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR coalesce(r ->> 'fieldType', '') NOT IN ('text', 'number', 'boolean', 'date', 'select');
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_custom_references) AS r
      WHERE NOT (('lead.custom:' || lower(r ->> 'fieldId')) = ANY(p_required_fields))) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(DISTINCT (r ->> 'fieldId')::uuid), '{}'::uuid[]) INTO v_custom_ids
      FROM jsonb_array_elements(v_custom_references) AS r;
    PERFORM 1 FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
      AND f.id = ANY(v_custom_ids) FOR SHARE;
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_custom_references) AS r WHERE NOT EXISTS (
        SELECT 1 FROM public.lead_custom_fields f WHERE f.organization_id = p_organization_id
          AND f.id = (r ->> 'fieldId')::uuid AND f.field_type = r ->> 'fieldType'
          AND (f.field_type <> 'select' OR (
            -- Guard expansion explicitly: malformed option metadata fails closed.
            CASE WHEN f.field_options IS NULL OR jsonb_typeof(f.field_options) = 'array' THEN
              NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(f.field_options, '[]'::jsonb)) AS option
                WHERE jsonb_typeof(option) <> 'string' OR option = '""'::jsonb)
              AND (r ->> 'operator' IN ('is_empty', 'is_not_empty') OR (
                r ->> 'operator' IN ('equals', 'not_equals') AND jsonb_typeof(r -> 'value') = 'string'
                AND r ->> 'value' <> '' AND coalesce(f.field_options, '[]'::jsonb) @> jsonb_build_array(r -> 'value')
              ))
            ELSE false END
          ))
      );
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  IF cardinality(p_required_fields) > 0 THEN
    PERFORM 1 FROM public.workflow_data_grants g
      WHERE g.workflow_id = p_workflow_id AND g.organization_id = p_organization_id
        AND g.resource_scope = 'organization_leads' AND p_required_fields <@ g.fields FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  END IF;
  -- Walk every rule, including branches the evaluator may later skip. Names
  -- supplied by the draft are display hints and never authorize an identity.
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'tagId', condition ->> 'tagId')), '[]'::jsonb)
    INTO v_tag_references FROM conditions WHERE condition ->> 'field' = 'lead.tags';
  SELECT coalesce(array_agg(DISTINCT (r ->> 'tagId')::uuid), '{}'::uuid[]) INTO v_tag_ids
    FROM jsonb_array_elements(v_tag_references) AS r;
  IF cardinality(v_tag_ids) > 0 THEN
    IF NOT ('lead.tags' = ANY(p_required_fields)) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_tag_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_tag_ids)) <> cardinality(v_tag_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_tag_references) AS r WHERE NOT EXISTS (
          SELECT 1 FROM public.tags t WHERE t.organization_id = p_organization_id AND t.id = (r ->> 'tagId')::uuid
        );
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'originId', CASE WHEN condition ->> 'operator' IN ('is_empty', 'is_not_empty') THEN NULL ELSE condition ->> 'originId' END)), '[]'::jsonb)
    INTO v_origin_references FROM conditions WHERE condition ->> 'field' = 'lead.origin';
  SELECT coalesce(array_agg(DISTINCT (r ->> 'originId')::uuid), '{}'::uuid[]) INTO v_origin_ids
    FROM jsonb_array_elements(v_origin_references) AS r WHERE r ->> 'originId' IS NOT NULL;
  IF jsonb_array_length(v_origin_references) > 0 THEN
    IF NOT ('lead.origin' = ANY(p_required_fields)) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_origin_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = ANY(v_origin_ids)) <> cardinality(v_origin_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_origin_references) AS r WHERE r ->> 'originId' IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.lead_origins t WHERE t.organization_id = p_organization_id AND t.id = (r ->> 'originId')::uuid
        );
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  WITH RECURSIVE conditions(node_id, condition) AS (
    SELECT n ->> 'id', n -> 'data' -> 'guidedCondition'
      FROM jsonb_array_elements(p_definition -> 'nodes') AS n WHERE n ->> 'type' = 'condition'
    UNION ALL
    SELECT c.node_id, child FROM conditions c CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN c.condition ->> 'kind' = 'group' THEN c.condition -> 'children' ELSE '[]'::jsonb END
    ) AS child
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('nodeId', node_id, 'field', condition ->> 'field',
      'requiresReference', coalesce(condition ->> 'operator', '') NOT IN ('is_empty', 'is_not_empty'),
      'memberId', CASE WHEN condition ->> 'operator' IN ('is_empty', 'is_not_empty') THEN NULL ELSE condition ->> 'memberId' END)), '[]'::jsonb)
    INTO v_member_references FROM conditions
    WHERE condition ->> 'field' IN ('lead.pre_sale_responsible_id', 'lead.sale_responsible_id', 'lead.owners');
  IF jsonb_array_length(v_member_references) > 0 THEN
    -- Empty checks also read an assignment and require that exact slot's scope.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_member_references) AS r
      WHERE NOT ((r ->> 'field') = ANY(p_required_fields))) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
      FROM jsonb_array_elements(v_member_references) AS r
      WHERE r ->> 'requiresReference' = 'true' AND (r ->> 'memberId' IS NULL
        OR r ->> 'memberId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    IF cardinality(v_invalid_node_ids) > 0 THEN
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
    SELECT coalesce(array_agg(DISTINCT (r ->> 'memberId')::uuid), '{}'::uuid[]) INTO v_member_ids
      FROM jsonb_array_elements(v_member_references) AS r WHERE r ->> 'memberId' IS NOT NULL;
    PERFORM 1 FROM public.team_members m WHERE m.organization_id = p_organization_id AND m.id = ANY(v_member_ids) FOR SHARE;
    IF (SELECT count(*) FROM public.team_members m WHERE m.organization_id = p_organization_id
      AND m.id = ANY(v_member_ids) AND NOT public.is_master_user(m.user_id)) <> cardinality(v_member_ids) THEN
      SELECT array_agg(DISTINCT r ->> 'nodeId' ORDER BY r ->> 'nodeId') INTO v_invalid_node_ids
        FROM jsonb_array_elements(v_member_references) AS r WHERE r ->> 'memberId' IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.team_members m WHERE m.organization_id = p_organization_id
            AND m.id = (r ->> 'memberId')::uuid AND NOT public.is_master_user(m.user_id)
        );
      RAISE EXCEPTION 'reference_unavailable' USING ERRCODE = 'PT422',
        DETAIL = jsonb_build_object('nodeIds', v_invalid_node_ids)::text;
    END IF;
  END IF;
  SELECT coalesce(max(v.version_number), 0) + 1 INTO v_number
    FROM public.workflow_guided_versions v WHERE v.workflow_id = p_workflow_id AND v.organization_id = p_organization_id;
  INSERT INTO public.workflow_guided_versions(workflow_id, organization_id, version_number, source_revision,
    definition, settings, required_fields, published_by)
  VALUES (p_workflow_id, p_organization_id, v_number, p_expected_revision, p_definition, p_settings, p_required_fields, p_actor_id)
  RETURNING * INTO v_version;
  INSERT INTO public.workflow_guided_publications AS p (workflow_id, organization_id, version_id)
  VALUES (p_workflow_id, p_organization_id, v_version.id)
  ON CONFLICT (workflow_id) DO UPDATE SET version_id = EXCLUDED.version_id
    WHERE p.organization_id = EXCLUDED.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('version_id', v_version.id, 'version_number', v_version.version_number);
END;
$$;

COMMIT;
