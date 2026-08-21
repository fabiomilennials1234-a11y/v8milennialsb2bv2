-- 20270807120000_master_org_user_activity.sql
--
-- Atividade recente dos usuários, por organização, para a área Master.
-- Responde "quem está usando o sistema" na visão de frota, sem exigir
-- nenhuma mudança no cliente: o sinal já existe hoje em `auth.sessions`.
--
-- POR QUE UMA RPC (e não um select do front):
--   `auth.sessions` só tem GRANT para `postgres`. Nem `authenticated` nem
--   `service_role` conseguem ler a tabela — portanto nem query direta do
--   client nem edge function resolvem. SECURITY DEFINER (owner postgres) é
--   o único caminho. Precedente na casa: `get_activities` já faz
--   LEFT JOIN em auth.users pelo mesmo motivo.
--
-- POR QUE `updated_at` E NÃO `refreshed_at` (medido em prod, 2026-08-07):
--   - `refreshed_at` é NULL em 2.945 de 3.212 linhas (91,7%);
--   - nas 267 linhas em que existe, bate com `updated_at` em < 2s (267/267);
--   - `refreshed_at` é `timestamp WITHOUT time zone` (armadilha de fuso),
--     `updated_at` é `timestamptz`.
--   `updated_at` = created_at enquanto a sessão nunca refrescou, e passa a
--   ser o instante do último refresh depois disso. É exatamente
--   "última vez que esta sessão deu sinal de vida".
--
-- LIMITE CONHECIDO — RESOLUÇÃO DE ~1 HORA, NÃO DE MINUTOS:
--   `jwt_exp` do projeto é 3600s, então o token só é renovado a cada ~58min
--   enquanto a aba fica aberta. Medido em 2.355 intervalos de refresh: só
--   1,2% ficaram abaixo de 57min. Consequência: a janela de 5min mede ZERO
--   mesmo com gente trabalhando. A UI deve rotular como "ativo na última
--   hora", nunca como "online agora". Ver p_window_minutes DEFAULT 60.
--
-- Somente leitura. Não cria tabela, não cria coluna, não altera RLS de nada.

CREATE OR REPLACE FUNCTION public.master_org_user_activity(
  p_window_minutes integer DEFAULT 60
)
RETURNS TABLE (
  organization_id uuid,
  org_name text,
  org_subscription_status text,
  member_id uuid,
  user_id uuid,
  member_name text,
  member_email text,
  member_role text,
  is_master boolean,
  last_seen_at timestamptz,
  is_online boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_window integer := GREATEST(COALESCE(p_window_minutes, 60), 1);
BEGIN
  -- SECURITY DEFINER bypassa RLS: o gate tem que estar aqui dentro.
  --
  -- ⚠️ DE PROPÓSITO **NÃO** usa `is_master_user()`. Aquela função só checa
  -- `EXISTS em master_users AND is_active` — ela IGNORA a coluna `permissions`,
  -- então o perfil OUTBOUNDER (`{"all":false,"outbound_only":true}`) passaria e
  -- enxergaria os usuários da frota inteira. Isso contraria o resto do produto:
  -- MasterOrganizations filtra as orgs por `org_type` justamente para o
  -- outbounder não ver clientes que não são dele.
  --
  -- Aqui exigimos master PLENO (`permissions->>'all' = true`).
  IF NOT EXISTS (
    SELECT 1
    FROM public.master_users mu
    WHERE mu.user_id = auth.uid()
      AND mu.is_active = true
      AND COALESCE((mu.permissions ->> 'all')::boolean, false) = true
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH last_session AS (
    -- max(), nunca count(): sessões nunca são expurgadas (sessions_timebox=0),
    -- são 3.212 linhas para 149 usuários (~21 sessões por pessoa). Contar
    -- linhas mediria histórico de login, não presença.
    SELECT s.user_id AS uid, max(s.updated_at) AS seen
    FROM auth.sessions s   -- qualificado: search_path é só 'public'
    GROUP BY s.user_id
  )
  SELECT
    o.id,
    o.name,
    o.subscription_status,
    tm.id,
    tm.user_id,
    tm.name,
    tm.email,
    tm.role::text,
    EXISTS (
      SELECT 1 FROM public.master_users mu
      WHERE mu.user_id = tm.user_id AND mu.is_active
    ),
    ls.seen,
    COALESCE(ls.seen >= now() - make_interval(mins => v_window), false)
  FROM public.organizations o
  -- LEFT JOIN de propósito: org sem nenhum membro ativo precisa aparecer na
  -- lista (é justamente o caso que o Master quer enxergar). Essas linhas vêm
  -- com user_id/member_id NULL e o front as trata como "org sem membros".
  LEFT JOIN public.team_members tm
         ON tm.organization_id = o.id
        AND tm.is_active = true
  LEFT JOIN last_session ls
         ON ls.uid = tm.user_id
  ORDER BY o.name, ls.seen DESC NULLS LAST, tm.name;
END;
$$;

COMMENT ON FUNCTION public.master_org_user_activity(integer) IS
  'Master-only. Membros ativos por org + última sessão vista (auth.sessions.updated_at). '
  'Resolução ~1h por causa do jwt_exp=3600 — rotular como "ativo na última hora", não "online agora".';

ALTER FUNCTION public.master_org_user_activity(integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.master_org_user_activity(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.master_org_user_activity(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.master_org_user_activity(integer) TO authenticated;
