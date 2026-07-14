-- ============================================================================
-- Janela de envio automático (quiet-hours) por organização
--
-- Problema (feedback Sorvfoods, 2026-07-14): automações (copilot outbound,
-- workflow, campanha, disparo) enviavam texto/áudio 2h-3h da madrugada. Cliente
-- que recebe áudio de madrugada denuncia/bloqueia — dano de marca ativo.
--
-- Solução: janela de horário permitido por org. Envios AUTOMÁTICOS fora da
-- janela são adiados (reagendados) para a próxima abertura. Envio MANUAL de
-- humano NUNCA é bloqueado (o guard só atua sobre trackSource automático).
--
-- Convenção de dias: 0=domingo … 6=sábado (JS getUTCDay / weekday), idêntica ao
-- QuietWindow de quick-blast/quiet-hours.ts, reusado pelo guard.
-- Janela é meio-aberta [from, to): envio às 08:00 vale, às 21:00 não.
-- Timezone: reutiliza organizations.timezone (já validado contra
-- pg_timezone_names — migration 20270302000000). Não duplica fuso.
--
-- Default ON conservador: 08:00-21:00, todos os dias. Aplica às orgs existentes
-- no ADD COLUMN. Opt-out por org via auto_send_window_enabled=false.
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_send_window_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_send_window_from_minutes smallint NOT NULL DEFAULT 480,   -- 08:00
  ADD COLUMN IF NOT EXISTS auto_send_window_to_minutes   smallint NOT NULL DEFAULT 1260,  -- 21:00
  ADD COLUMN IF NOT EXISTS auto_send_window_days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

-- Bounds: minutos no dia [0, 1440], janela não-vazia (from < to), dias válidos 0..6.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_auto_send_window_bounds'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_auto_send_window_bounds CHECK (
        auto_send_window_from_minutes >= 0
        AND auto_send_window_from_minutes <= 1440
        AND auto_send_window_to_minutes  >= 0
        AND auto_send_window_to_minutes  <= 1440
        AND auto_send_window_from_minutes < auto_send_window_to_minutes
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_auto_send_window_days_valid'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_auto_send_window_days_valid CHECK (
        auto_send_window_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
      );
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.auto_send_window_enabled IS
  'Se true, envios automáticos (copilot/workflow/campanha/disparo) fora da janela são adiados p/ próxima abertura. Envio manual de humano nunca é afetado.';
COMMENT ON COLUMN public.organizations.auto_send_window_from_minutes IS
  'Abertura da janela de envio automático, minutos desde 00:00 no fuso da org (organizations.timezone). 480 = 08:00.';
COMMENT ON COLUMN public.organizations.auto_send_window_to_minutes IS
  'Fecho (exclusivo) da janela de envio automático, minutos desde 00:00. 1260 = 21:00.';
COMMENT ON COLUMN public.organizations.auto_send_window_days IS
  'Dias permitidos p/ envio automático. 0=domingo … 6=sábado.';
