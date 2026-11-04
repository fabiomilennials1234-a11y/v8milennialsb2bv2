-- ============================================================================
-- `PATCH /api/v1/deals/{id}` com `status` passa a gravar o desfecho canônico.
--
-- ── O DEFEITO ─────────────────────────────────────────────────────────────
-- Desde 03/09 o desfecho do Negócio mora em `deals.outcome` (a tela, o caderno
-- de vendas e a etapa de ganho leem dali). `api_update_deal` continuou gravando
-- só as colunas antigas `won`/`closed_at`. Resultado: integração que dava ganho
-- pela API recebia 200, o banco ficava com `won = true` e `outcome = 'open'`, e
-- na tela o card seguia aberto, sem venda no caderno. Silencioso.
--
-- Medido em 27/10: 2 Negócios em toda a base nesse estado, ambos da Sorvfoods
-- (integração ERP → ganho via n8n).
--
-- ── A CORREÇÃO ────────────────────────────────────────────────────────────
-- `status` vira escrita de `outcome` (+ `outcome_source = 'api'`). As colunas
-- antigas deixam de ser escritas aqui: `trg_deals_espelha_outcome` deriva
-- `won`/`closed_at`/`outcome_at` do `outcome`, e os gatilhos AFTER UPDATE OF
-- outcome registram a venda no caderno e levam o card para a etapa de ganho.
-- Valor e desfecho vão no MESMO UPDATE: `fn_exige_valor_no_negocio` é BEFORE
-- UPDATE OF outcome e enxerga o valor novo.
--
-- ── FECHADO NÃO MUDA DE LADO ──────────────────────────────────────────────
-- Antes, `lost` sobre um ganho virava a coluna `won` sem cerimônia. Agora:
--   - mesmo desfecho → idempotente (nada muda, nada vai ao caderno);
--   - desfecho diferente sobre negócio fechado → recusado, como já era reabrir.
-- Trocar ganho por perda é estorno de venda, e estorno não nasce de PATCH.
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
  v_row     public.deals%ROWTYPE;
  v_fechado boolean;
  v_novo    text;
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

  IF p_status IS NOT NULL AND p_status NOT IN ('open','won','lost') THEN
    RAISE EXCEPTION 'Situação inválida: %. Válidas: open, won, lost.', p_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Fechado = desfecho canônico decidido. `closed_at` entra para cobrir linha
  -- legada (won/closed_at gravados antes desta correção, outcome ainda 'open'):
  -- ela não reabre, mas pode receber o desfecho que já declarava.
  v_fechado := v_row.outcome IS DISTINCT FROM 'open' OR v_row.closed_at IS NOT NULL;

  -- ── A guarda que motiva esta função existir no banco ──────────────────────
  IF p_status = 'open' AND v_fechado THEN
    RAISE EXCEPTION
      'Negócio fechado não reabre por esta porta. Reverter venda dispara sale_reversed, que é irreversível.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_status IN ('won','lost')
     AND v_row.outcome IS DISTINCT FROM 'open'
     AND v_row.outcome IS DISTINCT FROM p_status THEN
    RAISE EXCEPTION
      'Negócio já fechado como %. Trocar o desfecho é estorno e não se faz por esta porta.', v_row.outcome
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = p_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence a esta organização.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Só escreve desfecho quando ele MUDA. Repetir o mesmo seria inócuo para o
  -- espelho, mas é a transição que alimenta o caderno — e repetir não transita.
  v_novo := CASE WHEN p_status IN ('won','lost') AND v_row.outcome IS DISTINCT FROM p_status
                 THEN p_status END;

  UPDATE public.deals d
     SET title          = coalesce(p_title, d.title),
         value          = coalesce(p_value, d.value),
         owner_id       = coalesce(p_owner_id, d.owner_id),
         notes          = coalesce(p_notes, d.notes),
         outcome        = coalesce(v_novo, d.outcome),
         outcome_source = CASE WHEN v_novo IS NOT NULL THEN 'api' ELSE d.outcome_source END,
         loss_reason    = CASE WHEN v_novo = 'lost' THEN p_loss_reason
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

-- CREATE OR REPLACE preserva os grants; reafirmados para a migration valer sozinha.
REVOKE ALL ON FUNCTION public.api_update_deal(uuid, uuid, text, numeric, uuid, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_update_deal(uuid, uuid, text, numeric, uuid, text, text, text) TO service_role;

-- ── Reparo: os ganhos que a versão antiga gravou só pela metade ───────────
-- `outcome_at` recebe o `closed_at` original para o caderno datar a venda no
-- dia em que ela aconteceu, não no dia do reparo.
UPDATE public.deals
   SET outcome        = 'won',
       outcome_source = 'api',
       outcome_at     = closed_at
 WHERE deleted_at IS NULL
   AND outcome = 'open'
   AND won IS TRUE
   AND closed_at >= '2026-09-03';

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.deals
   WHERE deleted_at IS NULL AND outcome = 'open' AND won IS TRUE AND closed_at >= '2026-09-03';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FAIL: % negócio(s) ainda com won=true e outcome=open.', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.api_update_deal(uuid,uuid,text,numeric,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.api_update_deal(uuid,uuid,text,numeric,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated com EXECUTE em api_update_deal.';
  END IF;
END$$;

COMMIT;
