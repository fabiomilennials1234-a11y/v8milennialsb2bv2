-- POST /api/v1/leads grava o corpo que aceita.
--
-- Até aqui a RPC gravava só name/phone/email/company/origin e o resto do corpo
-- sumia em silêncio com 201. O handler agora recusa chave fora da lista (422) e
-- esta função grava os 13 campos aceitos na mesma chamada. A lista mora em DOIS
-- lugares: aqui e em `CREATE_FIELDS`
-- (supabase/functions/_shared/api/routes/leads-create.ts) — mudar um sem o outro
-- volta a perder dado em silêncio.
--
-- Muda também a idempotência:
--   • a chave guarda `request_hash` (sha256 dos 13 campos normalizados). Mesma
--     chave com corpo diferente devolve 'conflict' com o Lead da chave e
--     reason = 'idempotency_key_reused' — o handler traduz em 409
--     lead_already_exists, o código que os fluxos do n8n já tratam;
--   • chave antiga (request_hash NULL) continua fazendo replay como antes;
--   • advisory lock por (org, endpoint, chave) serializa a leitura da chave;
--   • o replay só devolve Lead da própria organização.
--
-- Partida: corpo de 20271207000000_telefone_compartilhar_numero.sql (= prod em
-- 20/10/2026). Preserva ON CONFLICT com `NOT phone_compartilhado`, o lookup do
-- conflito via normalize_brazilian_phone e a ordem determinística do dono.
--
-- Rollback: supabase/migrations/rollback/20271209000000_api_create_lead_campos.sql

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.api_create_lead(p_org uuid, p_lead jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint   constant text := 'POST /leads';
  v_existente  uuid;
  v_saved_hash text;
  v_hash       text;
  v_novo       uuid;
  v_row        public.leads%ROWTYPE;
  -- Normalização ÚNICA: o que é gravado e o que entra no hash saem daqui.
  -- Hash calculado sobre outra forma do corpo faria "mesmo corpo" virar conflito.
  v_name         text := nullif(p_lead->>'name', '');
  v_phone        text := nullif(p_lead->>'phone', '');
  v_email        text := nullif(p_lead->>'email', '');
  v_company      text := nullif(p_lead->>'company', '');
  v_origin       text := coalesce(nullif(p_lead->>'origin', ''), 'api');
  v_notes        text := nullif(p_lead->>'notes', '');
  v_segment      text := nullif(p_lead->>'segment', '');
  v_faturamento  text := nullif(p_lead->>'faturamento', '');
  v_utm_source   text := nullif(p_lead->>'utm_source', '');
  v_utm_medium   text := nullif(p_lead->>'utm_medium', '');
  v_utm_campaign text := nullif(p_lead->>'utm_campaign', '');
  v_utm_content  text := nullif(p_lead->>'utm_content', '');
  v_utm_term     text := nullif(p_lead->>'utm_term', '');
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    v_hash := encode(sha256(convert_to(jsonb_build_array(
      v_name, v_phone, v_email, v_company, v_origin, v_notes, v_segment,
      v_faturamento, v_utm_source, v_utm_medium, v_utm_campaign, v_utm_content,
      v_utm_term)::text, 'UTF8')), 'hex');
    -- Serializa a transação inteira antes da leitura, inclusive quando a chave
    -- ainda não existe: duas retentativas simultâneas não criam dois Leads.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || v_endpoint || ':' || p_idempotency_key, 0));

    -- 1. Replay. Só depois de confirmar que o recurso ainda existe e é DESTA
    --    organização: chave apontando para Lead apagado é chave morta, e devolver
    --    "replayed" com corpo vazio seria pior que criar de novo.
    SELECT k.resource_id, k.request_hash INTO v_existente, v_saved_hash
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row
        FROM public.leads
       WHERE id = v_existente AND organization_id = p_org AND deleted_at IS NULL;
      IF FOUND THEN
        -- Chave reusada com outro corpo: NÃO é retentativa. Responder 'replayed'
        -- afirmaria que este corpo foi gravado. Devolve o Lead da chave como
        -- conflito; o chamador decide. Hash NULL = chave anterior a esta
        -- migration, sem como comparar: replay como sempre foi.
        IF v_saved_hash IS NOT NULL AND v_saved_hash <> v_hash THEN
          RETURN jsonb_build_object(
            'status', 'conflict',
            'reason', 'idempotency_key_reused',
            'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                       'phone', v_row.phone, 'email', v_row.email));
        END IF;
        RETURN jsonb_build_object(
          'status', 'replayed',
          'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                     'phone', v_row.phone, 'email', v_row.email));
      END IF;
    END IF;
  END IF;

  -- 2. Insere ou não insere — sem janela entre checar e escrever.
  --    O gatilho BEFORE normaliza o telefone antes da checagem de conflito, por
  --    isso o índice parcial casa.
  INSERT INTO public.leads (
    organization_id, name, phone, email, company, origin, notes, segment,
    faturamento, utm_source, utm_medium, utm_campaign, utm_content, utm_term
  )
  VALUES (
    p_org, v_name, v_phone, v_email, v_company, v_origin, v_notes, v_segment,
    v_faturamento, v_utm_source, v_utm_medium, v_utm_campaign, v_utm_content,
    v_utm_term
  )
  ON CONFLICT (organization_id, normalized_phone)
    WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL AND NOT phone_compartilhado
  DO NOTHING
  RETURNING id INTO v_novo;

  -- 3. Perdeu a corrida (ou já existia): devolve QUEM está lá, com o nome. O Lead
  --    existente NÃO é tocado — o corpo desta chamada não sobrescreve ninguém.
  IF v_novo IS NULL THEN
    -- Resolve pelo telefone recebido, normalizado pela MESMA função que o
    -- gatilho usa. Reescrever a normalização aqui seria garantir divergência, e
    -- a divergência apareceria como duplicata que "deveria" ter casado.
    SELECT * INTO v_row
      FROM public.leads
     WHERE organization_id = p_org
       AND deleted_at IS NULL
       AND normalized_phone = public.normalize_brazilian_phone(v_phone)
     ORDER BY phone_compartilhado, created_at, id
     LIMIT 1;

    RETURN jsonb_build_object(
      'status', 'conflict',
      'reason', 'phone_already_exists',
      'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                 'phone', v_row.phone, 'email', v_row.email));
  END IF;

  -- 4. Criou. Registra a chave com o hash do corpo. Sob o advisory lock, só se
  --    chega aqui com a chave já existente se o Lead dela morreu (chave morta):
  --    a chave passa a apontar para o Lead novo, com o hash novo.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id, request_hash)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_novo, v_hash)
    ON CONFLICT (organization_id, endpoint, idempotency_key)
    DO UPDATE SET resource_id = EXCLUDED.resource_id,
                  request_hash = EXCLUDED.request_hash;
  END IF;

  SELECT * INTO v_row FROM public.leads WHERE id = v_novo AND organization_id = p_org;
  RETURN jsonb_build_object(
    'status', 'created',
    'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                               'phone', v_row.phone, 'email', v_row.email));
END;
$function$;

-- CREATE OR REPLACE preserva a ACL de prod ({postgres,service_role}); reafirmar
-- aqui faz o repo dizer a mesma coisa que o banco, e cobre ambiente recriado do
-- zero (função nova nasce executável por PUBLIC).
REVOKE ALL ON FUNCTION public.api_create_lead(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_lead(uuid, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.api_create_lead(uuid, jsonb, text) IS
  'POST /api/v1/leads. Grava name, phone, email, company, origin, notes, segment, '
  'faturamento e utm_* (lista espelhada em CREATE_FIELDS do handler). Telefone '
  'existente → conflict/phone_already_exists sem tocar o Lead. Idempotency-Key com '
  'request_hash: mesmo corpo → replayed; corpo diferente → conflict/idempotency_key_reused.';

COMMIT;
