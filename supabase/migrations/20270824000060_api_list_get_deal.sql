-- ============================================================================
-- `api_list_deals` e `api_get_deal` — leitura de Negócio pela API. (#1767)
--
-- ── A POSIÇÃO VEM DE pipeline_entries, E SÓ ───────────────────────────────
-- Inclusive para funil customizado. `custom_pipe_entries` é ESPELHADA em
-- `pipeline_entries` pelo gatilho de sincronia — medido em produção: 16.288
-- linhas custom contra 16.303 linhas de funil custom em `pipeline_entries`.
-- Um join só cobre os dois mundos; dois joins com UNION dariam a mesma resposta
-- por caminho mais caro, e divergiriam no dia em que a sincronia falhasse.
--
-- ── O CURSOR É (last_activity_at, id) ─────────────────────────────────────
-- Não `created_at`. É a coluna que #1766 criou e indexou
-- (`idx_deals_org_last_activity`), e é a que o `updated_since` do #1771 vai
-- usar. Paginar por criação agora e trocar depois quebraria quem já estivesse
-- paginando — o cliente guarda o cursor entre chamadas.
--
-- O desempate por `id` não é enfeite: sem ele, dois Negócios com a mesma última
-- atividade fariam a página repetir ou pular registro.
--
-- ── DEFINER COM ORG POR PARÂMETRO ─────────────────────────────────────────
-- Mesma forma de `api_create_deal`, e mesmo cuidado: a API roda como
-- service_role, para quem RLS não vale, então o recorte por organização é
-- explícito no corpo. `anon` e `authenticated` sem EXECUTE — é o que impede um
-- usuário logado de chamar passando a org do vizinho.
-- ============================================================================
BEGIN;

-- A assinatura mudou (ganhou `p_updated_since`). CREATE OR REPLACE com lista de
-- argumentos diferente cria OVERLOAD, e o PostgREST resolve por nome+argumentos:
-- a chamada poderia cair na versão sem o corte, devolvendo a base inteira onde o
-- conector esperava o delta.
DROP FUNCTION IF EXISTS public.api_list_deals(uuid, text, text, uuid, text, int, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.api_list_deals(
  p_org                   uuid,
  p_pipeline              text        DEFAULT NULL,
  p_stage                 text        DEFAULT NULL,
  p_owner_id              uuid        DEFAULT NULL,
  p_status                text        DEFAULT NULL,
  p_updated_since         timestamptz DEFAULT NULL,
  p_limit                 int         DEFAULT 51,
  p_cursor_last_activity  timestamptz DEFAULT NULL,
  p_cursor_id             uuid        DEFAULT NULL
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
     AND d.deleted_at IS NULL
     AND (p_pipeline IS NULL OR pip.slug = p_pipeline)
     AND (p_stage    IS NULL OR pe.stage_key = p_stage)
     AND (p_owner_id IS NULL OR d.owner_id = p_owner_id)
     AND (
       p_status IS NULL OR p_status = 'all'
       OR (p_status = 'open' AND d.closed_at IS NULL)
       OR (p_status = 'won'  AND d.won IS TRUE)
       OR (p_status = 'lost' AND d.closed_at IS NOT NULL AND d.won IS NOT TRUE)
     )
     -- Sincronização incremental (#1771). O corte é pela MESMA coluna do
     -- keyset, e isso não é coincidência: se o corte usasse `updated_at` e a
     -- ordenação usasse a última atividade, um Negócio que só mudou de Stage
     -- entraria no corte e sairia da ordenação — o conector veria buraco.
     AND (p_updated_since IS NULL OR d.last_activity_at > p_updated_since)
     -- Keyset. O desempate por id evita repetir ou pular quando dois Negócios
     -- têm a mesma última atividade.
     AND (
       p_cursor_last_activity IS NULL
       OR (d.last_activity_at, d.id) < (p_cursor_last_activity, p_cursor_id)
     )
   ORDER BY d.last_activity_at DESC, d.id DESC
   LIMIT least(coalesce(p_limit, 51), 101);
$function$;

CREATE OR REPLACE FUNCTION public.api_get_deal(
  p_org     uuid,
  p_deal_id uuid
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Devolve NULL quando não existe OU quando é de outra organização. Os dois
  -- casos são indistinguíveis de fora de propósito: responder diferente para o
  -- Negócio alheio confirmaria ao chamador que aquele id existe em algum lugar.
  SELECT to_jsonb(t) FROM (
    SELECT d.id, d.last_activity_at, d.created_at,
           d.title, d.value, d.source,
           d.won, d.closed_at, d.loss_reason,
           d.owner_id, d.source_lead_id,
           pip.slug AS pipeline_slug, pe.stage_key
      FROM public.deals d
      LEFT JOIN public.pipeline_entries pe ON pe.deal_id = d.id
      LEFT JOIN public.pipelines pip ON pip.id = pe.pipeline_id
     WHERE d.id = p_deal_id
       AND d.organization_id = p_org
       AND d.deleted_at IS NULL
     LIMIT 1
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, int, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, int, timestamptz, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.api_get_deal(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_deal(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, int, timestamptz, uuid) IS
  'GET /api/v1/deals. Keyset por (last_activity_at, id) DESC — a mesma chave que '
  'o updated_since do #1771 usa, para não trocar cursor depois e quebrar quem '
  'pagina. A posição vem de pipeline_entries, que espelha também os funis '
  'customizados.';

COMMENT ON FUNCTION public.api_get_deal(uuid, uuid) IS
  'GET /api/v1/deals/{id}. NULL quando não existe OU é de outra organização — '
  'indistinguíveis de fora de propósito.';

DO $do$
DECLARE v_aberto int;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='api_list_deals') <> 1 THEN
    RAISE EXCEPTION 'FAIL: overload de api_list_deals — o PostgREST resolveria a versao sem o corte incremental.';
  END IF;

  SELECT count(*) INTO v_aberto
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('api_list_deals','api_get_deal')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_aberto > 0 THEN
    RAISE EXCEPTION
      'FAIL: % função(ões) de leitura de Negócio com EXECUTE para anon ou authenticated. São DEFINER e recebem a org por parâmetro.', v_aberto;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_list_deals e api_get_deal criadas, só service_role executa.';
END$do$;

COMMIT;
