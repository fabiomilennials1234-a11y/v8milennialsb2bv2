-- S4 — as reuniões que viviam no funil passam a existir na AGENDA (C1).
--
-- Decisão do CTO: A1+B3+C1. Ver .specs/agenda-fonte-unica/PLANO.md.
--
-- ── O que entra ──────────────────────────────────────────────────────────
-- União de duas origens, deduplicada por (lead_id, meeting_date):
--   · `meeting_events` com `event_type='meeting_booked'` e data preenchida
--   · `pipe_confirmacao` com `meeting_date` — 98% já coberto pela primeira
-- Medido em 2026-09-01: ~884 pares distintos. O número é calculado no APPLY,
-- não fixado aqui: `meeting_events` recebe escrita o tempo todo (1582 → 1585
-- entre duas medições da mesma sessão).
--
-- ── O que NÃO entra, e por quê ───────────────────────────────────────────
-- ~284 `meeting_booked` **sem `meeting_date`** (24% do total). Um evento de
-- agenda sem data não é um evento de agenda: não tem onde ser desenhado, e
-- inventar data seria fabricar um fato. Elas continuam em `meeting_events`,
-- que segue sendo o livro de métrica — nenhum número histórico se perde.
-- "Migrar tudo" na prática é "migrar tudo que tem data".
--
-- ── Status de destino ────────────────────────────────────────────────────
--   tem `meeting_held` vinculado          → 'completed'
--   sem held e data no passado            → 'no_show'
--   sem held e data no futuro             → 'scheduled'
--
-- 🚨 Gravar `no_show` no passado NÃO é opinião nova: é exatamente a conta que
-- `useSDRPerformance` e `get_dashboard_metrics` já fazem hoje ("agendada,
-- passada, sem held"). Gravar `scheduled` ali zeraria o histórico de falta no
-- dia em que o S5 trocar os leitores para ler `meetings`. O backfill preserva
-- o número vigente; mudar o número é decisão de outra fatia.
--
-- ── Procedência e reversibilidade ────────────────────────────────────────
-- Toda linha nasce com `external_ref = 'backfill:agenda-fonte-unica:<origem>:<id>'`.
-- A coluna estava 100% livre (0 de 49 linhas usavam). Desfazer é
-- `DELETE FROM meetings WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%'`
-- — ver `supabase/migrations/rollback/`. Sem a procedência, o backfill seria
-- indistinguível de reunião criada por gente, e irreversível na prática.
--
-- ── Enriquecimento (medido, não suposto) ─────────────────────────────────
--   deal_id      via `source_entry_id` → `pipeline_entries.deal_id`   ~74%
--   pipeline_id  via `source_entry_id` → `pipeline_entries`           ~95%
--   created_by   via `pre_sale_responsible_id` → `team_members.user_id` ~82%
--
-- ⚠️ `meetings.created_by` é FK para **auth.users**, e
-- `pre_sale_responsible_id` é **team_members.id**. São espaços de id
-- diferentes: copiar um no outro passaria no INSERT (uuid é uuid) e quebraria
-- na FK, ou pior, casaria com o usuário errado. Por isso o join por
-- `team_members.user_id`. Quem não resolve fica NULL — nulo honesto vale mais
-- que atribuição inventada.
--
-- ── A dedup da Agenda: por que `get_agenda_events` muda junto ────────────
-- 🚨 Sem isto o backfill produz EVENTO DUPLICADO na tela. A Source 5
-- (`meeting_events`) já se exclui quando existe `meetings` com o mesmo par
-- (lead, data) — foi escrita assim. A Source 4 (`pipe_confirmacao`) NÃO tem
-- essa guarda: ela devolve toda linha com `meeting_date`, incondicionalmente.
-- Como as 466 linhas de `pipe_confirmacao` com data entram no backfill, as 466
-- apareceriam DUAS vezes: uma como `meeting`, outra como `pipe_confirmacao`.
-- A Source 4 ganha a mesma guarda da Source 5, e nada mais na função muda.
--
-- Reaplicar é no-op: o INSERT tem `NOT EXISTS` contra o par (lead, data).

-- ── 1. Backfill ──────────────────────────────────────────────────────────
WITH origem AS (
  -- (a) meeting_events — a fonte majoritária
  SELECT
    me.organization_id,
    me.lead_id,
    me.meeting_date,
    me.pre_sale_responsible_id AS responsavel_tm,
    me.source_entry_id,
    EXISTS (
      SELECT 1 FROM public.meeting_events h
      WHERE h.booked_event_id = me.id AND h.event_type = 'meeting_held'
    ) AS compareceu,
    'meeting_event' AS origem,
    me.id AS origem_id,
    me.occurred_at AS ordenador
  FROM public.meeting_events me
  WHERE me.event_type = 'meeting_booked'
    AND me.meeting_date IS NOT NULL

  UNION ALL

  -- (b) pipe_confirmacao — o resto (10 de 466 não estão em meeting_events)
  SELECT
    pc.organization_id,
    pc.lead_id,
    pc.meeting_date,
    COALESCE(pc.closer_id, pc.sdr_id) AS responsavel_tm, -- metric-lint-allow: não é métrica de atribuição; é "quem marcou", mesma regra que a Source 4 da agenda já usa
    NULL::uuid AS source_entry_id,
    (pc.status::text = 'compareceu') AS compareceu,
    'pipe_confirmacao' AS origem,
    pc.id AS origem_id,
    pc.created_at AS ordenador
  FROM public.pipe_confirmacao pc
  WHERE pc.meeting_date IS NOT NULL
),
-- Um par (lead, data) é UMA reunião, venha de onde vier. `meeting_event`
-- primeiro porque carrega o desfecho e o vínculo com a entrada do funil.
deduplicada AS (
  SELECT DISTINCT ON (lead_id, meeting_date) *
  FROM origem
  ORDER BY lead_id, meeting_date,
           (origem = 'meeting_event') DESC,
           ordenador DESC
)
INSERT INTO public.meetings (
  organization_id, title, start_at, end_at, all_day, event_type, status,
  lead_id, pipeline_id, deal_id, created_by, external_ref
)
SELECT
  d.organization_id,
  COALESCE(NULLIF(btrim(l.name), ''), 'Reuniao'),
  d.meeting_date,
  d.meeting_date + interval '1 hour',  -- mesma duração que as Sources 4 e 5 já desenhavam
  false,
  'meeting',
  CASE
    WHEN d.compareceu                    THEN 'completed'
    WHEN d.meeting_date < now()          THEN 'no_show'
    ELSE 'scheduled'
  END,
  d.lead_id,
  pe.pipeline_id,
  pe.deal_id,
  tm.user_id,
  'backfill:agenda-fonte-unica:' || d.origem || ':' || d.origem_id::text
FROM deduplicada d
JOIN public.leads l ON l.id = d.lead_id
LEFT JOIN public.pipeline_entries pe ON pe.id = d.source_entry_id
LEFT JOIN public.team_members tm ON tm.id = d.responsavel_tm
WHERE NOT EXISTS (
  SELECT 1 FROM public.meetings m
  WHERE m.lead_id = d.lead_id AND m.start_at = d.meeting_date
);

-- ── 2. A Agenda para de mostrar a mesma reunião duas vezes ───────────────
-- Corpo idêntico ao vigente (20270831000020) com UMA guarda a mais, na
-- Source 4. Assinatura e RETURNS TABLE preservados byte-a-byte.
-- ⚠️ O corpo abaixo é o da 20270831000020 BYTE A BYTE, com uma única guarda
-- acrescentada na Source 4. A primeira versão desta migration reescreveu os
-- SELECT de forma condensada, sem os aliases `'x'::text AS source` — mudança
-- só de forma, e ainda assim errada: `tests/unit/agenda-fontes-contract.test.ts`
-- extrai as fontes exatamente desse literal, e passou a enxergar ZERO fontes.
-- Guarda que audita a função inteira merece um corpo que ela consiga ler.
CREATE OR REPLACE FUNCTION public.get_agenda_events(p_organization_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(id uuid, source text, title text, description text, start_at timestamp with time zone, end_at timestamp with time zone, all_day boolean, event_type text, status text, lead_id uuid, lead_name text, lead_company text, created_by uuid, creator_name text, location text, meet_link text, color text, google_event_id text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY

  -- Source 1: meetings
  SELECT
    m.id,
    'meeting'::text AS source,
    m.title,
    m.description,
    m.start_at,
    m.end_at,
    m.all_day,
    m.event_type,
    m.status,
    m.lead_id,
    l.name AS lead_name,
    l.company AS lead_company,
    m.created_by,
    tm.name AS creator_name,
    m.location,
    m.meet_link,
    m.color,
    m.google_event_id
  FROM public.meetings m
  LEFT JOIN public.leads l ON l.id = m.lead_id
  -- `team_members.user_id` NÃO é único: um master tem uma linha por org em que
  -- é membro. Sem o predicado de org o join FANOUT — cada meeting aparecia N
  -- vezes na agenda (medido: 16x, criador membro de 15 orgs). As demais sources
  -- juntam por `team_members.id` (PK) e não têm esse problema.
  LEFT JOIN public.team_members tm
    ON tm.user_id = m.created_by
   AND tm.organization_id = m.organization_id
  WHERE m.organization_id = p_organization_id
    AND m.start_at < p_end
    AND m.end_at > p_start

  UNION ALL

  -- Source 2: follow_ups (non-archived, with due_date in range)
  SELECT
    fu.id,
    'follow_up'::text AS source,
    fu.title,
    fu.description,
    fu.due_date AS start_at,
    fu.due_date + interval '30 minutes' AS end_at,
    false AS all_day,
    'follow_up'::text AS event_type,
    CASE
      WHEN fu.completed_at IS NOT NULL THEN 'completed'
      ELSE 'scheduled'
    END AS status,
    fu.lead_id,
    l2.name AS lead_name,
    l2.company AS lead_company,
    fu.assigned_to AS created_by,
    tm2.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.follow_ups fu
  LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
  LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
  WHERE fu.organization_id = p_organization_id
    AND fu.archived_at IS NULL
    AND fu.due_date >= p_start
    AND fu.due_date < p_end

  UNION ALL

  -- Source 3: scheduled_user_messages (only scheduled/sending)
  SELECT
    sm.id,
    'scheduled_message'::text AS source,
    COALESCE(
      LEFT(sm.message_content, 60),
      'Mensagem agendada'
    ) AS title,
    sm.message_content AS description,
    sm.scheduled_at AS start_at,
    sm.scheduled_at + interval '5 minutes' AS end_at,
    false AS all_day,
    'task'::text AS event_type,
    sm.status,
    sm.lead_id,
    l3.name AS lead_name,
    l3.company AS lead_company,
    sm.created_by,
    tm3.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.scheduled_user_messages sm
  LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
  LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
  WHERE sm.organization_id = p_organization_id
    AND sm.status IN ('scheduled', 'sending')
    AND sm.scheduled_at >= p_start
    AND sm.scheduled_at < p_end

  UNION ALL

  -- Source 4: pipe_confirmacao (entries with non-null meeting_date)
  SELECT
    pc.id,
    'pipe_confirmacao'::text AS source,
    COALESCE(l4.name, 'Reuniao') AS title,
    pc.notes AS description,
    pc.meeting_date AS start_at,
    pc.meeting_date + interval '1 hour' AS end_at,
    false AS all_day,
    'meeting'::text AS event_type,
    pc.status::text AS status,
    pc.lead_id,
    l4.name AS lead_name,
    l4.company AS lead_company,
    COALESCE(pc.closer_id, pc.sdr_id) AS created_by, -- metric-lint-allow: agenda não é métrica de atribuição; é "quem marcou" para exibir na linha, preservado byte-a-byte de 20260985000000
    COALESCE(tm_closer.name, tm_sdr.name) AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
  FROM public.pipe_confirmacao pc
  LEFT JOIN public.leads l4 ON l4.id = pc.lead_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = pc.closer_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pc.sdr_id
  WHERE pc.organization_id = p_organization_id
    AND pc.meeting_date IS NOT NULL
    AND pc.meeting_date >= p_start
    AND pc.meeting_date < p_end
    -- 🚨 A guarda NOVA (20270907000020). A Source 5 já tinha a dela desde a
    -- 20270831000020; a Source 4 não, e sem isto toda reunião migrada para
    -- `meetings` pelo backfill aparecia DUAS vezes na mesma grade.
    AND NOT EXISTS (
      SELECT 1 FROM public.meetings m4
      WHERE m4.lead_id = pc.lead_id AND m4.start_at = pc.meeting_date
    )

  UNION ALL

  -- Source 5: meeting_events (funil mergeado — ADR-0004 / ADR-0007)
  SELECT
    me.id,
    'meeting_event'::text AS source,
    COALESCE(l5.name, 'Reuniao') AS title,
    NULL::text AS description,
    me.meeting_date AS start_at,
    me.meeting_date + interval '1 hour' AS end_at,
    false AS all_day,
    'meeting'::text AS event_type,
    me.held_status AS status,
    me.lead_id,
    l5.name AS lead_name,
    l5.company AS lead_company,
    me.pre_sale_responsible_id AS created_by,
    tm5.name AS creator_name,
    NULL::text AS location,
    NULL::text AS meet_link,
    NULL::text AS color,
    NULL::text AS google_event_id
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
      -- já representadas pela Source 4 (fonte viva, reflete remarcação)
      AND e.source IS DISTINCT FROM 'pipeline:confirmacao'
      -- carga histórica, não pertence à agenda
      AND (e.source IS NULL OR e.source NOT LIKE 'backfill:%')
      AND e.meeting_date >= p_start
      AND e.meeting_date < p_end
    ORDER BY e.lead_id, e.meeting_date, e.occurred_at DESC
  ) me
  LEFT JOIN public.leads l5 ON l5.id = me.lead_id
  LEFT JOIN public.team_members tm5 ON tm5.id = me.pre_sale_responsible_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pipe_confirmacao pc2
    WHERE pc2.lead_id = me.lead_id AND pc2.meeting_date = me.meeting_date
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.meetings m2
    WHERE m2.lead_id = me.lead_id AND m2.start_at = me.meeting_date
  )

  ORDER BY start_at ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) IS
  'Agenda da org, 5 fontes: meetings, follow_ups, scheduled_user_messages, pipe_confirmacao e meeting_events. As Sources 4 e 5 se excluem quando a mesma reunião (lead + data) já existe em `meetings` — depois do backfill 20270907000020, `meetings` é a fonte canônica e as outras duas tendem a zero. Org-wide de propósito; o recorte por usuário é de get_comando_agenda_events.';

REVOKE ALL     ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_agenda_events(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ── 3. Guardas ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_dup integer;
  v_sem_org integer;
  v_status_invalido integer;
BEGIN
  -- Nenhum par (lead, data) pode ter ficado duplicado dentro de `meetings`.
  SELECT count(*) INTO v_dup FROM (
    SELECT lead_id, start_at FROM public.meetings
    WHERE lead_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'backfill duplicou % par(es) (lead, data) em meetings', v_dup;
  END IF;

  -- Toda linha do backfill tem de ter org — sem org a RLS a esconde de todos.
  SELECT count(*) INTO v_sem_org FROM public.meetings
  WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%' AND organization_id IS NULL;
  IF v_sem_org > 0 THEN
    RAISE EXCEPTION '% linha(s) do backfill sem organization_id', v_sem_org;
  END IF;

  SELECT count(*) INTO v_status_invalido FROM public.meetings
  WHERE external_ref LIKE 'backfill:agenda-fonte-unica:%'
    AND status NOT IN ('completed', 'no_show', 'scheduled');
  IF v_status_invalido > 0 THEN
    RAISE EXCEPTION '% linha(s) do backfill com status fora do esperado', v_status_invalido;
  END IF;
END $$;
