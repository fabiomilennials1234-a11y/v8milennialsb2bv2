-- ============================================================
-- runtime_logs: retenção diferenciada por módulo.
--
-- Situação encontrada em produção: TRÊS políticas contraditórias.
--
--   cleanup_runtime_logs_90d   */10 * * * *   apagava em 14 dias  (nome mente)
--   purge-runtime-logs-2d      0 4 * * *      apaga em 2 dias     (esta vence)
--
-- Efeito: a tabela inteira eram os últimos 2 dias. Isso mata a premissa do
-- ADR-0017 e do Chamado (ADR-0018): o suporte abre um Chamado e consulta
-- `runtime_logs WHERE session_id = X` para reconstruir o que o backend fez.
-- Um chamado aberto na sexta e triado na segunda encontraria a tabela vazia —
-- exatamente no caso em que a correlação mais serve.
--
-- Também não dá para simplesmente esticar tudo: `webhook` é 98% do volume
-- (~105 mil linhas/dia contra ~2 mil de todo o resto somado). Reter 30 dias de
-- webhook seriam ~3,2 milhões de linhas e alguns GB, para um módulo cujo valor
-- diagnóstico decai em horas.
--
-- Política: webhook 2 dias, todo o resto 30 dias.
-- ============================================================

CREATE OR REPLACE FUNCTION public.purge_runtime_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- webhook: 98% do volume, valor diagnóstico curto.
  DELETE FROM public.runtime_logs
  WHERE ctid IN (
    SELECT ctid FROM public.runtime_logs
    WHERE module = 'webhook'
      AND created_at < now() - interval '2 days'
    LIMIT 50000
  );

  -- Todo o resto: precisa sobreviver ao tempo de vida de um Chamado.
  DELETE FROM public.runtime_logs
  WHERE ctid IN (
    SELECT ctid FROM public.runtime_logs
    WHERE module <> 'webhook'
      AND created_at < now() - interval '30 days'
    LIMIT 50000
  );
END;
$$;

COMMENT ON FUNCTION public.purge_runtime_logs() IS
  'Retenção de runtime_logs: webhook 2 dias, demais módulos 30 dias. Batches de 50k para não segurar lock. Ver migration 20270115010000.';

REVOKE ALL ON FUNCTION public.purge_runtime_logs() FROM PUBLIC, anon, authenticated;

-- Remove as duas políticas antigas e contraditórias.
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_runtime_logs_90d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-runtime-logs-2d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-runtime-logs',
  '*/10 * * * *',
  $$SELECT public.purge_runtime_logs()$$
);
