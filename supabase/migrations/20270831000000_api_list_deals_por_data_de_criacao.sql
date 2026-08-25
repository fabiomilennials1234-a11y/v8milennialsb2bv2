-- ============================================================================
-- `api_list_deals` ganha `created_from` / `created_to`, e o índice que os serve.
--
-- ── POR QUE, SE `created_at` JÁ IA NO CORPO ───────────────────────────────
-- Ia — e é isso que tornava o buraco invisível. Quem integra via o campo na
-- resposta, concluía que dava para filtrar por ele, e descobria que não: a
-- listagem só aceitava `updated_since`, que corta por `last_activity_at`. Sem
-- filtro por criação, "traga os Negócios abertos ontem para movê-los" obriga a
-- varrer a base inteira e peneirar no cliente — e o cliente pagina por última
-- atividade, então nem sabe quando parar de varrer.
--
-- ── EXCLUSIVO NO `updated_since`, INCLUSIVO AQUI ──────────────────────────
-- E é deliberado, não descuido. `updated_since` é ponteiro de sincronização:
-- `>` porque o chamador guarda o último instante que viu e não quer recebê-lo
-- de novo. `created_from`/`created_to` são recorte de janela ("o dia 12"), e
-- janela com ponta aberta perde a linha que caiu no milissegundo do limite.
-- É a mesma convenção do `created_from`/`created_to` de `api_list_leads`.
--
-- ── O KEYSET NÃO MUDA ─────────────────────────────────────────────────────
-- Continua `(last_activity_at, id) DESC`. Trocar a ordenação para criação
-- quando o filtro aparecesse daria DOIS contratos de cursor na mesma rota, e o
-- cursor é opaco para quem chama: ele guarda a string entre chamadas e não tem
-- como saber que a chave por trás dela mudou. O resultado seria pular ou
-- repetir registro em silêncio. Filtrar não é ordenar.
--
-- ── O ÍNDICE ──────────────────────────────────────────────────────────────
-- `deals` tem 8 índices e NENHUM sobre `(organization_id, created_at)`: o de
-- #1766 é sobre `last_activity_at`. Sem ele, o recorte por janela vira varredura
-- do inquilino inteiro. Índice comum, não `CONCURRENTLY`: são 34.990 linhas em
-- produção, a construção é sub-segundo, e `CONCURRENTLY` não roda dentro da
-- transação em que o CLI aplica cada migration.
-- ============================================================================
BEGIN;

-- Assinatura muda de novo. `CREATE OR REPLACE` com outra lista de argumentos
-- não substitui: cria SOBRECARGA, e aí o PostgREST resolve por nome+argumentos.
-- A chamada cairia na versão sem o recorte e devolveria a janela inteira onde o
-- chamador pediu um dia — que é o defeito exato que este arquivo conserta.
DROP FUNCTION IF EXISTS public.api_list_deals(uuid, text, text, uuid, text, timestamptz, int, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.api_list_deals(
  p_org                   uuid,
  p_pipeline              text        DEFAULT NULL,
  p_stage                 text        DEFAULT NULL,
  p_owner_id              uuid        DEFAULT NULL,
  p_status                text        DEFAULT NULL,
  p_updated_since         timestamptz DEFAULT NULL,
  p_created_from          timestamptz DEFAULT NULL,
  p_created_to            timestamptz DEFAULT NULL,
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
     -- Janela de CRIAÇÃO. Independente do corte de sincronização acima: um
     -- Negócio criado ontem e editado hoje entra em `created_from=ontem` e
     -- também em `updated_since=hoje`. As duas perguntas são diferentes, e
     -- responder uma pela outra é justamente o que o chamador não consegue
     -- desfazer do lado dele.
     AND (p_created_from IS NULL OR d.created_at >= p_created_from)
     AND (p_created_to   IS NULL OR d.created_at <= p_created_to)
     -- Keyset. O desempate por id evita repetir ou pular quando dois Negócios
     -- têm a mesma última atividade.
     AND (
       p_cursor_last_activity IS NULL
       OR (d.last_activity_at, d.id) < (p_cursor_last_activity, p_cursor_id)
     )
   ORDER BY d.last_activity_at DESC, d.id DESC
   LIMIT least(coalesce(p_limit, 51), 101);
$function$;

REVOKE ALL ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, timestamptz, timestamptz, int, timestamptz, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, timestamptz, timestamptz, int, timestamptz, uuid) TO service_role;

COMMENT ON FUNCTION public.api_list_deals(uuid, text, text, uuid, text, timestamptz, timestamptz, timestamptz, int, timestamptz, uuid) IS
  'GET /api/v1/deals. Keyset por (last_activity_at, id) DESC — a mesma chave que '
  'o updated_since usa, para não trocar cursor depois e quebrar quem pagina. '
  'created_from/created_to recortam por CRIAÇÃO e são inclusivos nas duas pontas; '
  'updated_since é ponteiro de sincronização e é exclusivo. A posição vem de '
  'pipeline_entries, que espelha também os funis customizados.';

-- Serve o recorte por janela de criação. `deals` tinha índice para
-- `last_activity_at` e nenhum para `created_at` — sem este, filtrar por criação
-- lê o inquilino inteiro.
CREATE INDEX IF NOT EXISTS idx_deals_org_created_at
  ON public.deals (organization_id, created_at DESC, id DESC);

DO $do$
DECLARE v_aberto int;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='api_list_deals') <> 1 THEN
    RAISE EXCEPTION 'FAIL: overload de api_list_deals — o PostgREST resolveria a versao sem o recorte por criacao.';
  END IF;

  SELECT count(*) INTO v_aberto
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'api_list_deals'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_aberto > 0 THEN
    RAISE EXCEPTION
      'FAIL: api_list_deals com EXECUTE para anon ou authenticated. É DEFINER e recebe a org por parâmetro.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='deals' AND indexname='idx_deals_org_created_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_deals_org_created_at ausente — o recorte por criacao varreria a organizacao inteira.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: api_list_deals recorta por criacao, indice no lugar, so service_role executa.';
END$do$;

COMMIT;
