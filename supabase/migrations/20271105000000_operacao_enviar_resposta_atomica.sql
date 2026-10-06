-- Operação (Área Dev): "ir para Aguardando confirmação envia a resposta ao
-- cliente" (regra OP-9 do board das 5 centrais).
--
-- Dois fatos que só fazem sentido juntos: o comentário público com a resposta
-- pronta do diagnóstico E o status `resolvido`. Feitos em duas chamadas do
-- front, uma falha no meio deixa ou um chamado resolvido sem resposta (o
-- cliente vê "Resolvido" e nada mais) ou uma resposta enviada com o chamado
-- ainda em andamento (e o relógio de 7 dias nunca começa). Aqui é uma
-- transação só.
--
-- SECURITY INVOKER de propósito: roda com a RLS e os triggers do próprio
-- master. `enforce_support_ticket_write_rules` continua sendo a autoridade
-- sobre a transição de status; `stamp_support_ticket_first_response` e
-- `notify_support_ticket_reply` disparam como num comentário feito pela tela.
BEGIN;

CREATE OR REPLACE FUNCTION public.master_ticket_send_reply(p_ticket_id uuid)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reply  text;
  v_status public.support_ticket_status;
  v_ticket public.support_tickets;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'apenas o suporte envia a resposta' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR UPDATE: dois atendentes arrastando o mesmo cartão não mandam duas respostas.
  SELECT status INTO v_status FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chamado nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'em_andamento' THEN
    RAISE EXCEPTION 'so um chamado em andamento recebe a resposta (status atual: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT btrim(customer_reply) INTO v_reply
    FROM public.support_ticket_diagnoses WHERE ticket_id = p_ticket_id;
  IF v_reply IS NULL OR v_reply = '' THEN
    RAISE EXCEPTION 'sem resposta pronta para o cliente no diagnostico' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.support_ticket_comments (ticket_id, author_user_id, body, is_internal, from_staff)
  VALUES (p_ticket_id, auth.uid(), v_reply, false, true);

  UPDATE public.support_tickets SET status = 'resolvido'
   WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

COMMENT ON FUNCTION public.master_ticket_send_reply(uuid) IS
  'OP-9: envia o customer_reply do diagnostico como comentario publico e marca o chamado como resolvido, '
  'na mesma transacao. So master; exige status em_andamento e resposta pronta.';

REVOKE ALL ON FUNCTION public.master_ticket_send_reply(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_ticket_send_reply(uuid) TO authenticated;

COMMIT;
