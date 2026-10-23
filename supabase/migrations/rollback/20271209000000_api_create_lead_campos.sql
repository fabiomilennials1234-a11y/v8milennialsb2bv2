-- Rollback de 20271209000000_api_create_lead_campos.
--
-- Devolve api_create_lead ao corpo de 20271207000000_telefone_compartilhar_numero
-- (= prod em 20/10/2026): grava só name/phone/email/company/origin, replay sem
-- comparar hash e sem advisory lock.
--
-- Faca ANTES: reverter o handler (supabase/functions/_shared/api/routes/leads-create.ts).
-- Com o handler novo e esta RPC velha, notes/segment/faturamento/utm_* passam pela
-- validação e somem em silêncio — o defeito que a 20271209 corrigiu.
-- Chaves gravadas com request_hash continuam com a coluna preenchida (a coluna é
-- da 20271021000009 e serve /deals); a função velha a ignora.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.api_create_lead(p_org uuid, p_lead jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_endpoint  constant text := 'POST /leads';
  v_existente uuid;
  v_novo      uuid;
  v_row       public.leads%ROWTYPE;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- 1. Replay. Só depois de confirmar que o recurso ainda existe: chave apontando
  --    para Lead apagado é chave morta, e devolver "replayed" com corpo vazio
  --    seria pior que criar de novo.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id INTO v_existente
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.leads WHERE id = v_existente AND deleted_at IS NULL;
      IF FOUND THEN
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
  INSERT INTO public.leads (organization_id, name, phone, email, company, origin)
  VALUES (
    p_org,
    nullif(p_lead->>'name', ''),
    nullif(p_lead->>'phone', ''),
    nullif(p_lead->>'email', ''),
    nullif(p_lead->>'company', ''),
    coalesce(nullif(p_lead->>'origin', ''), 'api')
  )
  ON CONFLICT (organization_id, normalized_phone)
    WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL AND NOT phone_compartilhado
  DO NOTHING
  RETURNING id INTO v_novo;

  -- 3. Perdeu a corrida (ou já existia): devolve QUEM está lá, com o nome.
  --    Devolver o identificador é o que transforma a recusa em resposta útil —
  --    o chamador segue para abrir o Negócio sem uma chamada extra.
  IF v_novo IS NULL THEN
    -- Resolve pelo telefone recebido, normalizado pela MESMA função que o
    -- gatilho usa. Reescrever a normalização aqui seria garantir divergência, e
    -- a divergência apareceria como duplicata que "deveria" ter casado.
    SELECT * INTO v_row
      FROM public.leads
     WHERE organization_id = p_org
       AND deleted_at IS NULL
       AND normalized_phone = public.normalize_brazilian_phone(p_lead->>'phone')
     ORDER BY phone_compartilhado, created_at, id
     LIMIT 1;

    RETURN jsonb_build_object(
      'status', 'conflict',
      'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                                 'phone', v_row.phone, 'email', v_row.email));
  END IF;

  -- 4. Criou. Registra a chave; corrida na própria chave cai no ON CONFLICT.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_novo)
    ON CONFLICT (organization_id, endpoint, idempotency_key) DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.leads WHERE id = v_novo;
  RETURN jsonb_build_object(
    'status', 'created',
    'lead', jsonb_build_object('id', v_row.id, 'name', v_row.name,
                               'phone', v_row.phone, 'email', v_row.email));
END;
$function$;

REVOKE ALL ON FUNCTION public.api_create_lead(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_lead(uuid, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.api_create_lead(uuid, jsonb, text) IS
  'POST /api/v1/leads. Telefone repetido NÃO cria segunda pessoa: devolve '
  'status=conflict com o id e o nome de quem já está lá. Atômico por '
  'ON CONFLICT sobre idx_leads_org_phone_unique — check-then-insert em '
  'TypeScript seria corrida, e foi assim que nasceram 45.678 pares duplicados.';

COMMIT;
