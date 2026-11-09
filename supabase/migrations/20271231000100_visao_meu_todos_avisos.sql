-- 20271231000100_visao_meu_todos_avisos.sql
--
-- Visão MEU / TODOS (hotfix Café Jurerê, 09/11).
--
-- O admin da org com organizations.feature_flags.visao_meu_todos = true alterna,
-- em Leads, Funis e no sino, entre "Meus" (o que é dele) e "Todos" (a org).
-- Leads e Funis reaproveitam o filtro de dono que já existe (puro front). O sino
-- não: o Aviso é linha POR DESTINATÁRIO e a RLS de notifications só entrega a
-- linha do próprio usuário (notifications_select_own). "Todos" precisa de uma
-- leitura da org inteira, e é esta função.
--
-- Contrato:
--   - Só leitura. Não marca nada como lido — o lido continua sendo de quem recebeu.
--   - Gate: usuário autenticado, admin ativo da org (ou master), org não
--     bloqueada, e a flag ligada na org. Org vem por parâmetro, então o gate é
--     sobre ESSE parâmetro (vetor clássico de DEFINER com org por parâmetro).
--   - Paridade com a RLS de leitura que o próprio admin já tem:
--       * lead_message só da instância de WhatsApp que ele pode ver e do escopo
--         de chat dele (notifications_whatsapp_scope);
--       * strict_lead_owner_access (notifications strict_owner_related_select).
--     A visão geral mostra o que o admin veria se fosse o destinatário — nada além.
--   - Um evento que avisou N pessoas tem N linhas com o mesmo group_key; aqui
--     vira UMA, com os destinatários agregados. Não lido = alguém ainda não leu.
--   - Janela de 14 dias pelo índice idx_notifications_org_created; teto de 100.
--
-- Pós-apply (conferir grants):
--   SELECT r, has_function_privilege(r, 'public.avisos_visao_geral(uuid,integer)', 'EXECUTE')
--     FROM unnest(ARRAY['anon','authenticated','service_role']) r;
--   Esperado: anon=f, authenticated=t, service_role=f.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.avisos_visao_geral(uuid, integer);
--   UPDATE public.organizations SET feature_flags = feature_flags - 'visao_meu_todos'
--    WHERE id = '4922638c-4909-494e-ba10-12282ec0b161';

BEGIN;

CREATE OR REPLACE FUNCTION public.avisos_visao_geral(
  p_organization_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  user_id uuid,
  type text,
  title text,
  description text,
  link text,
  lead_id uuid,
  entity_id uuid,
  group_key text,
  event_count integer,
  last_event_at timestamptz,
  created_at timestamptz,
  read_at timestamptz,
  destinatarios text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_master boolean := COALESCE(public.is_master_user(), false);
  v_instancias uuid[];
  v_orgs_estritas uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'avisos_visao_geral: não autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_org_admin(p_organization_id)
     OR (NOT v_master AND public.org_access_blocked(p_organization_id))
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations o
       WHERE o.id = p_organization_id
         AND o.feature_flags @> '{"visao_meu_todos": true}'::jsonb
     )
  THEN
    RAISE EXCEPTION 'avisos_visao_geral: sem permissão' USING ERRCODE = '42501';
  END IF;

  -- private.strict_lead_* existe só em prod (drift repo↔prod conhecido). Em
  -- banco sem o rollout strict-owner (replay do repo, branch, PGlite) a paridade
  -- com strict_owner_related_select não tem como ser garantida: falha fechada.
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL
     OR to_regprocedure('private.strict_lead_is_owned(uuid,uuid)') IS NULL
     OR to_regprocedure('private.whatsapp_notification_instance_ids()') IS NULL
  THEN
    RAISE EXCEPTION 'avisos_visao_geral: autorização de leitura indisponível neste banco' USING ERRCODE = '42501';
  END IF;

  v_instancias := private.whatsapp_notification_instance_ids();
  v_orgs_estritas := private.strict_lead_member_orgs();

  RETURN QUERY
  WITH visiveis AS (
    SELECT n.*, COALESCE(n.group_key, n.id::text) AS grupo
    FROM public.notifications n
    WHERE n.organization_id = p_organization_id
      AND n.created_at > now() - interval '14 days'
      AND (
        n.type <> 'lead_message'
        OR v_master
        OR (
          n.whatsapp_instance_id = ANY (v_instancias)
          AND public.can_see_chat_scope(n.organization_id, n.lead_id, n.whatsapp_phone)
        )
      )
      AND (
        NOT (n.organization_id = ANY (v_orgs_estritas))
        OR private.strict_lead_is_owned(n.organization_id, n.lead_id)
      )
  ),
  agregados AS (
    SELECT
      v.grupo,
      max(v.event_count) AS event_count,
      CASE WHEN bool_or(v.read_at IS NULL) THEN NULL ELSE max(v.read_at) END AS read_at,
      array_agg(DISTINCT COALESCE(tm.name, 'Usuário removido')) AS destinatarios
    FROM visiveis v
    LEFT JOIN public.team_members tm
      ON tm.user_id = v.user_id AND tm.organization_id = v.organization_id
    GROUP BY v.grupo
  ),
  representantes AS (
    SELECT DISTINCT ON (v.grupo) v.*
    FROM visiveis v
    ORDER BY v.grupo, v.last_event_at DESC NULLS LAST, v.created_at DESC
  )
  SELECT
    r.id, r.organization_id, r.user_id, r.type, r.title, r.description, r.link,
    r.lead_id, r.entity_id, r.group_key,
    a.event_count, r.last_event_at, r.created_at, a.read_at, a.destinatarios
  FROM representantes r
  JOIN agregados a ON a.grupo = r.grupo
  ORDER BY COALESCE(r.last_event_at, r.created_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.avisos_visao_geral(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.avisos_visao_geral(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.avisos_visao_geral(uuid, integer) IS
  'Sino em visão TODOS (flag visao_meu_todos): avisos da org deduplicados por group_key, só leitura. Gate: admin ativo/master + flag + org não bloqueada. Paridade com RLS de chat e strict_lead_owner.';

-- Liga a visão para a Café Jurerê (único piloto).
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"visao_meu_todos": true}'::jsonb
 WHERE id = '4922638c-4909-494e-ba10-12282ec0b161'
   AND slug = 'cafejurere';

NOTIFY pgrst, 'reload schema';

COMMIT;
