-- Rollback of 20271108000300_operacao_movimento_livre_master.sql.
-- Drops the free-move RPC and restores enforce_support_ticket_write_rules to the
-- prod definition read on 2026-10-07 (identical to the baseline).
-- NOT reverted: status/closed_at/resolved_at already written by moves (audit
-- trail of each move stays in master_audit_logs, action SUPPORT_TICKET_MOVE).
-- After rollback, the front's drag calls master_ticket_move and fails: roll the
-- front back first.
BEGIN;

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.master_ticket_move(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_write_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_staff    BOOLEAN := public.is_master_user();
  is_internal BOOLEAN := public.support_clock_is_internal();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.severidade IS NOT NULL AND NOT is_staff THEN
      RAISE EXCEPTION 'severidade e definida pelo suporte, nao pelo cliente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.defect_url IS NOT NULL AND NOT is_staff THEN
      RAISE EXCEPTION 'defect_url e definida pelo suporte' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.support_context IS DISTINCT FROM OLD.support_context THEN
    RAISE EXCEPTION 'support_context e imutavel' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     AND NEW.author_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'o autor de um chamado nao muda' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'o dono de um chamado nao muda' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT is_staff THEN
    IF NEW.severidade IS DISTINCT FROM OLD.severidade THEN
      RAISE EXCEPTION 'severidade e definida pelo suporte, nao pelo cliente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
      RAISE EXCEPTION 'a triagem do tipo e do suporte' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.defect_url IS DISTINCT FROM OLD.defect_url THEN
      RAISE EXCEPTION 'defect_url e definida pelo suporte' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.assigned_master_user_id IS DISTINCT FROM OLD.assigned_master_user_id THEN
      RAISE EXCEPTION 'atribuicao e do suporte' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT is_internal THEN
    IF NEW.first_response_at    IS DISTINCT FROM OLD.first_response_at
       OR NEW.resolved_at       IS DISTINCT FROM OLD.resolved_at
       OR NEW.awaiting_since    IS DISTINCT FROM OLD.awaiting_since
       OR NEW.awaiting_customer_ms IS DISTINCT FROM OLD.awaiting_customer_ms
       OR NEW.reopen_count      IS DISTINCT FROM OLD.reopen_count THEN
      RAISE EXCEPTION 'o relogio de um chamado e mantido pelo banco' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN

    IF OLD.status = 'fechado' THEN
      RAISE EXCEPTION 'chamado fechado e terminal: abra um novo' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'fechado' THEN
      IF NOT is_internal THEN
        RAISE EXCEPTION 'o fechamento e automatico, 7 dias apos resolvido' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status <> 'resolvido' THEN
        RAISE EXCEPTION 'so um chamado resolvido fecha sozinho' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NOT is_staff AND NOT is_internal THEN
      IF NOT (OLD.status = 'resolvido' AND NEW.status = 'aberto') THEN
        RAISE EXCEPTION 'o cliente so pode reabrir um chamado resolvido' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.status = 'aguardando_cliente' THEN
      NEW.awaiting_since := now();
    ELSIF OLD.status = 'aguardando_cliente' AND OLD.awaiting_since IS NOT NULL THEN
      NEW.awaiting_customer_ms :=
        OLD.awaiting_customer_ms
        + (EXTRACT(EPOCH FROM (now() - OLD.awaiting_since)) * 1000)::BIGINT;
      NEW.awaiting_since := NULL;
    END IF;

    IF NEW.status = 'resolvido' AND OLD.status <> 'resolvido' THEN
      NEW.resolved_at := now();
    ELSIF NEW.status = 'aberto' AND OLD.status = 'resolvido' THEN
      NEW.reopen_count := OLD.reopen_count + 1;
      NEW.resolved_at := NULL;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_support_ticket_write_rules() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_support_ticket_write_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_support_ticket_write_rules() TO service_role;

COMMIT;
