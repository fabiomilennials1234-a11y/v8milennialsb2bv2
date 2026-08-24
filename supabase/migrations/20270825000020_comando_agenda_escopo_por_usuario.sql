-- 20270825000020_comando_agenda_escopo_por_usuario.sql
--
-- "Próximas agendas" (aba Comando) passa a ser a agenda DO VENDEDOR.
--
-- ─── Por que uma função NOVA em vez de mexer na `get_agenda_events` ──────────
--
-- Duas razões, e a segunda é a que decide.
--
-- 1. `get_agenda_events` também serve a tela `/agenda`, que deve continuar
--    mostrando a operação inteira. Recortar dentro dela mudaria as duas telas;
--    o pedido foi explícito em não alterar o que funciona fora do escopo.
--
-- 2. 🚨 O CORPO DA `get_agenda_events` NO PROD NÃO É O QUE ESTÁ NO REPO.
--    O PROD tem CINCO fontes; o repo tem QUATRO. A quinta (`meeting_events`,
--    o funil mergeado — ADR-0004/ADR-0007) foi aplicada à mão em 2026-07-30 e
--    a migration `20270730000000_agenda_meeting_events_source.sql` ficou presa
--    na worktree `wt-funis-main`, sem nunca entrar no repo (conferido em
--    2026-08-24: `grep -rl "meeting_event'::text" supabase/` não devolve nada).
--
--    Consequência: um `CREATE OR REPLACE FUNCTION get_agenda_events` escrito a
--    partir do arquivo do repo APAGARIA a Source 5 do PROD — e com ela as 836
--    reuniões do funil mergeado voltariam a sumir da Agenda, que é exatamente
--    o bug que aquele fix consertou. Compor por cima é imune a isso: se a
--    função base mudar de novo, esta acompanha sozinha.
--
-- ─── A regra, em uma frase ───────────────────────────────────────────────────
--
--   "vejo o que é MEU + o que não é de NINGUÉM; nunca o de OUTRO."
--
-- O "+ o que não é de ninguém" é medição, não generosidade. No PROD, em
-- 2026-08-24: 279 de 458 reuniões de confirmação (61%) e 235 de 1.100
-- follow-ups (21%) não têm responsável. Recortar só por "é meu" apagaria a
-- maior parte da agenda de todo vendedor. E compromisso sem dono não é "dado
-- de outro usuário", que é o que o pedido manda proteger.
--
-- ─── 🔴 A armadilha: `created_by` carrega DOIS espaços de id ─────────────────
--
-- A `get_agenda_events` projeta pessoas de fontes diferentes na MESMA coluna:
--
--   | source             | coluna de origem                  | id é de…      |
--   |--------------------|-----------------------------------|---------------|
--   | meeting            | meetings.created_by               | auth.users.id |
--   | follow_up          | follow_ups.assigned_to            | team_members  |
--   | scheduled_message  | scheduled_user_messages.created_by| team_members  |
--   | pipe_confirmacao   | closer_id, com sdr_id de reserva  | team_members  |
--   | meeting_event      | meeting_events.pre_sale_resp._id  | team_members  |
--
-- Provado pelos JOINs da própria função no PROD: a Source 1 casa
-- `tm.user_id = m.created_by`, as outras casam `tm.id = <coluna>`.
--
-- Comparar `created_by` contra um único id devolveria resultado
-- SILENCIOSAMENTE ERRADO — some a agenda de uma das pontas sem erro nenhum.
-- Por isso o `CASE` abaixo normaliza tudo para `team_members.id` usando o
-- `source` como discriminante, e é ESSA coluna normalizada que filtra e que a
-- tela mostra.

CREATE OR REPLACE FUNCTION public.get_comando_agenda_events(
  p_organization_id uuid,
  p_start           timestamp with time zone,
  p_end             timestamp with time zone
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
  -- Coluna nova: o dono normalizado para o espaco de `team_members.id`,
  -- qualquer que seja a fonte. E a unica coluna segura para comparar pessoa.
  owner_team_member_id uuid
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_me         uuid;
  v_uid        uuid := auth.uid();
  v_scope_mine boolean;
BEGIN
  -- Tenancy: a funcao base e SECURITY INVOKER e as policies das 5 fontes sao
  -- todas por organizacao, entao o isolamento entre orgs continua sendo o do
  -- RLS. Este gate so devolve erro cedo e legivel em vez de lista vazia.
  IF p_organization_id IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_organization_id)
         AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_me := public.my_team_member_id(p_organization_id);

  -- Admin e master veem tudo. `v_me` e NULL para master (sem linha real em
  -- team_members), e por isso o recorte NUNCA pode ligar para ele -- filtrar
  -- por um id inexistente devolveria agenda vazia em vez de agenda completa.
  v_scope_mine := NOT public.is_org_admin(p_organization_id);

  RETURN QUERY
  WITH base AS (
    SELECT e.*,
           CASE
             -- Source 1 e a unica em espaco de auth.users: resolve pela ponte.
             WHEN e.source = 'meeting' THEN (
               SELECT tm.id FROM public.team_members tm
               WHERE tm.user_id         = e.created_by
                 AND tm.organization_id = p_organization_id
               LIMIT 1
             )
             -- As outras 4 ja vem em team_members.id.
             ELSE e.created_by
           END AS owner_tm
    FROM public.get_agenda_events(p_organization_id, p_start, p_end) e
  )
  SELECT b.id, b.source, b.title, b.description, b.start_at, b.end_at,
         b.all_day, b.event_type, b.status, b.lead_id, b.lead_name,
         b.lead_company, b.created_by, b.creator_name, b.location,
         b.meet_link, b.color, b.google_event_id,
         b.owner_tm
  FROM base b
  WHERE NOT v_scope_mine
     -- "e meu"                     OU     "nao e de ninguem"
     OR b.owner_tm = v_me           OR     b.owner_tm IS NULL
  ORDER BY b.start_at ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) IS
  'Agenda do card "Proximas agendas" do Comando. Compoe sobre get_agenda_events '
  '(nao a substitui — /agenda segue vendo a org inteira) e recorta por usuario '
  'para nao-admin. Normaliza o dono para team_members.id, porque created_by '
  'mistura auth.users.id (source=meeting) com team_members.id (as outras 4).';

REVOKE ALL     ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_comando_agenda_events(uuid, timestamptz, timestamptz) TO authenticated, service_role;
