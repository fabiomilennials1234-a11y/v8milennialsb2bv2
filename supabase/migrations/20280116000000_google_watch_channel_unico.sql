-- ════════════════════════════════════════════════════════════════════════════
-- Google Calendar: no máximo 1 watch channel ATIVO por (user_id, calendar_id)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Incidente 2026-11-16 (prod travou às 09:10 BRT, 24 mil req REST em 5 min):
-- o webhook renovava o canal a partir de QUALQUER notificação perto da
-- expiração, e a renovação criava um canal novo sem desativar o antigo.
-- Com N canais vivos, 1 mudança na agenda gerava N webhooks, e cada um criava
-- mais um canal — crescimento exponencial (um usuário chegou a 3.108 canais).
--
-- Este arquivo fecha a causa-raiz no banco (só schema, nenhum DML):
--   1. Índice único parcial: é impossível existir 2 ativas para o mesmo par.
--      Se houver duplicata ativa, o CREATE INDEX FALHA ALTO — de propósito:
--      dado se corrige em operação explícita, nunca escondido em migration.
--      Em prod (2026-11-16, pós-contenção) há exatamente 1 ativa por par.
--   2. replace_google_watch_channel: troca atômica do canal ativo.
--        • p_expected_old_channel_id NÃO nulo (renovação pelo webhook):
--          compare-and-swap. Só quem desativa o canal esperado insere o novo.
--          N notificações concorrentes do mesmo canal → 1 vencedor.
--        • p_expected_old_channel_id nulo (conexão/reconexão OAuth):
--          desativa todas as ativas do par e insere a nova.
--      Retorna {won, stopped[]}: o chamador para no Google os canais em
--      `stopped` (se venceu) ou o canal que acabou de criar (se perdeu).
--
-- Segurança: SECURITY INVOKER + user_id/org_id por parâmetro ⇒ executável
-- SOMENTE por service_role (as edge functions chamadoras usam service_role).
-- Função nova nasce executável por PUBLIC/anon/authenticated — revogado abaixo.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. No máximo 1 canal ativo por (user_id, calendar_id) ───────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_watch_channels_active_user_calendar
  ON public.google_calendar_watch_channels (user_id, calendar_id)
  WHERE is_active;

-- 2. Troca atômica do canal ativo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.replace_google_watch_channel(
  p_user_id                 uuid,
  p_org_id                  uuid,
  p_calendar_id             text,
  p_channel_id              text,
  p_resource_id             text,
  p_expiration              timestamptz,
  p_expected_old_channel_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stopped jsonb;
  v_count   integer;
BEGIN
  -- O bloco com EXCEPTION é uma subtransação: se o INSERT colidir no índice
  -- parcial (corrida residual), a desativação feita aqui também é desfeita —
  -- o canal ativo de quem venceu fica intacto.
  BEGIN
    IF p_expected_old_channel_id IS NOT NULL THEN
      -- Renovação: compare-and-swap no canal esperado. Sob READ COMMITTED, o
      -- segundo UPDATE concorrente espera o lock da linha, reavalia `is_active`
      -- (já false) e não afeta nada ⇒ perde.
      WITH stopped AS (
        UPDATE public.google_calendar_watch_channels
           SET is_active = false
         WHERE channel_id  = p_expected_old_channel_id
           AND user_id     = p_user_id
           AND calendar_id = p_calendar_id
           AND is_active
        RETURNING channel_id, resource_id
      )
      SELECT coalesce(
               jsonb_agg(jsonb_build_object('channel_id', channel_id, 'resource_id', resource_id)),
               '[]'::jsonb
             ),
             count(*)
        INTO v_stopped, v_count
        FROM stopped;

      IF v_count = 0 THEN
        -- Outro processo já renovou (ou o canal já não é o ativo).
        RETURN jsonb_build_object('won', false, 'stopped', '[]'::jsonb);
      END IF;
    ELSE
      -- Conexão/reconexão OAuth: substitui todas as ativas do par.
      WITH stopped AS (
        UPDATE public.google_calendar_watch_channels
           SET is_active = false
         WHERE user_id     = p_user_id
           AND calendar_id = p_calendar_id
           AND is_active
        RETURNING channel_id, resource_id
      )
      SELECT coalesce(
               jsonb_agg(jsonb_build_object('channel_id', channel_id, 'resource_id', resource_id)),
               '[]'::jsonb
             )
        INTO v_stopped
        FROM stopped;
    END IF;

    INSERT INTO public.google_calendar_watch_channels (
      user_id, organization_id, channel_id, resource_id, calendar_id, expiration, is_active
    ) VALUES (
      p_user_id, p_org_id, p_channel_id, p_resource_id, p_calendar_id, p_expiration, true
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('won', false, 'stopped', '[]'::jsonb);
  END;

  RETURN jsonb_build_object('won', true, 'stopped', v_stopped);
END;
$$;

COMMENT ON FUNCTION public.replace_google_watch_channel(uuid, uuid, text, text, text, timestamptz, text) IS
  'Troca atômica do watch channel ativo do Google Calendar por (user_id, calendar_id). '
  'Com p_expected_old_channel_id: compare-and-swap (renovação). Sem: substitui todas (OAuth). '
  'Retorna {won, stopped[]}; o chamador para no Google os canais em stopped, ou o novo se won=false. '
  'Somente service_role (user/org por parâmetro).';

REVOKE ALL ON FUNCTION public.replace_google_watch_channel(uuid, uuid, text, text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_google_watch_channel(uuid, uuid, text, text, text, timestamptz, text)
  TO service_role;
