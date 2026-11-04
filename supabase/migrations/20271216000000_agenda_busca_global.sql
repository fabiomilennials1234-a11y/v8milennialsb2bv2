-- 20271216000000_agenda_busca_global.sql
--
-- Busca global na Agenda: "este cliente tem algo marcado?" SEM janela de datas.
--
-- ─── O problema ──────────────────────────────────────────────────────────────
-- `get_agenda_events_scoped(org, start, end)` só responde dentro do período que
-- a tela está mostrando. Quem procura "o que tem marcado com a Padaria X" não
-- sabe em que mês olhar. Esta função procura em TODO o histórico/futuro.
--
-- ─── Decisões ────────────────────────────────────────────────────────────────
-- 1. Função NOVA, não parâmetro novo nas existentes (lição da #1774: mudar a
--    assinatura de uma RPC viva derruba o board entre deploy e apply).
-- 2. NÃO compõe sobre `get_agenda_events` com janela infinita: isso
--    materializaria a agenda inteira da org a cada busca (follow-ups e
--    mensagens agendadas somam dezenas de milhares). O filtro de texto entra no
--    WHERE de cada fonte e cada fonte é limitada (LIMIT) antes da união.
-- 3. SECURITY INVOKER + search_path fixo, como a `_scoped`: o isolamento entre
--    orgs continua sendo o RLS das tabelas (todas por organização) e o gate de
--    org abaixo só devolve erro cedo e legível. Por isso NÃO se lê `meetings`
--    direto do front: o RLS de `meetings` é só por org, e o recorte "só os
--    meus" vive AQUI, no banco.
-- 4. Fontes = as 3 de `get_agenda_events` vigente (20271127000010): meetings,
--    follow_ups, scheduled_user_messages — mesmos predicados (follow_up
--    arquivado fora; follow_up espelho de reunião fora; mensagem só
--    scheduled/sending/sent).
-- 5. `unaccent` NÃO está instalada neste banco (medido, ver
--    20270812160000). A normalização é `normalize(NFD)` + remoção das marcas
--    combinantes (mesma técnica de `guided_normalize_message_search`), que
--    cobre qualquer acento, não só o português. Com os dois lados já em
--    minúsculas e sem acento, `LIKE` equivale a `ILIKE`.
--
-- ─── 🔴 Recorte de visibilidade (cópia fiel da `_scoped`) ────────────────────
-- `created_by` carrega DOIS espaços de id:
--   meeting           → meetings.created_by                 = auth.users.id
--   follow_up         → follow_ups.assigned_to              = team_members.id
--   scheduled_message → scheduled_user_messages.created_by  = team_members.id
-- O dono é normalizado para `team_members.id` (meeting resolve pela ponte
-- user_id + organization_id). Quem NÃO é admin da org e está com
-- `agenda.view_all` desligada vê: o que é seu + o que não tem dono + as
-- reuniões em que foi convidado (meeting_participants). O resto: tudo da org.

BEGIN;

-- ─── 1. Normalizador de busca ────────────────────────────────────────────────
-- `normalize(x, NFD)` é sintaxe especial do parser: não aceita prefixo de schema.
CREATE OR REPLACE FUNCTION public.agenda_search_fold(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path TO ''
AS $function$
  SELECT pg_catalog.translate(
           pg_catalog.lower(normalize(p_value, NFD)),
           U&'\0300\0301\0302\0303\0308\0327',
           '');
$function$;

REVOKE ALL     ON FUNCTION public.agenda_search_fold(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agenda_search_fold(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.agenda_search_fold(text) TO authenticated, service_role;

-- ─── 2. A busca ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_agenda_events(
  p_organization_id uuid,
  p_query           text,
  p_limit           integer DEFAULT 50
)
RETURNS TABLE(
  id                   uuid,
  source               text,
  title                text,
  description          text,
  start_at             timestamp with time zone,
  end_at               timestamp with time zone,
  all_day              boolean,
  event_type           text,
  status               text,
  lead_id              uuid,
  lead_name            text,
  lead_company         text,
  created_by           uuid,
  creator_name         text,
  location             text,
  meet_link            text,
  color                text,
  google_event_id      text,
  owner_team_member_id uuid
)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_me         uuid;
  v_scope_mine boolean;
  v_fold       text;
  v_pat        text;
  v_limit      integer;
  v_now        timestamp with time zone := now();
BEGIN
  -- Tenancy: idêntico à `_scoped`.
  IF p_organization_id IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_organization_id)
         AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- Termo: normalizado, aparado, mínimo de 2 caracteres, teto de 100. Termo
  -- curto demais devolve vazio (não erro): "a" casaria com a agenda inteira.
  v_fold := btrim(public.agenda_search_fold(left(COALESCE(p_query, ''), 100)));
  IF v_fold IS NULL OR char_length(v_fold) < 2 THEN
    RETURN;
  END IF;

  -- Escapa os curingas do LIKE: o usuário digitou "50%" ou "a_b", não um padrão.
  v_pat := '%' || replace(replace(replace(v_fold, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Limite duro: 1..100, qualquer que seja o que o cliente mandou.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  v_me := public.my_team_member_id(p_organization_id);

  -- `is_org_admin` antes de `has_feature_permission`: master e gestor de
  -- portfólio não têm linha em team_members (ver `_scoped`).
  v_scope_mine := NOT public.is_org_admin(p_organization_id)
              AND NOT COALESCE(
                    public.has_feature_permission('agenda.view_all', p_organization_id),
                    false);

  RETURN QUERY
  WITH m_hits AS (
    -- Source 1: meetings (sem janela)
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
      l.name    AS lead_name,
      l.company AS lead_company,
      m.created_by,
      tm.name   AS creator_name,
      m.location,
      m.meet_link,
      m.color,
      m.google_event_id,
      tm.id     AS owner_tm
    FROM public.meetings m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    -- `team_members.user_id` não é único (master = uma linha por org): o
    -- predicado de org evita o fanout que a base já corrigiu.
    LEFT JOIN public.team_members tm
      ON tm.user_id = m.created_by
     AND tm.organization_id = m.organization_id
    WHERE m.organization_id = p_organization_id
      AND (   public.agenda_search_fold(m.title)      LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l.name)       LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l.company)    LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l.erp_code)   LIKE v_pat ESCAPE '\')
      AND (   NOT v_scope_mine
           OR tm.id IS NULL
           OR (v_me IS NOT NULL AND tm.id = v_me)
           OR (v_me IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.meeting_participants mp
                  WHERE mp.meeting_id     = m.id
                    AND mp.team_member_id = v_me)))
    ORDER BY (m.start_at < v_now),
             CASE WHEN m.start_at >= v_now THEN extract(epoch FROM m.start_at)
                  ELSE -extract(epoch FROM m.start_at) END,
             m.id
    LIMIT v_limit
  ),
  f_hits AS (
    -- Source 2: follow_ups (não arquivados; espelho de reunião fora)
    SELECT
      fu.id,
      'follow_up'::text AS source,
      fu.title,
      fu.description,
      fu.due_date                          AS start_at,
      fu.due_date + interval '30 minutes'  AS end_at,
      false                                AS all_day,
      'follow_up'::text                    AS event_type,
      CASE WHEN fu.completed_at IS NOT NULL THEN 'completed' ELSE 'scheduled' END AS status,
      fu.lead_id,
      l2.name    AS lead_name,
      l2.company AS lead_company,
      fu.assigned_to AS created_by,
      tm2.name   AS creator_name,
      NULL::text AS location,
      NULL::text AS meet_link,
      NULL::text AS color,
      NULL::text AS google_event_id,
      fu.assigned_to AS owner_tm
    FROM public.follow_ups fu
    LEFT JOIN public.leads l2 ON l2.id = fu.lead_id
    LEFT JOIN public.team_members tm2 ON tm2.id = fu.assigned_to
    WHERE fu.organization_id = p_organization_id
      AND fu.archived_at IS NULL
      AND (fu.source_pipe IS DISTINCT FROM 'meeting' OR NOT EXISTS (
        SELECT 1 FROM public.meetings fm WHERE fm.organization_id = fu.organization_id
          AND fm.lead_id = fu.lead_id AND fm.start_at = fu.due_date AND fm.event_type = 'meeting'
      ))
      AND (   public.agenda_search_fold(fu.title)     LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l2.name)      LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l2.company)   LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l2.erp_code)  LIKE v_pat ESCAPE '\')
      AND (   NOT v_scope_mine
           OR fu.assigned_to IS NULL
           OR (v_me IS NOT NULL AND fu.assigned_to = v_me))
    ORDER BY (fu.due_date < v_now),
             CASE WHEN fu.due_date >= v_now THEN extract(epoch FROM fu.due_date)
                  ELSE -extract(epoch FROM fu.due_date) END,
             fu.id
    LIMIT v_limit
  ),
  s_hits AS (
    -- Source 3: scheduled_user_messages (scheduled/sending/sent)
    SELECT
      sm.id,
      'scheduled_message'::text AS source,
      COALESCE(LEFT(sm.message_content, 60), 'Mensagem agendada') AS title,
      sm.message_content                   AS description,
      sm.scheduled_at                      AS start_at,
      sm.scheduled_at + interval '5 minutes' AS end_at,
      false                                AS all_day,
      'task'::text                         AS event_type,
      sm.status,
      sm.lead_id,
      l3.name    AS lead_name,
      l3.company AS lead_company,
      sm.created_by,
      tm3.name   AS creator_name,
      NULL::text AS location,
      NULL::text AS meet_link,
      NULL::text AS color,
      NULL::text AS google_event_id,
      sm.created_by AS owner_tm
    FROM public.scheduled_user_messages sm
    LEFT JOIN public.leads l3 ON l3.id = sm.lead_id
    LEFT JOIN public.team_members tm3 ON tm3.id = sm.created_by
    WHERE sm.organization_id = p_organization_id
      AND sm.status IN ('scheduled', 'sending', 'sent')
      AND (   public.agenda_search_fold(COALESCE(LEFT(sm.message_content, 60), 'Mensagem agendada')) LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l3.name)      LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l3.company)   LIKE v_pat ESCAPE '\'
           OR public.agenda_search_fold(l3.erp_code)  LIKE v_pat ESCAPE '\')
      AND (   NOT v_scope_mine
           OR sm.created_by IS NULL
           OR (v_me IS NOT NULL AND sm.created_by = v_me))
    ORDER BY (sm.scheduled_at < v_now),
             CASE WHEN sm.scheduled_at >= v_now THEN extract(epoch FROM sm.scheduled_at)
                  ELSE -extract(epoch FROM sm.scheduled_at) END,
             sm.id
    LIMIT v_limit
  ),
  u AS (
    SELECT * FROM m_hits
    UNION ALL
    SELECT * FROM f_hits
    UNION ALL
    SELECT * FROM s_hits
  )
  SELECT u.id, u.source, u.title, u.description, u.start_at, u.end_at,
         u.all_day, u.event_type, u.status, u.lead_id, u.lead_name,
         u.lead_company, u.created_by, u.creator_name, u.location,
         u.meet_link, u.color, u.google_event_id,
         u.owner_tm
  FROM u
  -- Futuros primeiro (mais próximo antes), depois passados do mais recente.
  ORDER BY (u.start_at < v_now),
           CASE WHEN u.start_at >= v_now THEN extract(epoch FROM u.start_at)
                ELSE -extract(epoch FROM u.start_at) END,
           u.id
  LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.search_agenda_events(uuid, text, integer) IS
  'Busca global da Agenda, SEM janela de datas: título, nome/empresa/código ERP '
  'do lead, sem acento e sem caixa; curingas escapados; termo mínimo 2 '
  'caracteres; limite duro 100. Mesmo recorte de visibilidade de '
  'get_agenda_events_scoped (admin/agenda.view_all vê tudo; senão os meus + '
  'sem dono + convidado). SECURITY INVOKER: RLS por organização continua valendo.';

REVOKE ALL     ON FUNCTION public.search_agenda_events(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_agenda_events(uuid, text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.search_agenda_events(uuid, text, integer) TO authenticated, service_role;

-- ─── 3. Guardas ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.search_agenda_events(uuid, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar search_agenda_events';
  END IF;
  IF has_function_privilege('anon', 'public.agenda_search_fold(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon não pode executar agenda_search_fold';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.search_agenda_events(uuid, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated precisa executar search_agenda_events';
  END IF;
END;
$$;

COMMIT;
