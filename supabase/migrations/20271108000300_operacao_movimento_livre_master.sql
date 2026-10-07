-- Operação (Área Dev): movimento livre do master no kanban de Chamados.
--
-- Pedido do CTO (2026-10-07): "no kanban de operação, liberdade de alterar a
-- coluna dos cards de forma livre e assim mudar o estado — ex.: marcar um
-- chamado como concluído". Emenda ao ADR-0018 (docs/adr/0018-chamado-in-house-support-desk.md).
--
-- O que muda:
--   1. `master_ticket_move(ticket, coluna, send_reply)` — a ÚNICA porta para o
--      movimento livre. Só master. Auditada em `master_audit_logs`.
--   2. `enforce_support_ticket_write_rules` reconhece o "movimento deliberado do
--      staff" por uma variável LOCAL da transação (`torque.support_staff_move`)
--      que a RPC liga — e que o gatilho só enxerga quando `is_master_user()` é
--      verdadeiro. Um não-master que consiga ligar a variável não ganha nada.
--
-- O que NÃO muda:
--   - Cliente: continua só reabrindo resolvido → aberto (e isso continua
--     contando reabertura, OP-10).
--   - UPDATE direto de status pelo master, fora da RPC: as mesmas regras de
--     hoje (não fecha na mão, fechado é terminal).
--   - Todas as outras regras do gatilho (support_context imutável, autor/org
--     imutáveis, triagem e atribuição só do staff, relógio mantido pelo banco).
--   - O cron `close_resolved_support_tickets` (resolvido há 7 dias → fechado).
--
-- Efeitos no relógio quando o movimento é do staff (decididos e documentados):
--   → resolvido    resolved_at = now() (reinicia a janela de 7 dias, inclusive
--                  vindo de fechado: reabrir para Resolvido não pode fechar de
--                  novo no próximo tique do cron)
--   → fechado      resolved_at = coalesce(resolved_at, now()); closed_at = now()
--   → aberto / em_andamento / aguardando_cliente
--                  resolved_at = NULL (voltou para o trabalho)
--   saindo de fechado: closed_at = NULL
--   reopen_count NUNCA incrementa — mover não é o cliente reabrindo.
--   awaiting_since / awaiting_customer_ms seguem a regra de sempre.
--
-- Endurecimento junto: `closed_at` entra na lista de colunas do relógio que só
-- o banco escreve (antes qualquer um com UPDATE na linha podia carimbá-la).
-- Quem a escreve: o cron (relógio interno) e este gatilho.
--
-- `support_tickets` é pequena: lock_timeout curto e CREATE OR REPLACE.
-- Rollback: supabase/migrations/rollback/20271108000300_operacao_movimento_livre_master.sql
BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─── 1. O gatilho ───────────────────────────────────────────────────────────
-- Cópia da definição de prod (lida em 2026-10-07, igual ao baseline) com o
-- mínimo alterado; cada alteração está marcada com "movimento livre".
CREATE OR REPLACE FUNCTION public.enforce_support_ticket_write_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_staff    BOOLEAN := public.is_master_user();
  is_internal BOOLEAN := public.support_clock_is_internal();
  -- movimento livre: só vale para master. Para qualquer outro, a variável é ruído.
  is_staff_move BOOLEAN := is_staff
    AND coalesce(current_setting('torque.support_staff_move', true), '') = 'on';
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
       OR NEW.reopen_count      IS DISTINCT FROM OLD.reopen_count
       -- movimento livre: closed_at também é relógio.
       OR NEW.closed_at         IS DISTINCT FROM OLD.closed_at THEN
      RAISE EXCEPTION 'o relogio de um chamado e mantido pelo banco' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN

    -- movimento livre: o master reabre um fechado pela RPC.
    IF OLD.status = 'fechado' AND NOT is_staff_move THEN
      RAISE EXCEPTION 'chamado fechado e terminal: abra um novo' USING ERRCODE = 'check_violation';
    END IF;

    -- movimento livre: o master fecha de qualquer estado pela RPC.
    IF NEW.status = 'fechado' AND NOT is_staff_move THEN
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

    IF is_staff_move THEN
      -- movimento livre: relógio de um movimento deliberado. Nunca conta reabertura.
      IF NEW.status = 'resolvido' THEN
        NEW.resolved_at := now();
      ELSIF NEW.status = 'fechado' THEN
        NEW.resolved_at := coalesce(OLD.resolved_at, now());
        NEW.closed_at := now();
      ELSE
        NEW.resolved_at := NULL;
      END IF;
      IF OLD.status = 'fechado' THEN
        NEW.closed_at := NULL;
      END IF;
    ELSIF NEW.status = 'resolvido' AND OLD.status <> 'resolvido' THEN
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

-- ─── 2. A porta ─────────────────────────────────────────────────────────────
-- SECURITY INVOKER como `master_ticket_send_reply`: roda com a RLS e os
-- gatilhos do próprio master. O gatilho continua sendo a autoridade.
CREATE OR REPLACE FUNCTION public.master_ticket_move(
  p_ticket_id  uuid,
  p_to_column  text,
  p_send_reply boolean DEFAULT false
)
RETURNS public.support_tickets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_master      uuid;
  v_cur         public.support_tickets;
  v_ticket      public.support_tickets;
  v_has_diag    boolean;
  v_reply       text;
  v_from_column text;
  v_to_status   public.support_ticket_status;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'apenas o suporte move chamados livremente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_to_column IS NULL
     OR p_to_column NOT IN ('aberto', 'diagnostico', 'andamento', 'aguardando', 'concluido') THEN
    RAISE EXCEPTION 'coluna desconhecida: %', p_to_column USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF coalesce(p_send_reply, false) AND p_to_column <> 'aguardando' THEN
    RAISE EXCEPTION 'so a ida para Aguardando confirmacao envia resposta' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id INTO v_master FROM public.master_users WHERE user_id = auth.uid() AND is_active;

  -- FOR UPDATE: dois atendentes arrastando o mesmo cartão não se atropelam.
  SELECT * INTO v_cur FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chamado nao encontrado' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT true, btrim(customer_reply) INTO v_has_diag, v_reply
    FROM public.support_ticket_diagnoses WHERE ticket_id = p_ticket_id;
  v_has_diag := coalesce(v_has_diag, false);

  -- Mesma derivação de `columnOf` (src/modules/identity/master/lib/operacao-kanban.ts).
  v_from_column := CASE v_cur.status
    WHEN 'fechado'            THEN 'concluido'
    WHEN 'resolvido'          THEN 'aguardando'
    WHEN 'aguardando_cliente' THEN 'aguardando'
    WHEN 'em_andamento'       THEN 'andamento'
    ELSE CASE WHEN v_has_diag THEN 'diagnostico' ELSE 'aberto' END
  END;

  IF v_from_column = p_to_column THEN
    RAISE EXCEPTION 'o chamado ja esta nessa etapa' USING ERRCODE = 'check_violation';
  END IF;

  v_to_status := CASE p_to_column
    WHEN 'aberto'      THEN 'aberto'
    WHEN 'diagnostico' THEN 'aberto'
    WHEN 'andamento'   THEN 'em_andamento'
    WHEN 'aguardando'  THEN 'resolvido'
    WHEN 'concluido'   THEN 'fechado'
  END::public.support_ticket_status;

  -- Chamado aberto ↔ Diagnóstico feito: o estado já é `aberto`; a coluna vem
  -- de existir diagnóstico, e nenhum UPDATE muda isso.
  IF v_to_status = v_cur.status THEN
    RAISE EXCEPTION 'a coluna vem do diagnostico registrado; o estado ja e %', v_cur.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(p_send_reply, false) THEN
    IF v_reply IS NULL OR v_reply = '' THEN
      RAISE EXCEPTION 'sem resposta pronta para o cliente no diagnostico' USING ERRCODE = 'check_violation';
    END IF;
    -- OP-9, como em `master_ticket_send_reply`: resposta pública + Resolvido na mesma transação.
    INSERT INTO public.support_ticket_comments (ticket_id, author_user_id, body, is_internal, from_staff)
    VALUES (p_ticket_id, auth.uid(), v_reply, false, true);
  END IF;

  PERFORM set_config('torque.support_staff_move', 'on', true);

  UPDATE public.support_tickets
     SET status = v_to_status,
         -- Ir para Em andamento sem dono é "pegar": o master que moveu assume.
         -- Dono existente nunca é sobrescrito.
         assigned_master_user_id = CASE
           WHEN v_to_status = 'em_andamento' THEN coalesce(assigned_master_user_id, v_master)
           ELSE assigned_master_user_id
         END
   WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  PERFORM set_config('torque.support_staff_move', 'off', true);

  -- Sem PII: nem título, nem texto da resposta.
  INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, details)
  VALUES (v_master, auth.uid(), 'SUPPORT_TICKET_MOVE', 'support_ticket', p_ticket_id,
          jsonb_build_object(
            'from_column', v_from_column,
            'to_column',   p_to_column,
            'from_status', v_cur.status,
            'to_status',   v_to_status,
            'send_reply',  coalesce(p_send_reply, false)
          ));

  RETURN v_ticket;
END;
$$;

COMMENT ON FUNCTION public.master_ticket_move(uuid, text, boolean) IS
  'Movimento livre do master no kanban da Operacao (emenda ao ADR-0018): leva o chamado a qualquer '
  'coluna, ajusta o relogio sem contar reabertura e grava master_audit_logs. p_send_reply (so para '
  'aguardando) envia o customer_reply do diagnostico como comentario publico na mesma transacao.';

REVOKE ALL ON FUNCTION public.master_ticket_move(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_ticket_move(uuid, text, boolean) TO authenticated;

COMMIT;
