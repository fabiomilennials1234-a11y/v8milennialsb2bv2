-- ============================================================================
-- `api_update_deal` e `api_list_lead_deals`. (#1772)
--
-- ── REABRIR NEGÓCIO FECHADO É RECUSADO AQUI, NÃO NO HANDLER ───────────────
-- Sair da situação de ganho é o que dispara `sale_reversed`, que é irreversível
-- (decisão G do CTO). Uma guarda no handler protegeria só quem passa pelo
-- handler; no banco, protege também o dia em que alguém chamar a RPC de outro
-- lugar — que é exatamente como caminhos alternativos nascem.
--
-- ── O QUE ESTE PATCH NÃO FAZ: LIMPAR CAMPO ────────────────────────────────
-- Campo omitido e campo enviado como null são a MESMA coisa aqui (`coalesce`
-- mantém o valor atual). Consequência declarada: não há como apagar o título ou
-- zerar o valor por esta rota.
--
-- É limitação consciente, não descuido. Distinguir "não informei" de "quero
-- apagar" exige um sinalizador por campo, e ninguém pediu limpar campo ainda —
-- construir o mecanismo antes do caso é como se acumula superfície que nunca é
-- usada. Quando aparecer, entra como `p_set_*` por campo.
--
-- ── DEFINER COM ORG POR PARÂMETRO ─────────────────────────────────────────
-- Mesma forma e mesmo cuidado das outras: recorte explícito no corpo, e nem
-- `anon` nem `authenticated` com EXECUTE.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.api_update_deal(
  p_org         uuid,
  p_deal_id     uuid,
  p_title       text    DEFAULT NULL,
  p_value       numeric DEFAULT NULL,
  p_owner_id    uuid    DEFAULT NULL,
  p_notes       text    DEFAULT NULL,
  p_status      text    DEFAULT NULL,
  p_loss_reason text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.deals%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.deals
   WHERE id = p_deal_id AND organization_id = p_org AND deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Inexistente e alheio são o mesmo erro de propósito: distinguir
    -- confirmaria ao chamador que aquele id existe em alguma organização.
    RAISE EXCEPTION 'Negócio % não encontrado nesta organização.', p_deal_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── A guarda que motiva esta função existir no banco ──────────────────────
  IF p_status = 'open' AND v_row.closed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Negócio fechado não reabre por esta porta. Reverter venda dispara sale_reversed, que é irreversível.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('open','won','lost') THEN
    RAISE EXCEPTION 'Situação inválida: %. Válidas: open, won, lost.', p_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = p_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence a esta organização.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.deals d
     SET title       = coalesce(p_title, d.title),
         value       = coalesce(p_value, d.value),
         owner_id    = coalesce(p_owner_id, d.owner_id),
         notes       = coalesce(p_notes, d.notes),
         won         = CASE WHEN p_status = 'won' THEN true
                            WHEN p_status = 'lost' THEN false
                            ELSE d.won END,
         closed_at   = CASE WHEN p_status IN ('won','lost') THEN coalesce(d.closed_at, now())
                            ELSE d.closed_at END,
         loss_reason = CASE WHEN p_status = 'lost' THEN p_loss_reason
                            ELSE d.loss_reason END
   WHERE d.id = p_deal_id
  RETURNING * INTO v_row;

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

CREATE OR REPLACE FUNCTION public.api_list_lead_deals(
  p_org     uuid,
  p_lead_id uuid
)
 RETURNS TABLE (
   id uuid, last_activity_at timestamptz, created_at timestamptz,
   title text, value numeric, source text,
   won boolean, closed_at timestamptz, loss_reason text,
   owner_id uuid, source_lead_id uuid,
   pipeline_slug text, stage_key text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT d.id, d.last_activity_at, d.created_at,
         d.title, d.value, d.source,
         d.won, d.closed_at, d.loss_reason,
         d.owner_id, d.source_lead_id,
         pip.slug AS pipeline_slug, pe.stage_key
    FROM public.deals d
    LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
    LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
   WHERE d.organization_id = p_org
     AND d.source_lead_id = p_lead_id
     AND d.deleted_at IS NULL
   -- Abertos primeiro: é a ordem em que o vendedor lê. Depois, os fechados do
   -- mais recente para o mais antigo, que é o histórico de compras.
   ORDER BY (d.closed_at IS NOT NULL), d.last_activity_at DESC, d.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.api_update_deal(uuid, uuid, text, numeric, uuid, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_update_deal(uuid, uuid, text, numeric, uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.api_list_lead_deals(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_lead_deals(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.api_update_deal(uuid, uuid, text, numeric, uuid, text, text, text) IS
  'PATCH /api/v1/deals/{id}. Título, valor, dono, notas e fechamento com motivo. '
  'NÃO move: posição tem rota própria. Recusa reabrir Negócio fechado — sair da '
  'situação de ganho dispara sale_reversed, que é irreversível.';

COMMENT ON FUNCTION public.api_list_lead_deals(uuid, uuid) IS
  'GET /api/v1/leads/{id}/deals. Abertos primeiro, cada um com a própria posição. '
  'É por esta lista que a recompra fica legível de fora (ADR-0023 decisão 2).';

DO $do$
DECLARE v_aberto int;
BEGIN
  SELECT count(*) INTO v_aberto
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('api_update_deal','api_list_lead_deals')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_aberto > 0 THEN
    RAISE EXCEPTION 'FAIL: % função(ões) do #1772 abertas para anon ou authenticated.', v_aberto;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_update_deal e api_list_lead_deals criadas, só service_role executa.';
END$do$;

COMMIT;
