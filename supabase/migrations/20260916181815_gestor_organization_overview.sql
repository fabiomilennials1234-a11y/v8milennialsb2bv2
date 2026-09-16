-- Hub do gestor: acesso próprio, sempre limitado aos vínculos do login.
-- Não altera master_users, permissões do master, RLS ou acesso operacional.
-- Implementação privada para agregar presença sem expor user_presence.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.gestor_organization_overview()
RETURNS TABLE (
  organization_id uuid, name text, slug text,
  leads_last_7_days bigint, sales_last_7_days bigint,
  online_users jsonb, measured_at timestamptz, access_blocked boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_gestor_id uuid;
  v_now timestamptz := now();
BEGIN
  SELECT g.id INTO v_gestor_id FROM public.gestores g
  WHERE g.user_id = (SELECT auth.uid()) AND g.is_active;
  IF v_gestor_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH bound AS MATERIALIZED (
    SELECT org.id, org.name, org.slug, public.org_access_blocked(org.id) AS blocked
    FROM public.gestor_organizations go
    JOIN public.organizations org ON org.id = go.organization_id
    WHERE go.gestor_id = v_gestor_id
  )
  SELECT o.id, o.name, o.slug,
    CASE WHEN NOT o.blocked THEN (SELECT count(*) FROM public.leads l
     WHERE l.organization_id = o.id
       AND l.created_at >= v_now - interval '168 hours' AND l.created_at <= v_now
       AND l.deleted_at IS NULL AND l.is_shadow IS NOT TRUE) END,
    CASE WHEN NOT o.blocked THEN (SELECT count(*) FROM public.sale_events s
     WHERE s.organization_id = o.id AND s.event_type = 'sale'
       AND s.sold_at >= v_now - interval '168 hours' AND s.sold_at <= v_now
       AND NOT EXISTS (
         SELECT 1 FROM public.sale_events r
         WHERE r.organization_id = o.id AND r.event_type = 'sale_reversed'
           AND r.reversed_event_id = s.id
       )) END,
    CASE WHEN NOT o.blocked THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', u.name) ORDER BY u.name, u.user_id)
      FROM (
        -- Uma pessoa conta uma vez, mesmo com várias abas ou memberships.
        SELECT tm.user_id, min(tm.name) AS name
        FROM public.team_members tm
        JOIN public.user_presence p ON p.user_id = tm.user_id AND p.organization_id = tm.organization_id
        WHERE tm.organization_id = o.id AND tm.is_active
          AND p.last_seen_at >= v_now - interval '2 minutes' AND p.last_seen_at <= v_now
        GROUP BY tm.user_id
      ) u
    ), '[]'::jsonb) ELSE '[]'::jsonb END, v_now, o.blocked
  FROM bound o
  ORDER BY o.name, o.id;
END;
$$;

REVOKE ALL ON FUNCTION private.gestor_organization_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.gestor_organization_overview() TO authenticated;

-- Sem argumentos de usuário/org: o navegador não escolhe o escopo da consulta.
CREATE OR REPLACE FUNCTION public.gestor_organization_overview()
RETURNS TABLE (
  organization_id uuid, name text, slug text,
  leads_last_7_days bigint, sales_last_7_days bigint,
  online_users jsonb, measured_at timestamptz, access_blocked boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM private.gestor_organization_overview(); $$;

REVOKE ALL ON FUNCTION public.gestor_organization_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gestor_organization_overview() TO authenticated;

COMMENT ON FUNCTION public.gestor_organization_overview() IS
  'Gestor ativo: somente organizações vinculadas; leads criados e vendas líquidas de estornos nas últimas 168h; membros ativos com aba visível nos últimos 2min. Orgs bloqueadas retornam somente identidade, sem indicadores/presença. Não concede acesso master.';
