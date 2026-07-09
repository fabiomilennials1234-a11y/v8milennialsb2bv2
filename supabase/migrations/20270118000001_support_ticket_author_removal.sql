-- ============================================================
-- Chamado: o autor pode desaparecer.
--
-- `support_tickets.author_user_id` é `REFERENCES auth.users(id) ON DELETE SET
-- NULL` — de propósito: o Chamado pertence à Organização e sobrevive ao
-- funcionário que deixou a empresa (ADR-0018).
--
-- Só que um `ON DELETE SET NULL` é executado pelo Postgres como um UPDATE na
-- tabela referenciadora, e um UPDATE dispara `enforce_support_ticket_write_rules`.
-- A guarda "dono e autor de um chamado nao mudam" via `author_user_id` mudando e
-- levantava exceção — **deletar o usuário falhava**.
--
-- Descoberto por uma sonda em produção, antes de existir o primeiro chamado.
--
-- A guarda passa a permitir exatamente uma transição: autor → NULL. Trocar o
-- autor por OUTRO usuário continua proibido; é isso que a guarda existe para
-- impedir.
-- ============================================================

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

  -- O autor pode virar NULL (a conta dele foi removida; o FK e' ON DELETE SET
  -- NULL). Trocá-lo por OUTRO usuário, não.
  --
  -- Isto não abre uma porta para o cliente se apagar do próprio chamado: a
  -- policy de UPDATE tem `WITH CHECK (author_user_id = auth.uid() OR admin da
  -- org)`, e `NULL = auth.uid()` é falso — a RLS recusa antes de chegar aqui. O
  -- `SET NULL` do FK roda como dono da tabela, por cima da RLS, e é justamente
  -- esse caminho que se libera.
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
    -- `now()` é o instante da TRANSAÇÃO, não do relógio de parede. Abrir e
    -- fechar a janela na mesma transação acumula zero — correto: nenhum tempo
    -- real passou para o cliente. Cada mudança de status vem numa requisição
    -- própria, logo numa transação própria.
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
      NEW.reopen_count := OLD.reopen_count + 1;
      NEW.resolved_at := NULL;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_support_ticket_write_rules() FROM PUBLIC, anon, authenticated;
