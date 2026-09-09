-- ============================================================================
-- Criar campo personalizado pela API, e gravar valor criando o campo que falta.
--
-- Duas funções, para dois momentos distintos:
--
--   `api_create_custom_field`  — cria a DEFINIÇÃO do campo. É o que faltava:
--     havia `GET /custom-fields` e `PUT /leads/{id}/custom-fields`, mas a única
--     porta para cadastrar um campo novo era a tela do CRM. Quem integrava
--     descobria pelo 422 `unknown_field`, sem saber o que fazer a respeito.
--
--   `api_set_custom_fields_creating`  — grava os valores criando, como `text`,
--     os campos que ainda não existem. Existe porque o caminho real do
--     integrador é o inverso do nosso: ele tem os dados na mão (a resposta de um
--     formulário) e descobre no envio que o campo não estava cadastrado. Sem
--     isto, ele precisaria parar o cenário, abrir o CRM, criar o campo e voltar.
--
-- ── DUPLICADO É POR NOME, IGNORANDO CAIXA ─────────────────────────────────
-- O UNIQUE do banco é `(organization_id, field_name)` — sensível a maiúsculas,
-- então "Faturamento" e "faturamento" conviveriam como campos diferentes, e a
-- tela mostraria os dois. Ambas as funções comparam com `lower(btrim(...))` e
-- devolvem o campo que já existe em vez de criar o gêmeo. É a diferença entre
-- uma organização com um campo e uma organização com quatro grafias dele.
--
-- ── POR QUE `text` NO CAMINHO AUTOMÁTICO ──────────────────────────────────
-- Adivinhar o tipo pelo primeiro valor recebido erra: "1000" vira número e o
-- próximo lead que mandar "mais de 1000" quebra. `text` aceita tudo e é o
-- default da coluna. Quem quer tipo certo usa `api_create_custom_field`, onde
-- declara o tipo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.api_create_custom_field(
  p_org uuid,
  p_field_name text,
  p_field_type text DEFAULT 'text',
  p_field_options jsonb DEFAULT NULL,
  p_is_required boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text := btrim(COALESCE(p_field_name, ''));
  v_tipo text := COALESCE(NULLIF(btrim(COALESCE(p_field_type, '')), ''), 'text');
  v_existente record;
  v_id uuid;
BEGIN
  IF v_nome = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_name',
      'message', 'field_name é obrigatório');
  END IF;

  IF v_tipo NOT IN ('text', 'number', 'date', 'select', 'boolean') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_type',
      'message', 'field_type inválido. Válidos: text, number, date, select, boolean');
  END IF;

  -- Campo de lista sem opções seria um seletor vazio na tela.
  IF v_tipo = 'select' AND (p_field_options IS NULL OR jsonb_array_length(COALESCE(p_field_options, '[]'::jsonb)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'options_required',
      'message', 'field_type "select" exige field_options com ao menos uma opção');
  END IF;

  SELECT id, field_name, field_type INTO v_existente
  FROM public.lead_custom_fields
  WHERE organization_id = p_org AND lower(btrim(field_name)) = lower(v_nome)
  LIMIT 1;

  IF FOUND THEN
    -- Já existe: devolve o que existe em vez de criar um gêmeo com outra caixa.
    RETURN jsonb_build_object('ok', true, 'created', false,
      'field', jsonb_build_object('id', v_existente.id, 'field_name', v_existente.field_name,
                                  'field_type', v_existente.field_type));
  END IF;

  INSERT INTO public.lead_custom_fields (organization_id, field_name, field_type, field_options, is_required)
  VALUES (p_org, v_nome, v_tipo, p_field_options, COALESCE(p_is_required, false))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'created', true,
    'field', jsonb_build_object('id', v_id, 'field_name', v_nome, 'field_type', v_tipo));
END;
$$;

COMMENT ON FUNCTION public.api_create_custom_field(uuid, text, text, jsonb, boolean) IS
  'POST /api/v1/custom-fields (escopo metadata:write). Idempotente por nome sem distinção de caixa: campo já existente é devolvido com created=false.';

-- ── Gravar valores criando os campos ausentes ──────────────────────────────
CREATE OR REPLACE FUNCTION public.api_set_custom_fields_creating(
  p_org uuid,
  p_lead_id uuid,
  p_values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  v_field_id uuid;
  criados text[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_values) LOOP
    SELECT id INTO v_field_id
    FROM public.lead_custom_fields
    WHERE organization_id = p_org AND lower(btrim(field_name)) = lower(btrim(k))
    LIMIT 1;

    IF v_field_id IS NULL THEN
      INSERT INTO public.lead_custom_fields (organization_id, field_name, field_type)
      VALUES (p_org, btrim(k), 'text')
      RETURNING id INTO v_field_id;
      criados := array_append(criados, btrim(k));
    END IF;

    INSERT INTO public.lead_custom_field_values (lead_id, field_id, value, updated_at)
    VALUES (p_lead_id, v_field_id, p_values->>k, now())
    ON CONFLICT (lead_id, field_id) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created_fields', to_jsonb(criados));
END;
$$;

COMMENT ON FUNCTION public.api_set_custom_fields_creating(uuid, uuid, jsonb) IS
  'PUT /api/v1/leads/{id}/custom-fields?create_missing=true. Cria como text o campo ausente e devolve os nomes criados em created_fields.';

REVOKE ALL ON FUNCTION public.api_create_custom_field(uuid, text, text, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.api_set_custom_fields_creating(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_create_custom_field(uuid, text, text, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_set_custom_fields_creating(uuid, uuid, jsonb) TO service_role;
