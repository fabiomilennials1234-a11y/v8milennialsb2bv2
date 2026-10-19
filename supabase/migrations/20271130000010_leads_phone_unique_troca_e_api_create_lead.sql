-- Telefone N:N, PR3 (Chamado 99067f13), passo 2 de 2: troca o indice e adapta api_create_lead.
--
-- PRE-REQUISITO: 20271130000000 aplicada (fora de transacao) e
--   SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_leads_org_phone_unique_v2'::regclass;
-- devolvendo true. A guarda abaixo aborta se o v2 nao existir ou estiver invalido.
--
-- O que muda, numa transacao so (lock_timeout 3s: aborta em vez de enfileirar
-- escritas em leads atras do DROP):
--   1. api_create_lead: unico ajuste e o predicado do ON CONFLICT, que ganha
--      `AND NOT phone_compartilhado`. O predicado de inferencia precisa IMPLICAR o
--      do indice, senao o INSERT falha com 42P10. Corpo, assinatura, SECURITY
--      DEFINER, search_path identicos a prod (pg_get_functiondef em 19/10/2026;
--      EXECUTE so para postgres e service_role). CREATE OR REPLACE preserva os grants.
--   2. DROP do idx_leads_org_phone_unique (antigo, sem o filtro).
--   3. RENAME do _v2 para idx_leads_org_phone_unique. O NOME ORIGINAL TEM que voltar:
--      o front detecta o 23505 por ele (useWhatsAppLeadIntegration.ts, lead-phones.ts).
--   Tudo e transacional: ate o COMMIT as demais sessoes ainda veem o indice antigo.
--
-- COMPORTAMENTO CONHECIDO de api_create_lead depois desta migration:
--   - numero que so tem leads compartilhados (nenhum "dono"): o INSERT nao conflita e
--     CRIA um novo lead (nao compartilhado). Aceito: o indice so protege o dono.
--   - numero com dono: ON CONFLICT DO NOTHING + lookup -> 'conflict'. O lookup
--     (inalterado) faz LIMIT 1 sem ORDER BY e pode devolver um lead compartilhado em
--     vez do dono. Hoje 0 leads compartilhados; a PR4 deve decidir se ordena.
--
-- IRREVERSIVEL na pratica: depois que existir 1 lead vivo com phone_compartilhado =
-- true cujo numero tambem e de outro lead vivo, recriar o indice antigo FALHA
-- (23505). O rollback tem guarda e aborta. Ver
-- rollback/20271130000010_leads_phone_unique_troca_e_api_create_lead.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $guard$
DECLARE
  v_valid boolean;
BEGIN
  SELECT i.indisvalid INTO v_valid
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.idx_leads_org_phone_unique_v2');
  IF v_valid IS NULL THEN
    RAISE EXCEPTION 'idx_leads_org_phone_unique_v2 nao existe: aplique 20271130000000 antes';
  END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'idx_leads_org_phone_unique_v2 esta INVALIDO (CREATE INDEX CONCURRENTLY falhou): DROP INDEX CONCURRENTLY e refaca a 20271130000000';
  END IF;
END
$guard$;

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

DROP INDEX public.idx_leads_org_phone_unique;
ALTER INDEX public.idx_leads_org_phone_unique_v2 RENAME TO idx_leads_org_phone_unique;

COMMIT;
