-- 20271121000000_toth_cobrancas_full_diario.sql
--
-- Varredura completa diária das cobranças do Toth (follow-up do Chamado
-- 065e4890, PR #2313).
--
-- O Toth OMITE título pago da resposta de /cobrancas. O sync a cada 2h usa
-- janela de ±45 dias, e a ausência só prova baixa para quem vence DENTRO dela:
-- título vencido há mais de 45 dias e pago depois ficava `atrasado` para
-- sempre, até alguém rodar `{full:true}` à mão. Este job roda essa volta toda
-- madrugada.
--
-- Três peças:
--  1. Cursor PRÓPRIO da volta completa. `full` e janela dividiam
--     `cobrancas_cursor`; uma volta precisa de ~5 execuções de 3.000 clientes,
--     e intercaladas cada modo avançava o cursor do outro — nenhuma volta
--     cobria a base inteira. `last_cobrancas_full_sweep_at` marca quando a
--     volta completa fechou; a edge function lê para não repetir na mesma noite.
--  2. `invoke_toth_sync` aceita um corpo extra. `organization_id` é aplicado
--     POR ÚLTIMO no merge: quem agenda não consegue apontar para outro tenant.
--  3. Job `toth-sync-cobrancas-full-diario`: 10 disparos entre 05:00 e 06:55
--     UTC (02:00–03:55 BRT). A volta precisa de ~5 (12,6 mil clientes / 3.000);
--     10 dão folga para a base dobrar e para uma queda do ERP no meio. Depois
--     que a volta fecha, os disparos de sobra saem sem tocar no ERP
--     (`daily: true`). Minutos 0/10/20/45/55 desviam do sync de janela (:15 em
--     hora par) e do de clientes (:31 de hora em hora em prod) — o alvo é o
--     servidor de uma empresa só.

ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS cobrancas_full_cursor uuid,
  ADD COLUMN IF NOT EXISTS last_cobrancas_full_sweep_at timestamptz;

COMMENT ON COLUMN public.toth_connections.cobrancas_full_cursor IS
  'Cursor (upsell_clients.id) da varredura completa de cobranças, sem janela. NULL = volta fechada ou não iniciada. Independente de cobrancas_cursor (sync de janela).';
COMMENT ON COLUMN public.toth_connections.last_cobrancas_full_sweep_at IS
  'Quando a última volta completa de cobranças (full) terminou. O cron diário pula se < 20h e o cursor full estiver NULL.';

-- Assinatura muda (p_body): DROP + CREATE. Com as duas versões convivendo,
-- `invoke_toth_sync('x')` dos jobs existentes ficaria ambíguo.
DROP FUNCTION IF EXISTS public.invoke_toth_sync(TEXT);

CREATE FUNCTION public.invoke_toth_sync(p_fn TEXT, p_body JSONB DEFAULT '{}'::jsonb)
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
  -- pelo corpo quando vem por cron, e nunca por outro caminho. O
  -- `organization_id` entra por ÚLTIMO no merge, então p_body não o sobrepõe.
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
      body    := COALESCE(p_body, '{}'::jsonb)
                 || jsonb_build_object('organization_id', v_org.organization_id)
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

COMMENT ON FUNCTION public.invoke_toth_sync(TEXT, JSONB) IS
  'Dispara uma sincronização do Toth por organização conectada, com corpo extra opcional (organization_id sempre do banco). Resolve a URL a partir do cron_config do próprio ambiente.';

REVOKE ALL     ON FUNCTION public.invoke_toth_sync(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT, JSONB) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT, JSONB) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('toth-sync-cobrancas-full-diario')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toth-sync-cobrancas-full-diario');

    PERFORM cron.schedule(
      'toth-sync-cobrancas-full-diario', '0,10,20,45,55 5,6 * * *',
      $cron$SELECT public.invoke_toth_sync('toth-sync-cobrancas', '{"full":true,"daily":true}'::jsonb);$cron$
    );
  END IF;
END $$;
