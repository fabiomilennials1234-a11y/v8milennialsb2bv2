-- ROLLBACK de 20270915000000_voip_can_see_call_por_dono_canonico.sql
--
-- Devolve `voip_can_see_call` à definição anterior (20270730000000), que lê as
-- colunas LEGADAS de responsável. OR REPLACE pelo mesmo motivo da ida: DROP
-- resetaria os grants para PUBLIC/anon.
--
-- Reverter isto SEM reverter o código de `_shared/voip/call-plane.ts` deixa a
-- escrita (autorizar chamada) por visibilidade canônica e a leitura por dono
-- legado — a mesma assimetria que a migration fecha. Reverter de verdade é
-- reverter os dois lados.

CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT public.can_see_lead_by_permissions(l.sdr_id, l.closer_id)
         FROM public.leads l
        WHERE l.id = p_lead_id),
      false)
  END
$function$;

COMMENT ON FUNCTION public.voip_can_see_call(uuid) IS
  'Fronteira do lead para linhas de chamada. lead_id nulo (número desconhecido '
  'ligando) é visível para a org inteira, por decisão de produto: a chamada tem '
  'que ser atendível por quem está de plantão.';
