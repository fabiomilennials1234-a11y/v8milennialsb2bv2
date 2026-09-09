-- Limpeza e medição de Aviso. Issue #1894, ADR-0035.
--
-- Duas coisas que nascem juntas porque respondem à mesma pergunta — "isto está
-- saudável?" — por ângulos opostos: uma impede a tabela de crescer para sempre,
-- a outra diz se estamos fazendo barulho demais.
--
-- Aviso é efêmero por natureza. Quem não leu em seis meses não vai ler, e o
-- histórico que importa já vive em lead_history e meeting_events.
--
-- O DELETE roda em LOTES por um motivo mecânico, não estético: `notifications`
-- está na publicação de realtime, e apagar milhares de linhas de uma vez vira
-- uma enxurrada de eventos para todos os navegadores conectados — o oposto do
-- que uma limpeza deveria causar.

CREATE OR REPLACE FUNCTION public.fn_limpar_avisos(
  p_lote       integer DEFAULT 500,
  p_max_lotes  integer DEFAULT 40,
  p_prazo_lido    interval DEFAULT interval '90 days',
  p_prazo_nao_lido interval DEFAULT interval '180 days'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apagados integer := 0;
  v_no_lote  integer;
  v_lote     integer := 0;
BEGIN
  LOOP
    v_lote := v_lote + 1;
    EXIT WHEN v_lote > p_max_lotes;

    WITH alvo AS (
      SELECT ctid
        FROM public.notifications
       WHERE (read_at IS NOT NULL AND created_at < now() - p_prazo_lido)
          -- Quem ainda não viu não perde o registro pelo prazo de quem viu.
          OR (read_at IS NULL AND created_at < now() - p_prazo_nao_lido)
       LIMIT p_lote
    )
    DELETE FROM public.notifications n
     USING alvo
     WHERE n.ctid = alvo.ctid;

    GET DIAGNOSTICS v_no_lote = ROW_COUNT;
    v_apagados := v_apagados + v_no_lote;

    -- Nada mais a apagar: sai antes de gastar o teto de lotes à toa.
    EXIT WHEN v_no_lote < p_lote;
  END LOOP;

  RETURN v_apagados;
END;
$$;

COMMENT ON FUNCTION public.fn_limpar_avisos IS
  'Apaga Avisos lidos com mais de 90 dias e não lidos com mais de 180, em lotes (#1894). Interrompível: a passada seguinte continua de onde parou.';

REVOKE ALL ON FUNCTION public.fn_limpar_avisos(integer, integer, interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_limpar_avisos(integer, integer, interval, interval) TO service_role;

-- A medição. Sem ela, "estamos fazendo barulho demais?" só tem resposta
-- anedótica — e a correção certa (apertar o produtor) fica indistinguível da
-- errada (pedir ao usuário que silencie).
CREATE OR REPLACE FUNCTION public.fn_medicao_de_ruido(p_dias integer DEFAULT 7)
RETURNS TABLE (
  dia             date,
  organization_id uuid,
  user_id         uuid,
  type            text,
  avisos          bigint,
  eventos         bigint,
  lidos           bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT date_trunc('day', timezone('America/Sao_Paulo', n.created_at))::date AS dia,
         n.organization_id,
         n.user_id,
         n.type,
         count(*)                                   AS avisos,
         -- Eventos absorvidos: um Aviso com contador 12 pesou muito mais na
         -- atenção da pessoa do que doze Avisos separados teriam pesado.
         sum(n.event_count)                         AS eventos,
         count(*) FILTER (WHERE n.read_at IS NOT NULL) AS lidos
    FROM public.notifications n
   WHERE n.created_at > now() - make_interval(days => p_dias)
   GROUP BY 1, 2, 3, 4;
$$;

COMMENT ON FUNCTION public.fn_medicao_de_ruido IS
  'Avisos por dia, organização, pessoa e tipo (#1894). Acima de ~40 por vendedor por dia, o recorte está errado e a correção é no produtor.';

-- Pico por hora: o número que diz se o canal quente está tolerável. Cartão é
-- coisa de tela e não deixa rastro no banco — o que se mede aqui é o Aviso
-- QUENTE, que é o que teria virado cartão. É proxy, e proxy declarado.
CREATE OR REPLACE FUNCTION public.fn_pico_de_avisos_quentes(p_dias integer DEFAULT 7)
RETURNS TABLE (
  organization_id uuid,
  user_id         uuid,
  hora            timestamptz,
  quentes         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.organization_id,
         n.user_id,
         date_trunc('hour', n.created_at) AS hora,
         count(*) AS quentes
    FROM public.notifications n
   WHERE n.created_at > now() - make_interval(days => p_dias)
     AND n.type IN ('lead_message', 'transfer_to_human', 'lead_new', 'workflow_alert', 'cron_drift')
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC;
$$;

COMMENT ON FUNCTION public.fn_pico_de_avisos_quentes IS
  'Avisos do canal quente por hora e por pessoa (#1894). Proxy do pico de cartões, que não deixa rastro no banco.';

REVOKE ALL ON FUNCTION public.fn_medicao_de_ruido(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pico_de_avisos_quentes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_medicao_de_ruido(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_pico_de_avisos_quentes(integer) TO service_role;

-- Domingo, 04h de São Paulo. Semanal porque diário seria varrer o mesmo vazio
-- seis vezes por semana: o volume que vence os prazos é pequeno e constante.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('avisos-limpeza-semanal')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisos-limpeza-semanal');
    PERFORM cron.schedule('avisos-limpeza-semanal', '0 7 * * 0',
                          'SELECT public.fn_limpar_avisos()');
  END IF;
END
$$;
