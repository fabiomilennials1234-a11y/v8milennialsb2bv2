-- ════════════════════════════════════════════════════════════════════════════
-- private.whatsapp_readable_message_instance_ids(): expansão de chips em
-- conjunto, sem uma chamada por caixa
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026): toda leitura sob RLS de whatsapp_messages e de
-- whatsapp_conversation_summary paga um InitPlan desta função (policies
-- RESTRICTIVE `whatsapp_messages_instance_read_access` e
-- `whatsapp_conversation_summary_instance_read_access`): 31–54 ms e 1,4–2,2 k
-- buffers por statement na org de 60 caixas. O corpo chama
-- `whatsapp_chip_instance_ids(org, caixa)` UMA VEZ POR CAIXA — plpgsql DEFINER
-- que refaz o gate de org e chama `whatsapp_readable_instance_ids` DE NOVO para
-- a própria caixa: o N+1 que a lista multi já eliminou (20280117000000, item 1).
--
-- CORREÇÃO: mesma assinatura, mesmo SECURITY DEFINER, mesmo `search_path=''`,
-- mesmo resultado. `whatsapp_readable_instance_ids(org)` uma vez por org; a
-- regra de `whatsapp_chip_instance_ids` escrita uma vez, em conjunto:
--   * a caixa é membro de si mesma;
--   * se o número da caixa tem 10+ dígitos, os `instance_id` da
--     `whatsapp_instance_reap_queue` da MESMA org com os mesmos dígitos também.
-- Equivalência com o corpo antigo (por caixa legível, chamado com auth.uid()):
--   * o gate de org de chip_instance_ids passa (org vem de get_my_organization_ids);
--   * a releitura `p_instance = ANY(readable(org, [p_instance]))` é verdadeira
--     (a caixa veio de readable(org));
--   * dígitos nulos/curtos ⇒ {caixa}; senão {caixa} ∪ fila com os mesmos dígitos.
-- Prova: supabase/tests/readable_message_ids_set_based_test.sql (array novo ==
-- composição antiga com chip_instance_ids, por perfil).
--
-- BASE: corpo VIVO de prod (md5 bb799a1644570bd1698cb75ab9f3776b, 21/11/2026 =
-- repo). Pré-voo recusa outra base. Mesma assinatura ⇒ ACL preservada;
-- reafirmada no fim no estado de prod ({postgres, authenticated}).
--
-- Rollback: supabase/migrations/rollback/20280123000500_readable_message_instance_ids_set_based.sql

DO $preflight$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('private.whatsapp_readable_message_instance_ids()');
  IF v_md5 IS DISTINCT FROM 'bb799a1644570bd1698cb75ab9f3776b' THEN
    RAISE EXCEPTION 'pré-voo: private.whatsapp_readable_message_instance_ids diverge da base revisada (md5 %), abortado', v_md5;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION private.whatsapp_readable_message_instance_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH caixa AS (
    SELECT org.id AS org, box.id AS box
    FROM public.get_my_organization_ids() AS org(id)
    CROSS JOIN LATERAL unnest(public.whatsapp_readable_instance_ids(org.id)) AS box(id)
    WHERE auth.uid() IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT x.id), ARRAY[]::uuid[])
  FROM (
    SELECT c.box AS id FROM caixa c
    UNION
    SELECT q.instance_id
    FROM caixa c
    JOIN public.whatsapp_instances wi
      ON wi.id = c.box AND wi.organization_id = c.org
    JOIN public.whatsapp_instance_reap_queue q
      ON q.organization_id = c.org
     AND q.phone_number IS NOT NULL
     AND regexp_replace(q.phone_number, '[^0-9]', '', 'g')
       = regexp_replace(wi.phone_number, '[^0-9]', '', 'g')
    WHERE length(regexp_replace(wi.phone_number, '[^0-9]', '', 'g')) >= 10
  ) x;
$function$;

REVOKE ALL ON FUNCTION private.whatsapp_readable_message_instance_ids() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.whatsapp_readable_message_instance_ids() TO authenticated;
