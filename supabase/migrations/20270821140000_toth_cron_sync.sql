-- 20270821140000_toth_cron_sync.sql
--
-- Cron da sincronização do Toth: clientes 1x/dia, cobranças a cada 2h.
--
-- Sem agendamento, tudo dependia de alguém clicar — e carteira que envelhece em
-- silêncio é pior que carteira vazia, porque parece atual.
--
-- ⚠️ Já aplicada em prod em 2026-08-21 via MCP (autorização do CTO), sob a
-- versão `toth_cron_sync`. Mesmo drift de ledger das outras migrations do Toth.

CREATE OR REPLACE FUNCTION public.invoke_toth_sync(p_fn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_org    RECORD;
BEGIN
  IF to_regclass('public.toth_connections') IS NULL THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  -- Deriva a URL do próprio ambiente. Nunca chumbar o ref do projeto: isso faz
  -- o cron de um ambiente bater em outro.
  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/' || p_fn)
    INTO v_url
    FROM public.cron_config
   WHERE value LIKE 'https://%/functions/v1/%'
   ORDER BY key
   LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RETURN;
  END IF;

  -- Uma chamada por organização conectada: a edge function resolve o tenant
  -- pelo corpo quando vem por cron, e nunca por outro caminho.
  FOR v_org IN
    SELECT organization_id
      FROM public.toth_connections
     WHERE status = 'connected'
       AND erp_sync_mode <> 'off'
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', COALESCE(v_secret, '')
                 ),
      body    := jsonb_build_object('organization_id', v_org.organization_id)
    );
  END LOOP;
EXCEPTION
  -- `invalid_schema_name` é obrigatório: sem pg_net, o Postgres falha no SCHEMA
  -- (3F000 schema "net" does not exist) antes de procurar a função, e
  -- `undefined_function` NÃO captura isso.
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$$;

COMMENT ON FUNCTION public.invoke_toth_sync(TEXT) IS
  'Dispara uma sincronização do Toth por organização conectada. Resolve a URL a partir do cron_config do próprio ambiente.';

REVOKE ALL     ON FUNCTION public.invoke_toth_sync(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('toth-sync-clientes')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toth-sync-clientes');
    PERFORM cron.unschedule('toth-sync-cobrancas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toth-sync-cobrancas');

    -- Clientes 1x/dia, de madrugada: o cadastro muda devagar e a varredura lê a
    -- base inteira do ERP, que roda no servidor do próprio cliente.
    PERFORM cron.schedule(
      'toth-sync-clientes', '0 6 * * *',
      $cron$SELECT public.invoke_toth_sync('toth-sync-clientes');$cron$
    );

    -- Cobranças a cada 2h: título muda de status com o tempo, e é o dado que
    -- alimenta inadimplência. Cada execução avança o cursor; a volta completa
    -- leva ~21 execuções para 12.609 clientes.
    PERFORM cron.schedule(
      'toth-sync-cobrancas', '15 */2 * * *',
      $cron$SELECT public.invoke_toth_sync('toth-sync-cobrancas');$cron$
    );
  END IF;
END $$;
