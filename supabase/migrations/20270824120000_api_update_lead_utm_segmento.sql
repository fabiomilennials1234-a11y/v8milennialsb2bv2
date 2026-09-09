-- ============================================================================
-- `PATCH /leads/{id}` passa a gravar segmento, faturamento e os cinco UTM.
--
-- POR QUE: são COLUNAS de `leads`, não campos personalizados. Medido em 90 dias
-- de produção: 5.181 leads com `utm_campaign`, 2.846 com `utm_source`, 9.987 com
-- `segment`, 2.272 com `faturamento` — e essas colunas são lidas por 11 arquivos
-- do front e 3 funções do banco.
--
-- Isto é pré-requisito da migração dos ~93 cenários do Make. O módulo antigo
-- (`lead-webhook`) grava esses campos; a API v1 não gravava. Migrar antes disto
-- seria perder UTM em 30 cenários, segmento em 13 — sem erro nenhum aparecendo,
-- porque o PATCH respondia 200 e simplesmente ignorava as chaves desconhecidas.
--
-- A allowlist mora em DOIS lugares e os dois precisam concordar: `TEXT_FIELDS`
-- no roteador (`leads-write.ts`) decide o que sai do corpo da requisição, e o
-- `UPDATE ... CASE` aqui decide o que chega na tabela. Atualizar só o primeiro
-- foi o que fez o teste contra produção responder 200 com a coluna intacta.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_update_lead(p_org uuid, p_lead_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE rf text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  FOREACH rf IN ARRAY ARRAY['responsible_id','sdr_id','closer_id','pre_sale_responsible_id','sale_responsible_id'] LOOP
    IF p_patch ? rf AND NULLIF(p_patch->>rf, '') IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM team_members WHERE id = (p_patch->>rf)::uuid AND organization_id = p_org) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_responsible', 'field', rf);
      END IF;
    END IF;
  END LOOP;
  UPDATE leads SET
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
    company = CASE WHEN p_patch ? 'company' THEN p_patch->>'company' ELSE company END,
    email = CASE WHEN p_patch ? 'email' THEN p_patch->>'email' ELSE email END,
    phone = CASE WHEN p_patch ? 'phone' THEN p_patch->>'phone' ELSE phone END,
    notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END,
    -- Novos: o que o lead-webhook já gravava e a API v1 ignorava.
    segment = CASE WHEN p_patch ? 'segment' THEN p_patch->>'segment' ELSE segment END,
    faturamento = CASE WHEN p_patch ? 'faturamento' THEN p_patch->>'faturamento' ELSE faturamento END,
    utm_source = CASE WHEN p_patch ? 'utm_source' THEN p_patch->>'utm_source' ELSE utm_source END,
    utm_medium = CASE WHEN p_patch ? 'utm_medium' THEN p_patch->>'utm_medium' ELSE utm_medium END,
    utm_campaign = CASE WHEN p_patch ? 'utm_campaign' THEN p_patch->>'utm_campaign' ELSE utm_campaign END,
    utm_content = CASE WHEN p_patch ? 'utm_content' THEN p_patch->>'utm_content' ELSE utm_content END,
    utm_term = CASE WHEN p_patch ? 'utm_term' THEN p_patch->>'utm_term' ELSE utm_term END,
    rating = CASE WHEN p_patch ? 'rating' THEN (p_patch->>'rating')::int ELSE rating END,
    qualification_score = CASE WHEN p_patch ? 'qualification_score' THEN (p_patch->>'qualification_score')::int ELSE qualification_score END,
    qualification_tier = CASE WHEN p_patch ? 'qualification_tier' THEN (p_patch->>'qualification_tier')::qualification_tier ELSE qualification_tier END,
    pre_qualification_tier = CASE WHEN p_patch ? 'pre_qualification_tier' THEN (p_patch->>'pre_qualification_tier')::qualification_tier ELSE pre_qualification_tier END,
    responsible_id = CASE WHEN p_patch ? 'responsible_id' THEN NULLIF(p_patch->>'responsible_id','')::uuid ELSE responsible_id END,
    sdr_id = CASE WHEN p_patch ? 'sdr_id' THEN NULLIF(p_patch->>'sdr_id','')::uuid ELSE sdr_id END,
    closer_id = CASE WHEN p_patch ? 'closer_id' THEN NULLIF(p_patch->>'closer_id','')::uuid ELSE closer_id END,
    pre_sale_responsible_id = CASE WHEN p_patch ? 'pre_sale_responsible_id' THEN NULLIF(p_patch->>'pre_sale_responsible_id','')::uuid ELSE pre_sale_responsible_id END,
    sale_responsible_id = CASE WHEN p_patch ? 'sale_responsible_id' THEN NULLIF(p_patch->>'sale_responsible_id','')::uuid ELSE sale_responsible_id END,
    updated_at = now()
  WHERE id = p_lead_id AND organization_id = p_org;
  RETURN jsonb_build_object('ok', true, 'lead', public.api_get_lead(p_org, p_lead_id));
END;
$$;

COMMENT ON FUNCTION public.api_update_lead(uuid, uuid, jsonb) IS
  'PATCH /api/v1/leads/{id}. Grava também segment, faturamento e utm_* — colunas que o lead-webhook já preenchia e que a API ignorava em silêncio.';
