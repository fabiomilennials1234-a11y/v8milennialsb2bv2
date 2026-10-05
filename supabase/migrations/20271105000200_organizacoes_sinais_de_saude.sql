-- Organizações (Área Dev): os sinais de saúde de cada org numa chamada só.
-- Regras OR-6 (org em risco) e OR-7 (uso acima de 90% de um limite) do board
-- "Área Dev: 18 telas → 5 centrais".
--
-- O banco devolve FATOS (último login, uso, chip, chamados, limite); a nota de
-- saúde é calculada no front (`lib/org-health.ts`), testada e com os pesos à
-- vista. Nota guardada no banco envelhece e ninguém sabe de onde veio.
--
-- Último login exclui sessões de master: o suporte entrando na org não é o
-- cliente usando o produto.
--
-- Escopo: master pleno vê a frota; o outbounder vê só orgs `outbound` — a
-- mesma regra que a lista de Organizações já aplica na tela.
BEGIN;

CREATE OR REPLACE FUNCTION public.master_org_health_signals()
RETURNS TABLE (
  organization_id       uuid,
  members_active        integer,
  last_login_at         timestamptz,
  active_users_7d       integer,
  events_7d             bigint,
  whatsapp_instances    integer,
  whatsapp_connected    integer,
  open_tickets          integer,
  reopen_alert_tickets  integer,
  quota_max_ratio       numeric,
  quota_max_resource    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_full boolean;
BEGIN
  SELECT COALESCE((mu.permissions ->> 'all')::boolean, false) INTO v_full
    FROM public.master_users mu
   WHERE mu.user_id = auth.uid() AND mu.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH orgs AS (
    SELECT o.id FROM public.organizations o
     WHERE NOT o.is_sandbox AND (v_full OR o.org_type = 'outbound')
  ),
  masters AS (
    SELECT mu.user_id FROM public.master_users mu WHERE mu.is_active
  ),
  membros AS (
    SELECT tm.organization_id, tm.user_id
      FROM public.team_members tm
     WHERE tm.is_active AND tm.organization_id IN (SELECT id FROM orgs)
       AND tm.user_id NOT IN (SELECT user_id FROM masters)
  ),
  sessoes AS (
    -- max(), nunca count(): sessões não são expurgadas (ver master_org_user_activity).
    SELECT s.user_id, max(s.updated_at) AS seen
      FROM auth.sessions s
     WHERE s.user_id IN (SELECT user_id FROM membros)
     GROUP BY s.user_id
  ),
  login AS (
    SELECT m.organization_id,
           count(*)::int AS members_active,
           max(se.seen) AS last_login_at,
           (count(*) FILTER (WHERE se.seen > now() - interval '7 days'))::int AS active_users_7d
      FROM membros m LEFT JOIN sessoes se ON se.user_id = m.user_id
     GROUP BY m.organization_id
  ),
  uso AS (
    SELECT u.organization_id, count(*) AS events_7d
      FROM public.usage_events u
     WHERE u.created_at > now() - interval '7 days' AND u.organization_id IN (SELECT id FROM orgs)
     GROUP BY u.organization_id
  ),
  chips AS (
    SELECT w.organization_id,
           count(*)::int AS total,
           (count(*) FILTER (WHERE w.status = 'connected' AND w.session_dead_since IS NULL))::int AS conectados
      FROM public.whatsapp_instances w
     WHERE w.organization_id IN (SELECT id FROM orgs)
     GROUP BY w.organization_id
  ),
  chamados AS (
    SELECT t.organization_id,
           (count(*) FILTER (WHERE t.status <> 'fechado'))::int AS abertos,
           (count(*) FILTER (WHERE t.status <> 'fechado' AND t.reopen_count >= 3))::int AS reabertos
      FROM public.support_tickets t
     WHERE t.organization_id IN (SELECT id FROM orgs)
     GROUP BY t.organization_id
  ),
  -- O mesmo uso que `admin_get_org_quota_summary` conta, por recurso limitado.
  uso_quota AS (
    SELECT q.organization_id, q.resource_key,
           CASE q.resource_key
             WHEN 'max_whatsapp_instances' THEN COALESCE(c.total, 0)
             WHEN 'max_users' THEN COALESCE(l.members_active, 0)
             WHEN 'max_copilot_agents' THEN (
               SELECT count(*) FROM public.copilot_agents ca WHERE ca.organization_id = q.organization_id)
           END::numeric / NULLIF(q.effective_limit, 0) AS ratio
      FROM public.org_quotas q
      LEFT JOIN chips c ON c.organization_id = q.organization_id
      LEFT JOIN login l ON l.organization_id = q.organization_id
     WHERE q.organization_id IN (SELECT id FROM orgs)
       AND q.effective_limit > 0  -- -1 = ilimitado
  ),
  pior_quota AS (
    SELECT DISTINCT ON (uq.organization_id) uq.organization_id, uq.ratio, uq.resource_key
      FROM uso_quota uq
     WHERE uq.ratio IS NOT NULL
     ORDER BY uq.organization_id, uq.ratio DESC
  )
  SELECT o.id,
         COALESCE(l.members_active, 0),
         l.last_login_at,
         COALESCE(l.active_users_7d, 0),
         COALESCE(u.events_7d, 0),
         COALESCE(c.total, 0),
         COALESCE(c.conectados, 0),
         COALESCE(ch.abertos, 0),
         COALESCE(ch.reabertos, 0),
         round(pq.ratio, 3),
         pq.resource_key
    FROM orgs o
    LEFT JOIN login l ON l.organization_id = o.id
    LEFT JOIN uso u ON u.organization_id = o.id
    LEFT JOIN chips c ON c.organization_id = o.id
    LEFT JOIN chamados ch ON ch.organization_id = o.id
    LEFT JOIN pior_quota pq ON pq.organization_id = o.id;
END;
$$;

COMMENT ON FUNCTION public.master_org_health_signals() IS
  'Area Dev > Organizacoes: fatos de saude por org (login, uso 7d, chip, chamados, pior quota). '
  'A nota e calculada no front (lib/org-health.ts). Master pleno ve a frota; outbounder so orgs outbound.';

REVOKE ALL ON FUNCTION public.master_org_health_signals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_org_health_signals() TO authenticated;

COMMIT;
