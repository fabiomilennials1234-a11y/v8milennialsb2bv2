-- ============================================================================
-- `api_create_lead` e `api_search_leads` — o guardião do registro por trás de
-- POST /leads e GET /leads/search. (#1768)
--
-- ── POR QUE A DECISÃO MORA AQUI, E NÃO NO HANDLER ─────────────────────────
-- Procurar em TypeScript e inserir depois é check-then-insert: duas requisições
-- simultâneas com o mesmo telefone veem "não existe" as DUAS e criam dois Leads
-- — exatamente a duplicata que a rota existe para impedir. Foi esse padrão, no
-- webhook de ingest, que produziu os 45.678 pares duplicados em 52 organizações
-- que o ADR-0023 mediu.
--
-- Aqui a decisão é atômica: `INSERT ... ON CONFLICT DO NOTHING` sobre o índice
-- único `idx_leads_org_phone_unique`. Quem perde a corrida não insere, lê o
-- vencedor, e devolve conflito. Não existe janela entre checar e escrever.
--
-- ── A NORMALIZAÇÃO É REUSADA, NÃO REESCRITA ───────────────────────────────
-- `normalized_phone` é preenchido pelo gatilho BEFORE `leads_normalize_phone_trigger`,
-- que roda antes da checagem de conflito. Reescrever a normalização aqui seria
-- garantir que as duas divergissem com o tempo, e a divergência apareceria como
-- duplicata que "deveria" ter casado.
--
-- ── IDEMPOTÊNCIA ──────────────────────────────────────────────────────────
-- Mesma chave, dentro da janela, devolve o MESMO recurso. A corrida na própria
-- chave é resolvida do mesmo jeito: índice único e ON CONFLICT — o perdedor lê o
-- que o vencedor gravou.
--
-- `api_request_logs` não serve: é telemetria (método, caminho, status), e está
-- com 0 linhas. Tabela própria.
-- ============================================================================
BEGIN;

-- ── Registro de idempotência ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  idempotency_key text NOT NULL,
  resource_id     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_idempotency
  ON public.api_idempotency_keys (organization_id, endpoint, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_created
  ON public.api_idempotency_keys (created_at);

ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_idempotency_keys FROM public, anon, authenticated;
GRANT ALL ON TABLE public.api_idempotency_keys TO service_role;

COMMENT ON TABLE public.api_idempotency_keys IS
  'Chave de idempotência da API pública: mesma chave, mesmo recurso. Deny-all por '
  'desenho — a API roda como service_role e nenhum papel de usuário final tem '
  'motivo para ler isto. Retenção de 24h por expurgo agendado.';

-- ── Criação de Lead: achar-ou-recusar, atômico ────────────────────────────
CREATE OR REPLACE FUNCTION public.api_create_lead(
  p_org uuid,
  p_lead jsonb,
  p_idempotency_key text DEFAULT NULL
)
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
    WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL
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

REVOKE ALL ON FUNCTION public.api_create_lead(uuid, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_lead(uuid, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.api_create_lead(uuid, jsonb, text) IS
  'POST /api/v1/leads. Telefone repetido NÃO cria segunda pessoa: devolve '
  'status=conflict com o id e o nome de quem já está lá. Atômico por '
  'ON CONFLICT sobre idx_leads_org_phone_unique — check-then-insert em '
  'TypeScript seria corrida, e foi assim que nasceram 45.678 pares duplicados.';

-- ── Busca de Lead ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_search_leads(
  p_org uuid,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_limit int DEFAULT 50
)
 RETURNS SETOF public.leads
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT l.*
    FROM public.leads l
   WHERE l.organization_id = p_org
     AND l.deleted_at IS NULL
     AND (
       (p_phone IS NOT NULL AND l.normalized_phone = public.normalize_brazilian_phone(p_phone))
       OR
       (p_email IS NOT NULL AND lower(l.email) = lower(p_email))
     )
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT least(coalesce(p_limit, 50), 100);
$function$;

REVOKE ALL ON FUNCTION public.api_search_leads(uuid, text, text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_search_leads(uuid, text, text, int) TO service_role;

COMMENT ON FUNCTION public.api_search_leads(uuid, text, text, int) IS
  'GET /api/v1/leads/search. Devolve LISTA porque um telefone pode casar mais de '
  'um Lead, e esconder isso atrás de resultado único faria a busca mentir onde a '
  'duplicata mora. Sem critério, a rota recusa ANTES de chegar aqui.';

-- ── Verificação ────────────────────────────────────────────────────────────
DO $$
DECLARE v_anon_create boolean; v_anon_search boolean; v_n int;
BEGIN
  SELECT has_function_privilege('anon', 'public.api_create_lead(uuid,jsonb,text)', 'EXECUTE')
    INTO v_anon_create;
  SELECT has_function_privilege('anon', 'public.api_search_leads(uuid,text,text,int)', 'EXECUTE')
    INTO v_anon_search;
  IF v_anon_create OR v_anon_search THEN
    RAISE EXCEPTION 'FAIL: anon tem EXECUTE numa das funções da API.';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('api_create_lead','api_search_leads');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FAIL: esperadas 2 funções (sem overload), encontradas %.', v_n;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_create_lead e api_search_leads criadas, anon sem EXECUTE, sem overload.';
END$$;

COMMIT;
