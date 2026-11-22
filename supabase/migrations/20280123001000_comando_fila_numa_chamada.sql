-- ════════════════════════════════════════════════════════════════════════════
-- Comando: a fila "Clientes aguardando resposta" numa chamada, com o lead
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026): o card do Comando faz TRÊS idas em SÉRIE —
-- caixas do usuário → get_conversations_awaiting_human_reply_multi → leads
-- (nome/dono para as linhas sem push_name/dono) — ~150–300 ms de rede a mais
-- antes do card pintar, além do custo do banco.
--
-- CORREÇÃO: `get_comando_fila` resolve as caixas NO SERVIDOR
-- (`whatsapp_readable_instance_ids`, DEFINER com gate de org) e devolve as
-- linhas da _multi, NA MESMA ORDEM, mais `lead_name` e `lead_owner_id`
-- (COALESCE pre_sale → sale → sdr → closer, a ordem do predicado de
-- isolamento da _multi e do front).
--
-- POR QUE SECURITY INVOKER (decisão do orquestrador, CONTESTADO vs DEFINER):
-- o nome do lead sai de `public.leads` SOB A RLS DO USUÁRIO (8 policies,
-- sector_scope, strict_owner). DEFINER leria a tabela sem as policies e
-- entregaria nome de lead que o usuário não vê. Lead invisível ⇒ lead_name e
-- lead_owner_id NULL, exatamente o que o `select` do front devolvia. A fila em
-- si continua vindo da _multi (DEFINER, que já recorta por responsável/strict).
-- Nenhuma relação private.* no corpo (um INVOKER chamando private.* quebra quem
-- não tem EXECUTE; ver 20280112000000).
--
-- CONTRATO: (p_org, p_instances DEFAULT NULL, p_limit DEFAULT 30,
-- p_window_days DEFAULT 7 — os defaults da _multi de prod).
--   p_instances NULL = as caixas legíveis do usuário FORA de status 'error' — o
--   MESMO conjunto que o card mandava (useWhatsAppInstancesForUser filtra
--   `status <> 'error'`, lido sob a RLS de whatsapp_instances, como aqui).
--   p_instances dado = interseção com as legíveis (status não filtra: quem
--   escolhe a caixa decide).
-- Caixas vazias ⇒ nada (a _multi trata array vazio como "todas").
--
-- GRANTS: authenticated. service_role não (nenhum caller de servidor;
-- assert_org_access deixa service_role passar sem org).
--
-- Rollback: supabase/migrations/rollback/20280123001000_comando_fila_numa_chamada.sql

CREATE OR REPLACE FUNCTION public.get_comando_fila(
  p_org uuid,
  p_instances uuid[] DEFAULT NULL::uuid[],
  p_limit integer DEFAULT 30,
  p_window_days integer DEFAULT 7
)
 RETURNS TABLE(
   instance_id uuid, phone_number text, normalized_phone text, push_name text, lead_id uuid,
   conversation_id uuid, last_client_message text, last_client_message_at timestamp with time zone,
   ai_replied boolean, ai_replied_at timestamp with time zone, waiting_total integer,
   owner_team_member_id uuid, owner_name text, lead_name text, lead_owner_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
  v_inst uuid[];
BEGIN
  PERFORM public.assert_org_access(p_org);

  v_inst := public.whatsapp_readable_instance_ids(p_org, p_instances);
  IF p_instances IS NULL OR cardinality(p_instances) = 0 THEN
    v_inst := ARRAY(
      SELECT wi.id FROM public.whatsapp_instances wi
       WHERE wi.id = ANY(v_inst)
         AND wi.organization_id = p_org
         AND wi.status <> 'error'
       ORDER BY wi.id);
  END IF;
  IF v_inst IS NULL OR cardinality(v_inst) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.instance_id, a.phone_number, a.normalized_phone, a.push_name, a.lead_id,
         a.conversation_id, a.last_client_message, a.last_client_message_at,
         a.ai_replied, a.ai_replied_at, a.waiting_total,
         a.owner_team_member_id, a.owner_name,
         l.name,
         COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)
    FROM public.get_conversations_awaiting_human_reply_multi(p_org, v_inst, p_limit, p_window_days)
         WITH ORDINALITY AS a(instance_id, phone_number, normalized_phone, push_name, lead_id,
                              conversation_id, last_client_message, last_client_message_at,
                              ai_replied, ai_replied_at, waiting_total,
                              owner_team_member_id, owner_name, ord)
    LEFT JOIN public.leads l
      ON l.id = a.lead_id
     AND l.organization_id = p_org
   ORDER BY a.ord;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_comando_fila(uuid, uuid[], integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_comando_fila(uuid, uuid[], integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
