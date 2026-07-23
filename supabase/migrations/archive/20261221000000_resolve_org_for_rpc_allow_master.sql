-- 20261221000000_resolve_org_for_rpc_allow_master.sql
--
-- Fix: os RPCs de analytics (get_sales_cycle_analysis "Jornada do lead",
-- get_win_loss_analysis, get_uf_heatmap, get_leads_by_uf, get_next_best_actions)
-- resolvem a org via resolve_org_for_rpc(p_org_id), que só reconhece o usuário
-- quando ele existe em team_members da org. Um MASTER visualizando uma org da
-- qual NÃO é membro recebia NULL -> os widgets de analytics vinham vazios
-- ("Sem movimentações suficientes..."), mesmo com o resto do dashboard populado
-- (que usa RLS por organization_id, e não membership).
--
-- Correção (aditiva e segura): se o usuário autenticado é master, retorna a org
-- pedida mesmo sem membership. Master já enxerga qualquer org via RLS no resto
-- do app — isto apenas alinha os RPCs de analytics a esse mesmo comportamento.
-- Nenhum acesso novo é concedido a quem não é master.

CREATE OR REPLACE FUNCTION public.resolve_org_for_rpc(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v uuid;
BEGIN
  IF p_org_id IS NOT NULL THEN
    -- Membro da org pedida?
    SELECT tm.organization_id INTO v FROM team_members tm
    WHERE tm.user_id = auth.uid() AND tm.organization_id = p_org_id LIMIT 1;
    IF v IS NOT NULL THEN RETURN v; END IF;
    -- Master pode visualizar qualquer org (consistente com o RLS do resto do app).
    IF public.is_master_user() THEN RETURN p_org_id; END IF;
    RETURN NULL;
  END IF;
  -- Sem org pedida: cai na primeira org do usuário (comportamento original).
  SELECT tm.organization_id INTO v FROM team_members tm
  WHERE tm.user_id = auth.uid() LIMIT 1;
  RETURN v;
END; $function$;
