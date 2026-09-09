-- Produtor: reunião marcada vira Aviso. Issue #1885, ADR-0035.
--
-- O evento já existia: a ADR-0007 tornou a reserva de reunião um evento imutável
-- em meeting_events, e ninguém escutava. Não se pendura trigger no funil de
-- confirmação porque pipe_confirmacao é view de compatibilidade — trigger de
-- linha não vive em view.
--
-- Quem marcou não se notifica. O evento de reunião não registra autor (medido
-- em produção: metadata vazio na esmagadora maioria), então o ator vem da
-- sessão. Ação vinda de cron ou service_role não tem sessão: aí o Aviso sai,
-- que é o comportamento certo — ninguém foi avisado presencialmente.

CREATE OR REPLACE FUNCTION public.fn_aviso_de_reuniao_marcada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dono  uuid;
  v_ator  uuid;
  v_lead  record;
BEGIN
  IF NEW.event_type <> 'meeting_booked' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_dono := public.fn_dono_do_lead(NEW.lead_id);
  IF v_dono IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_ator := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_ator := NULL;
  END;

  IF v_ator IS NOT NULL AND v_ator = v_dono THEN
    RETURN NEW;
  END IF;

  SELECT name, company INTO v_lead FROM public.leads WHERE id = NEW.lead_id;

  PERFORM public.fn_emit_aviso(
    p_organization_id => NEW.organization_id,
    p_user_id         => v_dono,
    p_type            => 'meeting_booked',
    p_group_key       => 'meet:' || NEW.lead_id::text,
    p_title           => 'Reunião marcada',
    p_description     => NULLIF(concat_ws(' · ',
                           NULLIF(v_lead.name, ''),
                           NULLIF(v_lead.company, ''),
                           to_char(NEW.meeting_date AT TIME ZONE 'America/Sao_Paulo',
                                   'DD/MM "às" HH24"h"MI')), ''),
    p_link            => '/pipe-confirmacao',
    p_lead_id         => NEW.lead_id,
    p_entity_id       => NEW.id,
    p_occurred_at     => COALESCE(NEW.occurred_at, now())
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_aviso_de_reuniao_marcada IS
  'Reserva de reunião (meeting_events) vira Aviso para o dono do Lead (#1885). Quem marcou não se notifica.';

DROP TRIGGER IF EXISTS trg_aviso_de_reuniao_marcada ON public.meeting_events;
CREATE TRIGGER trg_aviso_de_reuniao_marcada
  AFTER INSERT ON public.meeting_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_aviso_de_reuniao_marcada();
