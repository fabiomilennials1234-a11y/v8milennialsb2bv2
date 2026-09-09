-- 20270914000000_agenda_de_todos_por_permissao.sql
--
-- A Agenda passa a ser da OPERAÇÃO por padrão, e o recorte "só as minhas"
-- vira PERMISSÃO — não mais consequência de não ser admin.
--
-- ─── O que existe hoje, medido ───────────────────────────────────────────────
--
-- 1. `get_agenda_events` é org-wide de propósito (o COMMENT dela diz isso desde
--    a 20270907000020). Ela nunca recortou por pessoa.
-- 2. Quem recorta é o FRONT: `AgendaAtividades.tsx` calcula
--    `seesEveryone = identityReady && isAdmin` e filtra a lista já carregada.
--    Duas consequências:
--      a) todo não-admin perde a agenda da operação, sem que nenhum admin tenha
--         escolhido isso — a regra é o cargo, não uma política;
--      b) o dado do colega ATRAVESSA a rede e é descartado no navegador. Filtro
--         de tela não é fronteira; quem abrir o devtools vê tudo.
--
-- ─── O que esta migration faz ────────────────────────────────────────────────
--
-- - Cria a chave de catálogo `agenda.view_all`, default **true**: a agenda
--   inteira passa a ser o padrão para todo mundo. Desligar a chave (por membro
--   em `member_feature_permissions`, ou por org em
--   `organization_feature_defaults`) devolve a pessoa a "só os meus".
-- - Cria `get_agenda_events_scoped`, que aplica esse recorte NO BANCO. O front
--   continua filtrando (rótulo, evento do Google, caminho degradado), mas
--   agora existe uma fronteira real embaixo dele.
--
-- ─── Por que uma função nova, e não `CREATE OR REPLACE` na base ──────────────
--
-- Mesma razão de `get_comando_agenda_events` (ver o cabeçalho de
-- 20270825000020): o corpo da `get_agenda_events` no PROD já divergiu do repo
-- mais de uma vez, e reescrevê-la a partir do arquivo apagaria fonte viva.
-- Compor por cima acompanha a base sozinha — se ela ganhar uma sexta fonte,
-- este recorte já a cobre.
--
-- ─── 🔴 `created_by` carrega DOIS espaços de id ──────────────────────────────
--
--   | source            | coluna de origem                   | o id é de…       |
--   |-------------------|------------------------------------|------------------|
--   | meeting           | meetings.created_by                | auth.users.id    |
--   | follow_up         | follow_ups.assigned_to             | team_members.id  |
--   | scheduled_message | scheduled_user_messages.created_by | team_members.id  |
--   | pipe_confirmacao  | COALESCE(closer_id, sdr_id)        | team_members.id  |  -- metric-lint-allow: linha de DOCUMENTAÇÃO, não SQL — descreve a coluna de origem da Source 4; o SQL real já tem o allow em 20270831000020:234
--   | meeting_event     | meeting_events.pre_sale_resp._id   | team_members.id  |
--
-- Comparar a coluna crua contra um id só devolve resultado SILENCIOSAMENTE
-- errado — some metade da agenda sem erro nenhum. O `CASE` normaliza tudo para
-- `team_members.id` usando `source` como discriminante, como já faz o Comando.
--
-- ─── As três portas do recorte, e por que cada uma existe ────────────────────
--
-- 1. **É meu** — dono normalizado igual ao meu `team_members.id`.
-- 2. **Não é de ninguém** — `owner_tm IS NULL`. Não é generosidade: em
--    2026-08-24, 61% das reuniões de confirmação e 21% dos follow-ups do PROD
--    não tinham responsável, e `follow_ups.assigned_to` é nulável na própria
--    UI. Esconder o órfão apagaria da agenda da pessoa o compromisso que ELA
--    criou. Compromisso de ninguém também não é "dado de outro usuário".
-- 3. **Fui convidado / eu marquei** — `meeting_participants` (a reunião marcada
--    PARA a pessoa não aparece em `created_by`) e `pipe_confirmacao.sdr_id`
--    (quando closer e SDR estão preenchidos, o COALESCE dá o crédito ao closer
--    e a SDR perde a reunião que ela marcou). É a mesma regra que
--    `useMyAgendaOwnership` já aplica no cliente — aqui ela vira servidor.

-- ─── 1. A chave de catálogo ──────────────────────────────────────────────────
-- ON CONFLICT DO UPDATE, e não DO NOTHING: é o que a 20270818120000 estabeleceu
-- depois de a divergência entre prod e ambiente novo sobreviver por meses a uma
-- seed idempotente que não corrigia nada.
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('agenda.view_all', 'Agenda', 'Ver agenda de todos',
   'Vê os compromissos de todos os membros na Agenda. Se desabilitado, vê apenas os próprios (e os que não têm responsável).',
   false, true, 15)
ON CONFLICT (key) DO UPDATE SET
  module        = EXCLUDED.module,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  is_admin_only = EXCLUDED.is_admin_only,
  default_value = EXCLUDED.default_value,
  sort_order    = EXCLUDED.sort_order;

-- ─── 2. O recorte, no banco ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_agenda_events_scoped(
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
  -- O dono normalizado para o espaço de `team_members.id`, qualquer que seja a
  -- fonte. É a única coluna segura para comparar pessoa.
  owner_team_member_id uuid
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_me         uuid;
  v_scope_mine boolean;
BEGIN
  -- Tenancy: a função base é SECURITY INVOKER e as policies das 5 fontes são
  -- todas por organização, então o isolamento entre orgs continua sendo o do
  -- RLS. Este gate só devolve erro cedo e legível em vez de lista vazia.
  IF p_organization_id IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_organization_id)
         AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_me := public.my_team_member_id(p_organization_id);

  -- `is_org_admin` primeiro, e não só `has_feature_permission`: master e gestor
  -- de portfólio NÃO têm linha em `team_members`, e `has_feature_permission`
  -- devolve `false` para quem não tem linha. Sem este OR, quem opera a org de
  -- fora cairia no recorte com `v_me = NULL` e veria só os órfãos.
  v_scope_mine := NOT public.is_org_admin(p_organization_id)
              AND NOT COALESCE(
                    public.has_feature_permission('agenda.view_all', p_organization_id),
                    false);

  RETURN QUERY
  WITH base AS (
    SELECT e.*,
           CASE
             -- Source 1 é a única em espaço de auth.users: resolve pela ponte.
             WHEN e.source = 'meeting' THEN (
               SELECT tm.id FROM public.team_members tm
               WHERE tm.user_id         = e.created_by
                 AND tm.organization_id = p_organization_id
               LIMIT 1
             )
             -- As outras 4 já vêm em team_members.id.
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
     -- é meu
     OR (v_me IS NOT NULL AND b.owner_tm = v_me)
     -- não é de ninguém
     OR b.owner_tm IS NULL
     -- fui convidado para a reunião
     OR (b.source = 'meeting' AND v_me IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.meeting_participants mp
           WHERE mp.meeting_id     = b.id
             AND mp.team_member_id = v_me))
     -- eu marquei, mas o COALESCE deu o crédito ao closer
     OR (b.source = 'pipe_confirmacao' AND v_me IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.pipe_confirmacao pc
           WHERE pc.id     = b.id
             AND pc.sdr_id = v_me))
  ORDER BY b.start_at ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_agenda_events_scoped(uuid, timestamptz, timestamptz) IS
  'Agenda da tela /agenda. Compõe sobre get_agenda_events (não a substitui) e '
  'devolve a org inteira por padrão. Recorta para "os meus + os órfãos + os que '
  'me convidaram" apenas para quem NÃO é admin da org e está com a permissão '
  '`agenda.view_all` desligada. Normaliza o dono para team_members.id, porque '
  'created_by mistura auth.users.id (source=meeting) com team_members.id (as outras 4).';

REVOKE ALL     ON FUNCTION public.get_agenda_events_scoped(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_agenda_events_scoped(uuid, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_agenda_events_scoped(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ─── 3. Guardas ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_default boolean;
  v_admin_only boolean;
BEGIN
  SELECT fp.default_value, fp.is_admin_only INTO v_default, v_admin_only
  FROM public.feature_permissions fp WHERE fp.key = 'agenda.view_all';

  IF v_default IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'agenda.view_all precisa nascer LIGADA — o pedido é "a agenda mostra todos por padrão"';
  END IF;

  IF v_admin_only IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'agenda.view_all admin-only devolveria false para todo membro e o recorte viraria o padrão de novo';
  END IF;

  -- A permissão só vale se o resolvedor a enxergar; `has_feature_permission`
  -- devolve `false` para chave ausente do catálogo (IF NOT FOUND).
  IF NOT EXISTS (SELECT 1 FROM public.feature_permissions WHERE key = 'agenda.view_all') THEN
    RAISE EXCEPTION 'catálogo sem agenda.view_all';
  END IF;
END;
$$;
