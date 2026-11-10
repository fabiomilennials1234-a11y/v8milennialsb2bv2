-- 20280104000500_localizar_negocio_no_funil.sql
--
-- "Ir para o negócio" (chat da Café Jurerê, 10/11): o board precisa do card de
-- UM negócio sem carregar a coluna página por página. ADITIVA: só cria uma
-- função; nada existente muda.
--
-- ── O problema ───────────────────────────────────────────────────────────
-- A coluna pagina de 20 em 20 pelo cursor composto (created_at, id) —
-- get_pipeline_page, 20271230000100. Numa etapa de 1.618 negócios (ENVASE
-- "novo", prod 09/11), o alvo pode estar na página 45. A ficha do lead no chat
-- manda o board até ele; o board precisa da linha DELE, no formato da coluna, e
-- saber se o recorte ativo (filtros, "Meus") o esconde.
--
-- ── A função ─────────────────────────────────────────────────────────────
-- 1. LOCALIZA o negócio sob a RLS de quem chama (SECURITY INVOKER) e pelos
--    mesmos portões da coluna: funil (pipelines), card (pipeline_entries) e
--    lead (leads). 0 linhas = a coluna nunca mostraria este card (inexistente,
--    outra org, funil ou card ocultos, lead oculto — "só os meus" incluso).
-- 2. Quem decide se ele está no recorte é o PRÓPRIO get_pipeline_page — nenhuma
--    cópia do filtro nem da projeção (as irmãs 20271231000000 e 20280101000000
--    copiam; esta não precisa, e não deriva quando o filtro da coluna mudar).
--    Página de 1 com o cursor posicionado logo acima do card, na ordem da
--    coluna (created_at DESC, id DESC):
--      cursor = (created_at do card, id da vizinha imediata ACIMA dele no mesmo
--               instante — a menor id maior que a do card, sob a mesma RLS)
--    Sem vizinha acima (o card tem a maior id do grupo), o cursor usa o maior
--    uuid possível. Nada que a coluna mostraria fica entre o cursor e o card:
--    a 1ª linha da página é o card ⇔ ele passa no recorte.
--    Grupo empatado = import em lote, dezenas de negócios no mesmo now().
-- 3. Visível: devolve a linha da coluna (as 12 colunas) + visivel_no_recorte =
--    true. Escondido pelo recorte: só a localização (id, funil, lead, etapa,
--    created_at) + false — nada que a pessoa já não leia direto na tabela.
--
-- Os filtros são os que o board manda (`sharedRpcFilterParams` no front) — os
-- NOMES dos parâmetros espelham os do get_pipeline_page (o pgTAP trava isso).
-- Rating/calor: aposentados, o board não manda.
--
-- Custo: a página de 1 varre a coluna do topo até o card (o OR do cursor não
-- vira condição de índice com plano genérico). Uma chamada por navegação, não
-- por evento: o front só relê o foco quando o evento é do card focado.
--
-- SECURITY INVOKER: a RLS do usuário decide, igual à coluna — fica fora da
-- população do INV-6 e herda as RESTRICTIVE que só existem em prod.
-- `assert_org_access` recusa cedo quem não é da org.
--
-- ORDEM DE DEPLOY: 1) merge do front — com a flag desligada nada muda para
-- ninguém (o chat não mostra o botão e o board ignora ?negocio=); 2) esta
-- migration; 3) conferir o objeto e a linha do ledger; 4) a flag
-- chat_ir_para_negocio na Café Jurerê. Flag ligada sem a função: o board abre
-- o funil, mostra um aviso de erro e não chega ao card.
--
-- ROLLBACK: supabase/migrations/rollback/20280104000500_localizar_negocio_no_funil.sql

CREATE OR REPLACE FUNCTION public.localizar_negocio_no_funil(
  p_entry_id uuid,
  p_org_id uuid,
  p_search text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_origins text[] DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_meeting_after timestamptz DEFAULT NULL,
  p_meeting_before timestamptz DEFAULT NULL,
  p_period_after timestamptz DEFAULT NULL,
  p_period_before timestamptz DEFAULT NULL,
  p_closed_status_keys text[] DEFAULT NULL,
  p_updated_before timestamptz DEFAULT NULL,
  p_overdue_exclude_status_keys text[] DEFAULT NULL,
  p_status_keys text[] DEFAULT NULL,
  p_scheduled boolean DEFAULT NULL,
  p_qualification_tier text[] DEFAULT NULL,
  p_pre_qualification_tier text[] DEFAULT NULL,
  p_stalled_min_days integer DEFAULT NULL,
  p_stalled_max_days integer DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  pipeline_id uuid,
  lead_id uuid,
  stage_key text,
  assigned_to uuid,
  notes text,
  metadata jsonb,
  entered_at timestamptz,
  stage_changed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  lead jsonb,
  visivel_no_recorte boolean
)
LANGUAGE plpgsql
-- STABLE é requisito de correção: o passo 2 e a página leem o MESMO snapshot.
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_stage_key text;
  v_created_at timestamptz;
  v_lead_id uuid;
  v_vizinha_acima uuid;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_entry_id IS NULL THEN
    RETURN;
  END IF;

  -- 1. Os portões da coluna, sob a RLS de quem chama: funil, card, lead.
  SELECT pe.pipeline_id, pe.stage_key, pe.created_at, pe.lead_id
    INTO v_pipeline_id, v_stage_key, v_created_at, v_lead_id
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.organization_id = p_org_id
    JOIN public.leads l ON l.id = pe.lead_id
   WHERE pe.id = p_entry_id
     AND pe.organization_id = p_org_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. A vizinha imediata ACIMA na ordem da coluna, no mesmo instante. (Não
  --    existe min(uuid): ORDER BY + LIMIT 1.)
  SELECT pe.id
    INTO v_vizinha_acima
    FROM public.pipeline_entries pe
   WHERE pe.pipeline_id = v_pipeline_id
     AND pe.stage_key = v_stage_key
     AND pe.created_at = v_created_at
     AND pe.lead_id IS NOT NULL
     AND pe.organization_id = p_org_id
     AND pe.id > p_entry_id
   ORDER BY pe.id
   LIMIT 1;

  -- 3. Página de 1 logo depois da vizinha: a 1ª linha é o card ⇔ ele passa no
  --    recorte. Todos os argumentos nomeados (o 1º posicional é o slug).
  RETURN QUERY
  SELECT g.id, g.pipeline_id, g.lead_id, g.stage_key, g.assigned_to, g.notes,
         g.metadata, g.entered_at, g.stage_changed_at, g.created_at, g.updated_at,
         g.lead, true
    FROM public.get_pipeline_page(
           p_org_id => p_org_id,
           p_pipeline_id => v_pipeline_id,
           p_stage_id => v_stage_key,
           p_page_size => 1,
           p_cursor => v_created_at,
           p_cursor_id => COALESCE(v_vizinha_acima, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
           p_search => p_search,
           p_responsible_id => p_responsible_id,
           p_tag_ids => p_tag_ids,
           p_origins => p_origins,
           p_urgency => p_urgency,
           p_product_type => p_product_type,
           p_meeting_after => p_meeting_after,
           p_meeting_before => p_meeting_before,
           p_period_after => p_period_after,
           p_period_before => p_period_before,
           p_closed_status_keys => p_closed_status_keys,
           p_updated_before => p_updated_before,
           p_overdue_exclude_status_keys => p_overdue_exclude_status_keys,
           p_status_keys => p_status_keys,
           p_scheduled => p_scheduled,
           p_qualification_tier => p_qualification_tier,
           p_pre_qualification_tier => p_pre_qualification_tier,
           p_stalled_min_days => p_stalled_min_days,
           p_stalled_max_days => p_stalled_max_days
         ) AS g
   WHERE g.id = p_entry_id;
  IF FOUND THEN
    RETURN;
  END IF;

  -- 4. A pessoa vê o negócio, mas o recorte do board o esconde.
  RETURN QUERY
  SELECT p_entry_id, v_pipeline_id, v_lead_id, v_stage_key, NULL::uuid, NULL::text,
         NULL::jsonb, NULL::timestamptz, NULL::timestamptz, v_created_at, NULL::timestamptz,
         NULL::jsonb, false;
END;
$function$;

COMMENT ON FUNCTION public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) IS
  'Ir para o negocio: a linha de UM negocio no formato da coluna (get_pipeline_page, pagina de 1 posicionada no card) + se o recorte do board o mostra. 0 linhas = a coluna nunca mostraria o card. SECURITY INVOKER de proposito: a RLS do usuario decide, igual a coluna. Os nomes dos filtros espelham os do get_pipeline_page.';

REVOKE ALL ON FUNCTION public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) TO service_role;

-- Travas: INVOKER (DEFINER furaria "só os meus") e anon sem EXECUTE.
DO $verify$
DECLARE
  v_fn regprocedure := 'public.localizar_negocio_no_funil(uuid, uuid, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer)'::regprocedure;
BEGIN
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
    RAISE EXCEPTION 'localizar_negocio_no_funil precisa ser SECURITY INVOKER';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'localizar_negocio_no_funil não pode ser executável por anon';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
