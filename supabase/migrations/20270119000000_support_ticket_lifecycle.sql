-- ============================================================
-- Chamado: a máquina de estados, e o fechamento automático.
--
--   aberto → em_andamento → aguardando_cliente → resolvido → fechado
--
-- (1) O buraco que isto fecha.
--
-- A RLS permite ao autor dar UPDATE no próprio chamado — ele precisa, para
-- reabrir e para responder. O trigger protegia `tipo`, `severidade`, atribuição
-- e o relógio, mas **não validava `status`**. Até aqui, um cliente podia mandar
-- `status = 'em_andamento'` (fingindo que alguém já estava olhando) ou
-- `status = 'fechado'` (matando o próprio chamado antes de ser lido).
--
-- A partir de agora o cliente só pode uma coisa: reabrir um chamado resolvido.
--
-- (2) `fechado` é terminal.
--
-- Nem o cliente reabre, nem o staff reabre, nem o cron toca. Depois da janela, o
-- caminho é abrir um chamado novo. E `fechado` chega **só** pelo cron: o staff
-- marca `resolvido`, que é a alegação de conserto, e o silêncio do cliente por
-- 7 dias é o que a confirma.
--
-- (3) `reopen_count`.
--
-- Reabrir não é um estado: volta a `aberto` e soma. Um Chamado reaberto três
-- vezes é evidência de que a correção nunca pegou — o sinal precisa acumular.
-- Antes, o incremento também aceitava `fechado → aberto`; não aceita mais.
--
-- A máquina de estados espelha `src/modules/platform/lib/ticket-lifecycle.ts`.
-- Duas cópias da mesma regra é o preço de a regra existir dos dois lados; o
-- banco é o que vale.
--
-- Verificado em produção por sondas em transação revertida: o cliente é recusado
-- ao tentar `em_andamento`, `fechado` e `resolvido`; reabrir um resolvido é
-- aceito e soma `reopen_count`, limpando `resolved_at`; `fechado` recusa
-- qualquer saída; o cron fecha um resolvido de 8 dias e poupa o de 6.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_write_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- O autor pode virar NULL (a conta foi removida; o FK é ON DELETE SET NULL).
  -- Trocá-lo por OUTRO usuário, não. Ver migration 20270118000001.
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

  -- ── Máquina de estados ──────────────────────────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status THEN

    IF OLD.status = 'fechado' THEN
      RAISE EXCEPTION 'chamado fechado e terminal: abra um novo' USING ERRCODE = 'check_violation';
    END IF;

    -- Só o banco fecha, e só o que já estava resolvido.
    IF NEW.status = 'fechado' THEN
      IF NOT is_internal THEN
        RAISE EXCEPTION 'o fechamento e automatico, % dias apos resolvido', 7 USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status <> 'resolvido' THEN
        RAISE EXCEPTION 'so um chamado resolvido fecha sozinho' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- O cliente só reabre.
    IF NOT is_staff AND NOT is_internal THEN
      IF NOT (OLD.status = 'resolvido' AND NEW.status = 'aberto') THEN
        RAISE EXCEPTION 'o cliente so pode reabrir um chamado resolvido' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Contabilidade da janela de espera.
    IF NEW.status = 'aguardando_cliente' THEN
      NEW.awaiting_since := now();
    ELSIF OLD.status = 'aguardando_cliente' AND OLD.awaiting_since IS NOT NULL THEN
      -- `now()` é o instante da TRANSAÇÃO, não do relógio de parede: abrir e
      -- fechar a janela na mesma transação acumula zero, o que é correto.
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
$$;

REVOKE ALL ON FUNCTION public.enforce_support_ticket_write_rules() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Fechamento automático: 7 dias de silêncio confirmam o conserto.
--
-- SQL puro num cron, e não uma edge function: não há nada para chamar fora do
-- banco, e uma edge function a mais é um segredo a mais para rotacionar.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_resolved_support_tickets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fechados INTEGER;
BEGIN
  PERFORM set_config('torque.support_clock', 'on', true);

  WITH alvo AS (
    SELECT id FROM public.support_tickets
     WHERE status = 'resolvido'
       AND resolved_at IS NOT NULL
       AND resolved_at < now() - interval '7 days'
     LIMIT 1000
  )
  UPDATE public.support_tickets t
     SET status = 'fechado'
    FROM alvo
   WHERE t.id = alvo.id;

  GET DIAGNOSTICS fechados = ROW_COUNT;

  PERFORM set_config('torque.support_clock', 'off', true);

  RETURN fechados;
END;
$$;

COMMENT ON FUNCTION public.close_resolved_support_tickets() IS
  'Fecha os chamados resolvidos ha mais de 7 dias. Lotes de 1000. Ver ADR-0018.';

REVOKE ALL ON FUNCTION public.close_resolved_support_tickets() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('close-resolved-support-tickets');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'close-resolved-support-tickets',
  '20 4 * * *',
  $$SELECT public.close_resolved_support_tickets()$$
);
