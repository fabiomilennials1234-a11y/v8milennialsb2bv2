-- Restore prior behavior without deleting appointments created since deployment.
BEGIN;
DROP TRIGGER IF EXISTS trg_meeting_bind_booking ON public.meetings;
DROP TRIGGER IF EXISTS trg_pipeline_meeting_date_to_agenda ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_meeting_outcome_to_events ON public.meetings;
CREATE OR REPLACE FUNCTION public.fn_meeting_outcome_to_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booked_id uuid;
  v_presale   uuid;
  v_desfecho  text;
  v_origem_id uuid;
BEGIN
  -- Só REUNIÃO conta em métrica de reunião. Ver o cabeçalho: ligação, tarefa,
  -- follow-up e "outro" também moram em `meetings` e também têm os botões.
  IF NEW.event_type IS DISTINCT FROM 'meeting' THEN
    RETURN NEW;
  END IF;

  -- `meeting_events.lead_id` é NOT NULL. Reunião interna (sem lead) não entra
  -- no livro de métrica — e não deveria mesmo: não há a quem atribuir.
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_desfecho := CASE NEW.status
                  WHEN 'completed' THEN 'meeting_held'
                  WHEN 'no_show'   THEN 'meeting_no_show'
                  ELSE NULL
                END;

  -- ── Localizar o agendamento correspondente ────────────────────────────
  -- (a) procedência do backfill: `backfill:agenda-fonte-unica:meeting_event:<id>`
  --     é o caminho EXATO — 874 das 884 migradas carregam o id de origem.
  IF NEW.external_ref LIKE 'backfill:agenda-fonte-unica:meeting_event:%' THEN
    BEGIN
      v_origem_id := split_part(NEW.external_ref, ':', 4)::uuid;
    EXCEPTION WHEN others THEN
      v_origem_id := NULL;   -- external_ref malformado não pode derrubar a escrita
    END;
    SELECT me.id INTO v_booked_id
    FROM public.meeting_events me
    WHERE me.id = v_origem_id AND me.event_type = 'meeting_booked';
  END IF;

  -- (b) por (lead, data): cobre o que veio de `pipe_confirmacao` e o que a
  --     operação marcou pelo funil antes de abrir a agenda.
  IF v_booked_id IS NULL THEN
    SELECT me.id INTO v_booked_id
    FROM public.meeting_events me
    WHERE me.organization_id = NEW.organization_id
      AND me.lead_id = NEW.lead_id
      AND me.event_type = 'meeting_booked'
      AND me.meeting_date = NEW.start_at
    ORDER BY me.occurred_at DESC
    LIMIT 1;
  END IF;

  -- (c) reunião nascida NA agenda não tem agendamento no livro. Criar aqui é
  --     o que faz "marquei pela agenda" contar como REUNIÃO MARCADA — que é
  --     metade do pedido, e a metade que quase ficou de fora.
  --
  --     A primeira versão só criava o agendamento quando havia desfecho, com
  --     a justificativa de "não deixar lixo no livro". O efeito seria: marcar
  --     uma reunião pela Agenda não contaria em `reunioesMarcadas` até alguém
  --     registrar comparecimento — ou seja, a métrica de agendamento
  --     continuaria dependendo do funil, que é exatamente o que esta fatia
  --     veio desfazer.
  --
  --     Não há duplicidade com o funil: movimento de card grava em
  --     `meeting_events` e NÃO cria linha em `meetings`, então cada origem
  --     produz um agendamento e só um.
  IF v_booked_id IS NULL THEN
    -- UMA chave canônica, sem cadeia de fallback (ADR-0017 R5).
    --
    -- A primeira versão encadeava a coluna canônica com `sdr_id` por fallback,
    -- copiando `fn_capture_meeting_event` — que carrega isso por herança. O
    -- lint de métrica reprovou, e com razão: `sdr_id` é o NOME ANTIGO da coluna
    -- canônica, então o encadeamento não é fallback, é ambiguidade sobre qual
    -- das duas manda.
    --
    -- Medido em prod: 57.895 leads, ZERO com `sdr_id` preenchido e
    -- `pre_sale_responsible_id` nulo. O fallback nunca dispararia. Nulo aqui é
    -- honesto — reunião sem pré-venda atribuída existe, e inventar dono seria
    -- pior que não ter.
    SELECT l.pre_sale_responsible_id INTO v_presale
    FROM public.leads l WHERE l.id = NEW.lead_id;

    INSERT INTO public.meeting_events
      (organization_id, lead_id, event_type, pre_sale_responsible_id,
       meeting_date, occurred_at, source, metadata)
    VALUES
      (NEW.organization_id, NEW.lead_id, 'meeting_booked', v_presale,
       NEW.start_at, COALESCE(NEW.created_at, now()), 'agenda:meeting',
       jsonb_build_object('meeting_id', NEW.id))
    RETURNING id INTO v_booked_id;
  END IF;

  -- ── Aplicar o desfecho ────────────────────────────────────────────────
  -- A agenda é autoridade: apaga o que houver e grava o que a tela diz. O
  -- índice `uniq_meeting_events_desfecho_por_agendamento` (20270907000010) já
  -- garante no máximo um desfecho; o DELETE aqui é o que permite TROCAR de
  -- ideia, e não só registrar a primeira vez.
  DELETE FROM public.meeting_events
  WHERE booked_event_id = v_booked_id
    AND event_type IN ('meeting_held', 'meeting_no_show')
    AND (v_desfecho IS NULL OR event_type IS DISTINCT FROM v_desfecho);

  IF v_desfecho IS NOT NULL THEN
    SELECT pre_sale_responsible_id INTO v_presale
    FROM public.meeting_events WHERE id = v_booked_id;

    INSERT INTO public.meeting_events
      (organization_id, lead_id, event_type, booked_event_id,
       pre_sale_responsible_id, meeting_date, occurred_at, source, metadata)
    VALUES
      (NEW.organization_id, NEW.lead_id, v_desfecho, v_booked_id,
       v_presale, NEW.start_at, now(), 'agenda:meeting',
       jsonb_build_object('meeting_id', NEW.id))
    ON CONFLICT (booked_event_id) WHERE event_type IN ('meeting_held', 'meeting_no_show')
    DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_meeting_outcome_to_events AFTER INSERT OR UPDATE OF status
ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.fn_meeting_outcome_to_events();
CREATE TRIGGER trg_meeting_events_capture AFTER INSERT OR UPDATE OF stage_key,metadata
ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.fn_capture_meeting_event();
CREATE OR REPLACE FUNCTION public.get_agenda_events(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY

  -- Source 1: meetings
  SELECT
    m.id, 'meeting'::text, m.title, m.description, m.start_at, m.end_at,
    m.all_day, m.event_type, m.status, m.lead_id, l.name, l.company,
    m.created_by, tm.name, m.location, m.meet_link, m.color, m.google_event_id
  FROM public.meetings m
  LEFT JOIN public.leads l ON l.id = m.lead_id
  LEFT JOIN public.team_members tm
    ON tm.user_id = m.created_by
   AND tm.organization_id = m.organization_id
  WHERE m.organization_id = p_organization_id
    AND m.start_at < p_end
    AND m.end_at > p_start

  UNION ALL

  -- Source 2: follow_ups
  SELECT
    fu.id, 'follow_up'::text, fu.title, fu.description, fu.due_date,
    fu.due_date + interval '30 minutes', false, 'follow_up'::text,
    CASE WHEN fu.completed_at IS NOT NULL THEN 'completed' ELSE 'scheduled' END,
    fu.lead_id, l2.name, l2.company, fu.assigned_to, tm2.name,
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.follow_ups fu
  LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
  LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
  WHERE fu.organization_id = p_organization_id
    AND fu.archived_at IS NULL
    AND fu.due_date >= p_start
    AND fu.due_date < p_end

  UNION ALL

  -- Source 3: scheduled_user_messages
  SELECT
    sm.id, 'scheduled_message'::text,
    COALESCE(LEFT(sm.message_content, 60), 'Mensagem agendada'),
    sm.message_content, sm.scheduled_at, sm.scheduled_at + interval '5 minutes',
    false, 'task'::text, sm.status, sm.lead_id, l3.name, l3.company,
    sm.created_by, tm3.name, NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.scheduled_user_messages sm
  LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
  LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
  WHERE sm.organization_id = p_organization_id
    AND sm.status IN ('scheduled', 'sending')
    AND sm.scheduled_at >= p_start
    AND sm.scheduled_at < p_end

  UNION ALL

  -- Source 4: pipe_confirmacao
  SELECT
    pc.id, 'pipe_confirmacao'::text, COALESCE(l4.name, 'Reuniao'), pc.notes,
    pc.meeting_date, pc.meeting_date + interval '1 hour', false, 'meeting'::text,
    pc.stage_key::text, pc.lead_id, l4.name, l4.company,
    COALESCE(pc.closer_id, pc.sdr_id), -- metric-lint-allow: agenda não é métrica de atribuição; preservado byte-a-byte de 20270831000020
    COALESCE(tm_closer.name, tm_sdr.name),
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM public.negocio_projetado pc
  LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = pc.closer_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pc.sdr_id
  WHERE pc.funil_sistema = 'confirmacao'
    AND pc.organization_id = p_organization_id
    AND pc.meeting_date IS NOT NULL
    AND pc.meeting_date >= p_start
    AND pc.meeting_date < p_end
    -- 🚨 A guarda nova. A Source 5 já tinha a dela desde 20270831000020; a
    -- Source 4 não, e sem isto toda reunião migrada para `meetings` aparecia
    -- duas vezes na mesma grade.
    AND NOT EXISTS (
      SELECT 1 FROM public.meetings m4
      WHERE m4.lead_id = pc.lead_id AND m4.start_at = pc.meeting_date
    )

  UNION ALL

  -- Source 5: meeting_events (funil mergeado)
  SELECT
    me.id, 'meeting_event'::text, COALESCE(l5.name, 'Reuniao'), NULL::text,
    me.meeting_date, me.meeting_date + interval '1 hour', false, 'meeting'::text,
    me.held_status, me.lead_id, l5.name, l5.company,
    me.pre_sale_responsible_id, tm5.name,
    NULL::text, NULL::text, NULL::text, NULL::text
  FROM (
    SELECT DISTINCT ON (e.lead_id, e.meeting_date)
      e.id, e.lead_id, e.meeting_date, e.pre_sale_responsible_id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.meeting_events h
          WHERE h.booked_event_id = e.id AND h.event_type = 'meeting_held'
        ) THEN 'completed'
        ELSE 'scheduled'
      END AS held_status
    FROM public.meeting_events e
    WHERE e.organization_id = p_organization_id
      AND e.event_type = 'meeting_booked'
      AND e.meeting_date IS NOT NULL
      AND e.source IS DISTINCT FROM 'pipeline:confirmacao'
      AND (e.source IS NULL OR e.source NOT LIKE 'backfill:%')
      AND e.meeting_date >= p_start
      AND e.meeting_date < p_end
    ORDER BY e.lead_id, e.meeting_date, e.occurred_at DESC
  ) me
  LEFT JOIN public.leads l5 ON l5.id = me.lead_id
  LEFT JOIN public.team_members tm5 ON tm5.id = me.pre_sale_responsible_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.negocio_projetado pc2
    WHERE pc2.funil_sistema = 'confirmacao'
      AND pc2.lead_id = me.lead_id AND pc2.meeting_date = me.meeting_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.meetings m2
    WHERE m2.lead_id = me.lead_id AND m2.start_at = me.meeting_date
  )

  ORDER BY start_at ASC;
END;
$function$;
COMMIT;
