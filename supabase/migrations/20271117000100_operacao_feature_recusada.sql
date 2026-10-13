-- Operação (Área Dev): coluna "Feature recusada" no kanban de Chamados.
--
-- Pedido do CTO (2026-10-13). O estado `recusado` nasceu em 20271117000000.
-- A coluna continua DERIVADA do dado (OP-8): `recusado` → "Feature recusada".
--
-- O que muda:
--   1. `enforce_support_ticket_write_rules`: `recusado` é terminal como
--      `fechado` — só entra e só sai pelo movimento deliberado do master
--      (`master_ticket_move`). Cliente não reabre recusado.
--      Relógio: → recusado  resolved_at = NULL (não foi resolvido); closed_at = now()
--               saindo de fechado/recusado para o trabalho: closed_at = NULL
--      Mudança de forma, sem efeito nos casos antigos: o "limpa closed_at"
--      passou de "OLD era fechado" para "NEW não é encerrado" — antes não
--      existia ida de um encerrado para outro, agora existe (fechado ↔ recusado).
--   2. `master_ticket_move`: coluna `recusada`; só aceita chamado cujo
--      diagnóstico é `kind = 'feature'`.
--   3. `purge_expired_support_attachments`: recusado também perde anexo 90 dias
--      depois de encerrar (ADR-0022).
--   4. `master_org_health_signals`: recusado não conta como chamado aberto.
--
-- Cópias das definições de prod (lidas em 2026-10-13), com o mínimo alterado;
-- cada alteração no gatilho está marcada com "feature recusada".
-- Rollback: supabase/migrations/rollback/20271117000100_operacao_feature_recusada.sql
BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─── 1. O gatilho ───────────────────────────────────────────────────────────
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

    -- feature recusada: terminal como fechado; só o master tira, pela RPC.
    IF OLD.status = 'recusado' AND NOT is_staff_move THEN
      RAISE EXCEPTION 'chamado recusado e terminal: abra um novo' USING ERRCODE = 'check_violation';
    END IF;

    -- feature recusada: só se recusa pelo kanban da Operacao.
    IF NEW.status = 'recusado' AND NOT is_staff_move THEN
      RAISE EXCEPTION 'so o suporte recusa um chamado, pelo kanban da Operacao' USING ERRCODE = 'check_violation';
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
      ELSIF NEW.status = 'recusado' THEN
        -- feature recusada: encerra sem ter resolvido. closed_at conta a retenção de anexos.
        NEW.resolved_at := NULL;
        NEW.closed_at := now();
      ELSE
        NEW.resolved_at := NULL;
      END IF;
      -- feature recusada: saindo de um estado encerrado para o trabalho, o
      -- carimbo sai. Entre fechado e recusado ele é o do movimento, acima.
      IF NEW.status NOT IN ('fechado', 'recusado') THEN
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
  v_kind        text;
  v_from_column text;
  v_to_status   public.support_ticket_status;
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'apenas o suporte move chamados livremente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_to_column IS NULL
     OR p_to_column NOT IN ('aberto', 'diagnostico', 'andamento', 'aguardando', 'concluido', 'recusada') THEN
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

  SELECT true, btrim(customer_reply), kind INTO v_has_diag, v_reply, v_kind
    FROM public.support_ticket_diagnoses WHERE ticket_id = p_ticket_id;
  v_has_diag := coalesce(v_has_diag, false);

  -- Feature recusada é para feature: o diagnóstico registrado diz o que o chamado é.
  IF p_to_column = 'recusada' AND v_kind IS DISTINCT FROM 'feature' THEN
    RAISE EXCEPTION 'so um chamado diagnosticado como feature pode ser recusado' USING ERRCODE = 'check_violation';
  END IF;

  -- Mesma derivação de `columnOf` (src/modules/identity/master/lib/operacao-kanban.ts).
  v_from_column := CASE v_cur.status
    WHEN 'fechado'            THEN 'concluido'
    WHEN 'recusado'           THEN 'recusada'
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
    WHEN 'recusada'    THEN 'recusado'
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
  'aguardando) envia o customer_reply do diagnostico como comentario publico na mesma transacao. '
  'A coluna recusada (estado recusado) so aceita chamado diagnosticado como feature.';

REVOKE ALL ON FUNCTION public.master_ticket_move(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_ticket_move(uuid, text, boolean) TO authenticated;

-- ─── 3. Retenção de anexos ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."purge_expired_support_attachments"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_base_url    TEXT := current_setting('app.settings.supabase_url', true);
  v_service_key TEXT := current_setting('app.service_role_key', true);
  v_removidos   INTEGER := 0;
  r             RECORD;
BEGIN
  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING '[support_attachments] app.settings.supabase_url ou app.service_role_key ausente: retencao pulada';
    RETURN 0;
  END IF;

  FOR r IN
    SELECT a.id, a.path
      FROM public.support_ticket_attachments a
      JOIN public.support_tickets t ON t.id = a.ticket_id
     -- feature recusada: encerrado também conta a retenção pelo closed_at.
     WHERE t.status IN ('fechado', 'recusado')
       AND t.closed_at IS NOT NULL
       AND t.closed_at < now() - interval '90 days'
       AND a.purged_at IS NULL
     LIMIT 500
  LOOP
    PERFORM net.http_delete(
      url     := v_base_url || '/storage/v1/object/support-attachments/' || r.path,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_service_key)
    );
    UPDATE public.support_ticket_attachments SET purged_at = now() WHERE id = r.id;
    v_removidos := v_removidos + 1;
  END LOOP;

  RETURN v_removidos;
END; $$;

COMMENT ON FUNCTION public.purge_expired_support_attachments() IS
  'Remove anexos 90 dias apos o chamado encerrar (fechado ou recusado). O arquivo sai pela API de Storage '
  '(apagar storage.objects por SQL nao apaga o arquivo). Lotes de 500. Ver ADR-0022.';

REVOKE ALL ON FUNCTION public.purge_expired_support_attachments() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_expired_support_attachments() TO service_role;

-- ─── 4. Sinais de saúde da org ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.master_org_health_signals()
RETURNS TABLE (
  organization_id       uuid,
  members_active        integer,
  last_login_at         timestamptz,
  active_users_7d       integer,
  events_7d             bigint,
  whatsapp_instances    integer,
  whatsapp_connected    integer,
  open_tickets          integer,
  reopen_alert_tickets  integer,
  quota_max_ratio       numeric,
  quota_max_resource    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_full boolean;
BEGIN
  SELECT COALESCE((mu.permissions ->> 'all')::boolean, false) INTO v_full
    FROM public.master_users mu
   WHERE mu.user_id = auth.uid() AND mu.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH orgs AS (
    SELECT o.id FROM public.organizations o
     WHERE NOT o.is_sandbox AND (v_full OR o.org_type = 'outbound')
  ),
  masters AS (
    SELECT mu.user_id FROM public.master_users mu WHERE mu.is_active
  ),
  membros AS (
    SELECT tm.organization_id, tm.user_id
      FROM public.team_members tm
     WHERE tm.is_active AND tm.organization_id IN (SELECT id FROM orgs)
       AND tm.user_id NOT IN (SELECT user_id FROM masters)
  ),
  sessoes AS (
    -- max(), nunca count(): sessões não são expurgadas (ver master_org_user_activity).
    SELECT s.user_id, max(s.updated_at) AS seen
      FROM auth.sessions s
     WHERE s.user_id IN (SELECT user_id FROM membros)
     GROUP BY s.user_id
  ),
  login AS (
    SELECT m.organization_id,
           count(*)::int AS members_active,
           max(se.seen) AS last_login_at,
           (count(*) FILTER (WHERE se.seen > now() - interval '7 days'))::int AS active_users_7d
      FROM membros m LEFT JOIN sessoes se ON se.user_id = m.user_id
     GROUP BY m.organization_id
  ),
  uso AS (
    SELECT u.organization_id, count(*) AS events_7d
      FROM public.usage_events u
     WHERE u.created_at > now() - interval '7 days' AND u.organization_id IN (SELECT id FROM orgs)
     GROUP BY u.organization_id
  ),
  chips AS (
    SELECT w.organization_id,
           count(*)::int AS total,
           (count(*) FILTER (WHERE w.status = 'connected' AND w.session_dead_since IS NULL))::int AS conectados
      FROM public.whatsapp_instances w
     WHERE w.organization_id IN (SELECT id FROM orgs)
     GROUP BY w.organization_id
  ),
  chamados AS (
    SELECT t.organization_id,
           -- feature recusada: encerrado como fechado, não é chamado aberto.
           (count(*) FILTER (WHERE t.status NOT IN ('fechado', 'recusado')))::int AS abertos,
           (count(*) FILTER (WHERE t.status NOT IN ('fechado', 'recusado') AND t.reopen_count >= 3))::int AS reabertos
      FROM public.support_tickets t
     WHERE t.organization_id IN (SELECT id FROM orgs)
     GROUP BY t.organization_id
  ),
  -- O mesmo uso que `admin_get_org_quota_summary` conta, por recurso limitado.
  uso_quota AS (
    SELECT q.organization_id, q.resource_key,
           CASE q.resource_key
             WHEN 'max_whatsapp_instances' THEN COALESCE(c.total, 0)
             WHEN 'max_users' THEN COALESCE(l.members_active, 0)
             WHEN 'max_copilot_agents' THEN (
               SELECT count(*) FROM public.copilot_agents ca WHERE ca.organization_id = q.organization_id)
           END::numeric / NULLIF(q.effective_limit, 0) AS ratio
      FROM public.org_quotas q
      LEFT JOIN chips c ON c.organization_id = q.organization_id
      LEFT JOIN login l ON l.organization_id = q.organization_id
     WHERE q.organization_id IN (SELECT id FROM orgs)
       AND q.effective_limit > 0  -- -1 = ilimitado
  ),
  pior_quota AS (
    SELECT DISTINCT ON (uq.organization_id) uq.organization_id, uq.ratio, uq.resource_key
      FROM uso_quota uq
     WHERE uq.ratio IS NOT NULL
     ORDER BY uq.organization_id, uq.ratio DESC
  )
  SELECT o.id,
         COALESCE(l.members_active, 0),
         l.last_login_at,
         COALESCE(l.active_users_7d, 0),
         COALESCE(u.events_7d, 0),
         COALESCE(c.total, 0),
         COALESCE(c.conectados, 0),
         COALESCE(ch.abertos, 0),
         COALESCE(ch.reabertos, 0),
         round(pq.ratio, 3),
         pq.resource_key
    FROM orgs o
    LEFT JOIN login l ON l.organization_id = o.id
    LEFT JOIN uso u ON u.organization_id = o.id
    LEFT JOIN chips c ON c.organization_id = o.id
    LEFT JOIN chamados ch ON ch.organization_id = o.id
    LEFT JOIN pior_quota pq ON pq.organization_id = o.id;
END;
$$;

COMMENT ON FUNCTION public.master_org_health_signals() IS
  'Area Dev > Organizacoes: fatos de saude por org (login, uso 7d, chip, chamados, pior quota). '
  'A nota e calculada no front (lib/org-health.ts). Master pleno ve a frota; outbounder so orgs outbound.';

REVOKE ALL ON FUNCTION public.master_org_health_signals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_org_health_signals() TO authenticated;

COMMIT;
