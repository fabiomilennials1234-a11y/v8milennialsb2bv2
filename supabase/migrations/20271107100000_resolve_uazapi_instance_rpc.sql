-- ============================================================================
-- resolve_uazapi_instance + count_exhausted_uazapi_dlq_by_token
--
-- TIMESTAMP PROVISÓRIO. Renumerar contra o ledger de PROD
-- (supabase_migrations.schema_migrations) na hora de aplicar — colisão de
-- ledger é o normal neste repo. Só cria funções; não toca tabela.
--
-- Por quê
--   O whatsapp-webhook resolvia a instância de cada evento com três GETs REST:
--     1. whatsapp_instance_secrets?uazapi_instance_id=eq.<ref>
--     2. whatsapp_instance_secrets?uazapi_token=eq.<TOKEN>   ← token na URL
--     3. whatsapp_instances?id=eq.<id>
--   O GET (2) põe o token por instância da Uazapi na query string, e
--   edge_logs.request.search grava a query string em claro (medido: ~5,5 mil
--   linhas/h, 90 tokens distintos). O mesmo vale para o filtro
--   `payload->>token=eq.<TOKEN>` da checagem de token envenenado (ERR-4).
--
--   Chamadas via RPC (POST) levam os parâmetros no CORPO, que não vai para
--   edge_logs. De quebra, as três leituras viram uma.
--
-- Precedência: uazapi_instance_id > token. Ambiguidade (mais de uma linha
-- casando no mesmo critério) NÃO escolhe nenhuma — paridade com o
-- `.maybeSingle()` antigo, que errava e devolvia null. Escolher "a primeira"
-- seria rotear evento para o tenant errado.
--
-- Achado sobre o candidato por id (por que ele nunca casa)
--   uazapi_instance_id guarda o id interno da Uazapi (`r…`, 139/139 linhas),
--   gravado por set_uazapi_credentials a partir de `resp.instance.id`. O
--   payload V2 do webhook NÃO traz esse id: traz `instanceName` (= o nome de
--   exibição, whatsapp_instances.instance_name) e `token`. O webhook é
--   configurado como `<base>/<secret>` + addUrlEvents, então também não há id
--   no path. O candidato que o handler manda é o NOME — comparar nome com id
--   não casa nunca. Casar por instance_name NÃO é seguro: o nome é único só
--   por organização (whatsapp_instances_organization_id_instance_name_key) e
--   já há 2 nomes repetidos entre orgs em prod. O token é o único
--   identificador globalmente único no payload; ele vira o caminho primário
--   de fato, e o id fica para payloads/paths que tragam o `r…` explícito.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_uazapi_instance(
  p_instance_ref text,
  p_token text
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  instance_name text,
  phone_number text,
  provider text,
  via text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_via text;
BEGIN
  -- Guarda: só service_role (mesmo padrão de get_uazapi_credentials).
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_instance_ref IS NOT NULL AND p_instance_ref <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_instance_id = p_instance_ref;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'instance_id';
    END IF;
  END IF;

  IF v_id IS NULL AND p_token IS NOT NULL AND p_token <> '' THEN
    SELECT array_agg(s.instance_id) INTO v_ids
      FROM public.whatsapp_instance_secrets s
      JOIN public.whatsapp_instances i ON i.id = s.instance_id
     WHERE s.uazapi_token = p_token;
    IF cardinality(v_ids) = 1 THEN
      v_id := v_ids[1];
      v_via := 'token';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT i.id, i.organization_id, i.instance_name, i.phone_number, i.provider, v_via
    FROM public.whatsapp_instances i
   WHERE i.id = v_id;
END;
$function$;

COMMENT ON FUNCTION public.resolve_uazapi_instance(text, text) IS
  'Webhook Uazapi: resolve a instância por uazapi_instance_id (preferido) ou token. '
  'Só service_role. Existe para o token viajar no corpo do POST, nunca na URL.';

-- Default privilege do schema dá EXECUTE NOMINAL a anon/authenticated/
-- service_role em função nova; REVOKE FROM PUBLIC não alcança grant nominal.
REVOKE ALL ON FUNCTION public.resolve_uazapi_instance(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_uazapi_instance(text, text) TO service_role;


-- Checagem de token envenenado (ERR-4, whatsapp-webhook/poison-denylist.ts):
-- quantas linhas unknown_instance não resolvidas e com replay esgotado existem
-- para o token. Antes era um HEAD com `payload->>token=eq.<TOKEN>` na URL.
-- SECURITY INVOKER: quem chama é service_role, que já lê a DLQ; a função existe
-- só para tirar o token da query string.
CREATE OR REPLACE FUNCTION public.count_exhausted_uazapi_dlq_by_token(
  p_token text,
  p_min_attempts integer
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_token IS NULL OR p_token = '' THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT count(*)
      FROM public.whatsapp_webhook_dlq d
     WHERE d.reason = 'unknown_instance'
       AND d.resolved_at IS NULL
       AND d.attempts >= p_min_attempts
       AND d.payload->>'token' = p_token
  );
END;
$function$;

COMMENT ON FUNCTION public.count_exhausted_uazapi_dlq_by_token(text, integer) IS
  'Webhook Uazapi (ERR-4): conta DLQ unknown_instance esgotada para o token. '
  'Só service_role. Existe para o token viajar no corpo do POST, nunca na URL.';

REVOKE ALL ON FUNCTION public.count_exhausted_uazapi_dlq_by_token(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_exhausted_uazapi_dlq_by_token(text, integer) TO service_role;
