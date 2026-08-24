-- ============================================================================
-- `api_move_deal` — POST /deals/{id}/move. (#1770)
--
-- ── CASCA FINA SOBRE `mover_negocio` ──────────────────────────────────────
-- A porta de movimentação já existe e já garante o que importa: mover é MOVER,
-- não copiar (ADR-0023 decisão 4), e destino em funil customizado é recusado.
-- Esta função resolve o que o handler não sabe e delega:
--
--   • o identificador da POSIÇÃO a partir do identificador do NEGÓCIO — a API
--     fala de Negócio, `mover_negocio` fala de card;
--   • o identificador do FUNIL a partir do slug — a API fala 'propostas', a
--     função de banco quer o uuid.
--
-- Reimplementar o move aqui daria duas semânticas de mover no mesmo sistema, e a
-- que a tela usa é a outra.
--
-- ── DEFINER COM ORG POR PARÂMETRO ─────────────────────────────────────────
-- Mesma forma das outras funções da API, e mesmo cuidado: recorte explícito
-- ANTES de qualquer coisa, e nem `anon` nem `authenticated` com EXECUTE.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.api_move_deal(
  p_org      uuid,
  p_deal_id  uuid,
  p_pipeline text,
  p_stage    text,
  p_owner_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry_id    uuid;
  v_pipeline_id uuid;
BEGIN
  -- ── Recorte por inquilino, antes de tudo ──────────────────────────────────
  -- A API roda como service_role: RLS não protege este caminho.
  IF NOT EXISTS (
    SELECT 1 FROM public.deals d
     WHERE d.id = p_deal_id AND d.organization_id = p_org AND d.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Negócio % não encontrado nesta organização.', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Funil customizado: recusa ANTES de resolver ──────────────────────────
  -- A função de banco também recusa, mas a mensagem dela fala de card e de
  -- tabela. Esta fala de Negócio e de histórico, que é o que quem integra
  -- precisa entender para decidir o que fazer.
  IF p_pipeline LIKE 'custom:%' THEN
    RAISE EXCEPTION
      'Mover para funil customizado não é suportado: o card mudaria de identidade e perderia o histórico.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT pip.id INTO v_pipeline_id
    FROM public.pipelines pip
   WHERE pip.organization_id = p_org
     AND pip.slug = p_pipeline
     AND pip.type = 'system'
   LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Funil de sistema % não existe nesta organização.', p_pipeline
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── A posição do Negócio ─────────────────────────────────────────────────
  -- O índice único sobre `deal_id` garante que existe no máximo UMA. Se não
  -- existe nenhuma, o Negócio está órfão — 11.710 assim em produção — e mover
  -- não é a operação certa: não há o que mover.
  SELECT pe.id INTO v_entry_id
    FROM public.pipeline_entries pe
   WHERE pe.deal_id = p_deal_id;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION
      'Negócio % não tem posição em nenhum funil — não há o que mover.', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.mover_negocio(v_entry_id, v_pipeline_id, p_stage, NULL, p_owner_id);

  RETURN (SELECT to_jsonb(t) FROM (
    SELECT d.id, d.last_activity_at, d.created_at,
           d.title, d.value, d.source,
           d.won, d.closed_at, d.loss_reason,
           d.owner_id, d.source_lead_id,
           pip.slug AS pipeline_slug, pe.stage_key
      FROM public.deals d
      LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
      LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
     WHERE d.id = p_deal_id
     LIMIT 1
  ) t);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_move_deal(uuid, uuid, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_move_deal(uuid, uuid, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.api_move_deal(uuid, uuid, text, text, uuid) IS
  'POST /api/v1/deals/{id}/move. Casca fina sobre `mover_negocio`: resolve a '
  'posição a partir do Negócio e o funil a partir do slug, e delega. Mover é '
  'MOVER — nenhum card novo nasce (ADR-0023 decisão 4). Destino em funil '
  'customizado é recusado: o card mudaria de identidade e perderia o histórico.';

DO $do$
DECLARE v_aberto int;
BEGIN
  SELECT count(*) INTO v_aberto
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'api_move_deal'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_aberto > 0 THEN
    RAISE EXCEPTION 'FAIL: api_move_deal aberta para anon ou authenticated.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_move_deal criada, só service_role executa.';
END$do$;

COMMIT;
