-- ============================================================================
-- Aba Saúde (Comando) travada em skeleton infinito — overload fantasma da RPC.
--
-- SINTOMA: a aba "Saúde" nunca terminava de carregar. Nenhuma mensagem de erro:
-- TabSaude.tsx caía no ramo `if (isLoading || !data) return <Skeleton/>` e ficava
-- lá pra sempre, porque o componente não tinha estado de erro.
--
-- CAUSA RAIZ: o PROD tinha DUAS versões de public.get_funnel_health convivendo:
--
--   (uuid, timestamptz, timestamptz)                          -- 20261127000000, corpo antigo
--   (uuid, timestamptz, timestamptz, text[] DEFAULT NULL)     -- 20261214000000, corpo atual
--
-- O hook useFunnelHealth só manda p_origins quando o filtro de origens tem algo
-- selecionado. Com o filtro vazio (estado PADRÃO da aba) a chamada vai com 3
-- params — e aí as duas assinaturas são candidatas igualmente válidas, porque a
-- de 4 args tem DEFAULT no 4º. Postgres recusa:
--
--   ERROR 42725: function public.get_funnel_health(uuid, timestamptz, timestamptz)
--                is not unique
--   HINT: Could not choose a best candidate function.
--
-- Ou seja: a aba quebrava exatamente no caminho mais comum (sem filtro), e
-- funcionaria se o usuário selecionasse uma origem.
--
-- POR QUE ACONTECEU: a 20261214000000 DROPA o overload de 3 args antes de criar o
-- de 4. Mas ela nunca entrou pelo tracker do PROD (supabase_migrations.schema_migrations
-- registra a 20261127000000 e NÃO a 20261214000000) — a função de 4 args foi criada
-- por SQL direto e o DROP do 3-arg ficou pra trás. O overload velho sobreviveu.
--
-- ESTA MIGRATION: remove o overload defasado, deixando só a assinatura de 4 args.
-- Depois disso a chamada com 3 params resolve pro DEFAULT NULL e a aba volta.
--
-- Idempotente. Só dropa o antigo se o atual existir — nunca deixa a aba sem RPC.
-- ============================================================================

DO $$
DECLARE
  v_novo  int;
  v_velho int;
BEGIN
  SELECT count(*) INTO v_novo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_funnel_health'
    AND pg_get_function_identity_arguments(p.oid)
        = 'p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_origins text[]';

  SELECT count(*) INTO v_velho
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_funnel_health'
    AND pg_get_function_identity_arguments(p.oid)
        = 'p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone';

  IF v_novo = 0 THEN
    RAISE EXCEPTION
      'ABORTADO: get_funnel_health(uuid,timestamptz,timestamptz,text[]) não existe neste banco. '
      'Aplique 20261214000000_funnel_health_origins_cycles.sql antes — dropar o overload de 3 args '
      'agora deixaria a aba Saúde sem RPC nenhuma.';
  END IF;

  IF v_velho = 0 THEN
    RAISE NOTICE 'No-op: overload de 3 args já não existe.';
  ELSE
    DROP FUNCTION public.get_funnel_health(uuid, timestamptz, timestamptz);
    RAISE NOTICE 'Overload defasado get_funnel_health(uuid,timestamptz,timestamptz) removido.';
  END IF;
END$$;

-- ── Verificação: sobrou exatamente uma assinatura ────────────────────────────
DO $$
DECLARE
  v_total int;
BEGIN
  SELECT count(*) INTO v_total
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_funnel_health';

  IF v_total <> 1 THEN
    RAISE EXCEPTION 'FAIL: esperava 1 assinatura de get_funnel_health, encontrou %', v_total;
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: get_funnel_health com assinatura única.';
END$$;
