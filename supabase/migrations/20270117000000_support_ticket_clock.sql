-- ============================================================
-- Chamado: os carimbos que só o banco pode garantir.
--
-- (1) `first_response_at` — quando o suporte respondeu pela primeira vez.
--
-- Carimbado por trigger, não pelo cliente que faz o INSERT. Um `update` vindo
-- do console poderia ser esquecido, atrasado ou disparado duas vezes; o momento
-- da primeira resposta é um fato do banco.
--
-- A condição é `is_master_user(NEW.author_user_id)`: um comentário público de um
-- admin da Organização não é resposta do suporte. A função aceita o usuário como
-- parâmetro — depender de `auth.uid()` amarraria o carimbo a quem está logado, e
-- não a quem escreveu.
--
-- (2) `awaiting_since` / `awaiting_customer_ms` — o relógio que para.
--
-- Enquanto o Chamado está em `aguardando_cliente`, o tempo não conta contra o
-- suporte. Sem isso, um chamado em que o cliente sumiu por uma semana apareceria
-- como "staff demorou 7 dias": a métrica mente, o time perde a confiança nela e
-- para de olhar. É assim que dashboard de suporte morre.
--
-- A acumulação vive junto da transição de status, não na camada que calcula a
-- meta (ADR-0018). O cálculo é derivado; a janela é um fato.
--
-- (3) Os campos do relógio são do banco. Nem cliente nem staff os escrevem.
--
-- A RLS permite ao autor dar UPDATE no próprio chamado (para reabrir e para
-- responder). Sem esta guarda, ele poderia carimbar `first_response_at` e fingir
-- que já foi atendido, ou zerar `awaiting_customer_ms`. A guarda é suspensa por
-- um flag de transação que só os triggers deste arquivo levantam.
-- ============================================================

-- ------------------------------------------------------------
-- Escotilha: os triggers do banco escrevem o relógio; ninguém mais.
-- `set_config(..., true)` é local à transação — não vaza para a conexão.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_clock_is_internal()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('torque.support_clock', true), '') = 'on';
$$;

REVOKE ALL ON FUNCTION public.support_clock_is_internal() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.stamp_support_ticket_first_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_internal THEN
    RETURN NEW;  -- nota interna não é resposta ao cliente
  END IF;

  IF NOT public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;  -- o cliente respondendo a si mesmo não é primeira resposta
  END IF;

  PERFORM set_config('torque.support_clock', 'on', true);

  UPDATE public.support_tickets
  SET first_response_at = NEW.created_at
  WHERE id = NEW.ticket_id
    AND first_response_at IS NULL;

  PERFORM set_config('torque.support_clock', 'off', true);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_support_ticket_first_response() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_support_ticket_first_response
  AFTER INSERT ON public.support_ticket_comments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_support_ticket_first_response();

-- ------------------------------------------------------------
-- Regras de escrita: acrescenta a guarda do relógio e a contabilidade da espera.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_support_ticket_write_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_staff BOOLEAN := public.is_master_user();
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
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id THEN
      RAISE EXCEPTION 'dono e autor de um chamado nao mudam' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- O relógio é do banco. Vale inclusive para o staff.
  IF NOT public.support_clock_is_internal() THEN
    IF NEW.first_response_at    IS DISTINCT FROM OLD.first_response_at
       OR NEW.resolved_at       IS DISTINCT FROM OLD.resolved_at
       OR NEW.awaiting_since    IS DISTINCT FROM OLD.awaiting_since
       OR NEW.awaiting_customer_ms IS DISTINCT FROM OLD.awaiting_customer_ms
       OR NEW.reopen_count      IS DISTINCT FROM OLD.reopen_count THEN
      RAISE EXCEPTION 'o relogio de um chamado e mantido pelo banco' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
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

    ELSIF NEW.status = 'aberto' AND OLD.status IN ('resolvido', 'fechado') THEN
      -- Reabrir não é um estado: volta a `aberto` e o contador acumula. Um
      -- Chamado reaberto três vezes é evidência de que a correção nunca pegou,
      -- e esse sinal precisa somar, não ser sobrescrito.
      NEW.reopen_count := OLD.reopen_count + 1;
      NEW.resolved_at := NULL;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_support_ticket_write_rules() FROM PUBLIC, anon, authenticated;
