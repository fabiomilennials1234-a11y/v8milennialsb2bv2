-- Quem pode ligar por QUAL número: o vínculo usuário↔instância chega à voz.
-- ROLLBACK pareado: rollback/20270731000001_voip_reserve_instance_access.sql
--
-- O FURO
-- ------
-- `fn_voip_call_reserve` recebe `p_tc_session_id` do front e valida organização,
-- sessão aberta, `voice_calls_enabled`, lead da org e consentimento. NÃO valida
-- se aquele usuário pode usar aquela instância. Como a sessão carrega a
-- instância, qualquer membro da org que conheça um `tc_session_id` disca pelo
-- número de qualquer colega — esconder o botão no front não fecha nada.
--
-- O CRM já tem esse controle vivo para o WhatsApp:
-- `whatsapp_instance_allowed_members` tem 189 linhas em produção e é o que o
-- inbox usa (`useWhatsAppInstancesForUser`). A voz ignorava a tabela inteira.
--
-- A REGRA — A MESMA DO INBOX, NÃO UMA NOVA
-- -----------------------------------------
--   instância SEM ninguém em whatsapp_instance_allowed_members → toda a org
--   instância COM lista                                        → só a lista
--   master, gestor de portfólio e admin da org                 → bypass
--
-- POR QUE NÃO REUSAR `can_user_write_instance`
-- --------------------------------------------
-- Ela existe, e foi lida antes de escrever esta. Ela expressa OUTRA regra:
-- ignora `whatsapp_instance_allowed_members` por completo e autoriza por
-- `whatsapp_instances.owner_team_member_id` (dono exato). As duas discordam no
-- caso mais comum — instância SEM dono e SEM lista:
--   · regra do inbox (esta)      → toda a org pode
--   · can_user_write_instance    → ninguém, exceto admin/master
--
-- Isso não é diferença teórica. Em 2026-07-31 a produção tem UMA instância com
-- `voice_calls_enabled = true` — "Gipp teste", org Milennials — com
-- `owner_team_member_id = NULL` e ZERO allowed_members. Reusar
-- `can_user_write_instance` recusaria os 4 membros ativos da org que não fossem
-- admin, e quebraria o único caminho de voz vivo hoje. A regra do inbox libera
-- todos eles, que é o comportamento de hoje: esta mudança nasce INERTE em
-- produção, e só passa a barrar quando alguém popular a lista de uma instância.
--
-- POR QUE UMA FUNÇÃO NOMEADA, E NÃO O PREDICADO SOLTO NO CORPO
-- ------------------------------------------------------------
-- O maior risco desta feature não é o gate errado, é o gate DIVERGENTE: se o
-- front mostrar uma lista de números e o servidor usar outro critério, ou some
-- o botão de quem pode, ou se oferece botão para quem o servidor vai recusar.
-- Com a regra num objeto único e nomeado, `call-plane.ts` (recusa antecipada) e
-- `fn_voip_call_reserve` (gate real) leem a MESMA definição — divergir passa a
-- exigir editar a função, não esquecer de copiar uma condição.

-- ===========================================================================
-- fn_voip_can_use_instance — a regra, num lugar só
-- ===========================================================================
--
-- SECURITY DEFINER porque atravessa `team_members`, `gestores` e
-- `whatsapp_instance_allowed_members`, todas com RLS. STABLE: só lê.
--
-- A TRADUÇÃO user → team_member ACONTECE AQUI DENTRO, de propósito.
-- `p_operator_user_id` é um `auth.users.id`; `allowed_members.team_member_id` é
-- um `team_members.id`. Se a tradução fosse feita pelo chamador e passada como
-- parâmetro, a fronteira voltaria a ser "quem chamou lembrou de traduzir certo".
--
-- E a tradução EXIGE `is_active`. Este projeto já teve o furo simétrico:
-- `assert_org_access` sem `is_active` deixou 15 membros desativados lendo dados
-- da org que os desligou. Membro desligado que continua na lista de uma
-- instância NÃO liga por ela.
CREATE OR REPLACE FUNCTION public.fn_voip_can_use_instance(
  p_user_id uuid,
  p_instance_id uuid
)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id     uuid;
  v_user_tm_id uuid;
  v_role       text;
  v_tem_lista  boolean;
BEGIN
  -- Fail-closed em entrada incompleta: sem usuário ou sem instância não há o
  -- que autorizar, e `NULL = NULL` nunca pode virar "pode".
  IF p_user_id IS NULL OR p_instance_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT wi.organization_id INTO v_org_id
    FROM public.whatsapp_instances wi
   WHERE wi.id = p_instance_id;

  IF v_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Master da plataforma.
  IF public.is_master_user(p_user_id) THEN
    RETURN true;
  END IF;

  -- Gestor de portfólio ativo vinculado à org (ADR-0021 §6). Ele vive FORA de
  -- `team_members`, então resolver só por roster o negaria.
  --
  -- Inline, e não `get_my_gestor_organization_ids()`: aquela função filtra por
  -- `auth.uid()`, que é NULL quando quem chama é o service_role — usá-la aqui
  -- negaria todo gestor em silêncio.
  IF EXISTS (
    SELECT 1
      FROM public.gestor_organizations gorg
      JOIN public.gestores g ON g.id = gorg.gestor_id
     WHERE g.user_id = p_user_id
       AND g.is_active = true
       AND gorg.organization_id = v_org_id
  ) THEN
    RETURN true;
  END IF;

  -- Tradução user → team_member, restrita à org DA INSTÂNCIA e a membro ATIVO.
  SELECT tm.id, tm.role::text
    INTO v_user_tm_id, v_role
    FROM public.team_members tm
   WHERE tm.user_id = p_user_id
     AND tm.organization_id = v_org_id
     AND tm.is_active = true
   LIMIT 1;

  IF v_user_tm_id IS NULL THEN
    RETURN false;
  END IF;

  -- Admin da org.
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  -- Instância sem lista é instância aberta: comportamento de hoje preservado.
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_instance_allowed_members m
     WHERE m.whatsapp_instance_id = p_instance_id
  ) INTO v_tem_lista;

  IF NOT v_tem_lista THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.whatsapp_instance_allowed_members m
     WHERE m.whatsapp_instance_id = p_instance_id
       AND m.team_member_id = v_user_tm_id
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_voip_can_use_instance(uuid, uuid) IS
  'Um usuário (auth.users.id) pode operar por esta instância de WhatsApp? '
  'Mesma regra do inbox (useWhatsAppInstancesForUser): sem allowed_members a '
  'instância é aberta à org; com lista, só a lista; master, gestor e admin '
  'bypassam. Traduz user→team_member exigindo is_active. NÃO confundir com '
  'can_user_write_instance, que autoriza por owner_team_member_id e discorda '
  'desta no caso "sem dono e sem lista".';

REVOKE ALL ON FUNCTION public.fn_voip_can_use_instance(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_can_use_instance(uuid, uuid) FROM anon;
-- `authenticated` fica de FORA: a função recebe `p_user_id` por parâmetro, e
-- DEFINER + parâmetro de identidade + grant amplo é o desenho que já produziu
-- vazamento neste projeto — qualquer usuário poderia sondar "fulano pode usar a
-- instância X?" e enumerar roster de outra org. Quem precisar disto no front
-- ganha um wrapper que deriva o usuário de `auth.uid()`, não um parâmetro.
REVOKE ALL ON FUNCTION public.fn_voip_can_use_instance(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_can_use_instance(uuid, uuid) TO service_role;

-- ===========================================================================
-- fn_voip_call_reserve — o gate passa a perguntar pela instância
-- ===========================================================================
--
-- Corpo extraído de PRODUÇÃO com `pg_get_functiondef` em 2026-07-31 e conferido
-- por md5 (`4b9762bc4217d3f8923623ec7a43fdf4`, 7954 bytes) — não copiado de
-- arquivo do repositório. Este projeto já teve uma migration montada sobre a
-- versão errada que reverteu uma decisão do CTO em silêncio.
--
-- ÚNICA mudança em relação à versão viva: o bloco `not_instance_member`.
-- Preservados na íntegra, porque são decisão do CTO e a asserção que os protege
-- mora no pgTAP: c_max_org_live=100, c_max_per_minute=600,
-- c_max_per_peer_day=1000, c_peer_backoff='0 seconds' (sem teto de volume) e o
-- consentimento CONDICIONAL a `organizations.require_voice_consent`.
--
-- CREATE OR REPLACE, nunca DROP + CREATE: dropar devolve EXECUTE a PUBLIC e anon.

CREATE OR REPLACE FUNCTION public.fn_voip_call_reserve(
  p_organization_id uuid,
  p_operator_user_id uuid,
  p_tc_session_id text,
  p_peer_phone text,
  p_lead_id uuid DEFAULT NULL::uuid,
  p_direction text DEFAULT 'outbound'::text,
  p_consent_record_id uuid DEFAULT NULL::uuid,
  p_existing_call_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_reservation_ttl  constant interval := interval '12 seconds';
  c_max_org_live     constant integer  := 100;
  c_max_per_minute   constant integer  := 600;
  c_max_per_peer_day constant integer  := 1000;
  c_peer_backoff     constant interval := interval '0 seconds';

  v_session   public.voip_sessions%ROWTYPE;
  v_enabled   boolean;
  v_cap       integer;
  v_instance  uuid;
  v_peer      text;
  v_used      integer;
  v_live      integer;
  v_recent    integer;
  v_peer_day  integer;
  v_today     date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_day_start timestamptz := (v_today::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_call_id   uuid;
  v_tc_call_id text;
  v_jti       uuid := gen_random_uuid();
  v_exige_consentimento boolean;
BEGIN
  IF p_direction NOT IN ('inbound','outbound') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_direction');
  END IF;

  v_peer := regexp_replace(COALESCE(p_peer_phone, ''), '[^0-9]', '', 'g');
  IF length(v_peer) < 8 OR length(v_peer) > 15 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_peer');
  END IF;

  SELECT * INTO v_session
    FROM public.voip_sessions
   WHERE tc_session_id = p_tc_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_found');
  END IF;
  IF v_session.organization_id <> p_organization_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_org_mismatch');
  END IF;
  IF v_session.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'session_not_open');
  END IF;

  v_instance := v_session.whatsapp_instance_id;

  SELECT wi.voice_calls_enabled, wi.daily_call_cap
    INTO v_enabled, v_cap
    FROM public.whatsapp_instances wi
   WHERE wi.id = v_instance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'instance_not_found');
  END IF;
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'code', 'voice_calls_disabled');
  END IF;

  -- ACESSO À INSTÂNCIA — terceiro caso, distinto dos dois vizinhos:
  --   voice_calls_disabled → a INSTÂNCIA não tem voz
  --   permission_denied    → o USUÁRIO não tem a feature de voz
  --   not_instance_member  → ambos existem, mas ESTE usuário não opera por
  --                          ESTA instância
  --
  -- Antes de qualquer escrita e antes do advisory lock: negativa pura, sem
  -- efeito colateral, sem consumir cota nem prender o operador.
  --
  -- `p_operator_user_id` NULO é a CRIAÇÃO da chamada de ENTRADA: a linha nasce
  -- em `ringing` sem dono (não há usuário a autorizar — ninguém atendeu ainda),
  -- e é assim que `fn_voip_apply_vps_event` a encontra depois; aquela função só
  -- ATUALIZA, nunca insere. Barrar aqui mataria toda chamada de entrada antes de
  -- tocar. O gate humano não é pulado, só adiado: ATENDER passa por esta mesma
  -- função de novo, com operador real e `p_existing_call_id`, e aí a pergunta é
  -- feita. Não é brecha — a função é service_role-only e o único chamador que
  -- informa usuário (`call-plane.ts`) sempre informa um usuário real.
  IF p_operator_user_id IS NOT NULL
     AND NOT public.fn_voip_can_use_instance(p_operator_user_id, v_instance) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_instance_member');
  END IF;

  -- Outbound continua exigindo LEAD: sem ele nao ha de quem derivar o numero.
  -- O CONSENTIMENTO e que virou condicional (decisao do CTO, 2026-07-31).
  IF p_direction = 'outbound' THEN
    IF p_lead_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lead_required');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = p_lead_id AND l.organization_id = p_organization_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'lead_org_mismatch');
    END IF;

    SELECT COALESCE(o.require_voice_consent, false) INTO v_exige_consentimento
      FROM public.organizations o
     WHERE o.id = p_organization_id;

    IF COALESCE(v_exige_consentimento, false) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.consent_records c
         WHERE c.organization_id = p_organization_id
           AND c.lead_id = p_lead_id
           AND c.consent_type = 'voice_call_whatsapp'
           AND c.granted = true
           AND c.revoked_at IS NULL
           AND c.source IN ('form','api','webhook')
           AND (p_consent_record_id IS NULL OR c.id = p_consent_record_id)
      ) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'consent_missing');
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('voip:' || p_organization_id::text));

  UPDATE public.voip_calls
     SET status = 'expired',
         end_reason = 'reservation_expired',
         ended_at = now(),
         updated_at = now()
   WHERE organization_id = p_organization_id
     AND status = 'authorized'
     AND authorized_at < now() - c_reservation_ttl;

  SELECT COALESCE(u.calls_authorized, 0) INTO v_used
    FROM public.voip_call_usage u
   WHERE u.organization_id = p_organization_id
     AND u.whatsapp_instance_id = v_instance
     AND u.usage_date = v_today;

  IF v_cap IS NOT NULL AND COALESCE(v_used, 0) >= v_cap THEN
    RETURN jsonb_build_object('ok', false, 'code', 'daily_cap_reached');
  END IF;

  SELECT count(*) INTO v_live
    FROM public.voip_calls c
   WHERE c.organization_id = p_organization_id
     AND c.status IN ('authorized','ringing','connected')
     AND (p_existing_call_id IS NULL OR c.id <> p_existing_call_id);

  IF v_live >= c_max_org_live THEN
    RETURN jsonb_build_object('ok', false, 'code', 'org_concurrency_reached',
                              'retry_after_ms', 5000);
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.voip_calls c
   WHERE c.organization_id = p_organization_id
     AND c.authorized_at > now() - interval '1 minute';

  IF v_recent >= c_max_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
                              'retry_after_ms', 10000);
  END IF;

  IF p_direction = 'outbound' THEN
    SELECT count(*) INTO v_peer_day
      FROM public.voip_calls c
     WHERE c.organization_id = p_organization_id
       AND c.peer_phone = v_peer
       AND c.direction = 'outbound'
       AND c.authorized_at >= v_day_start;

    IF v_peer_day >= c_max_per_peer_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'peer_daily_cap_reached');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.voip_calls c
       WHERE c.organization_id = p_organization_id
         AND c.peer_phone = v_peer
         AND c.direction = 'outbound'
         AND c.connected_at IS NULL
         AND c.ended_at IS NOT NULL
         AND c.ended_at > now() - c_peer_backoff
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'peer_backoff',
                                'retry_after_ms', 60000);
    END IF;
  END IF;

  BEGIN
    IF p_existing_call_id IS NOT NULL THEN
      UPDATE public.voip_calls
         SET operator_user_id = p_operator_user_id,
             lead_id = COALESCE(p_lead_id, lead_id),
             token_jti = v_jti,
             consent_record_id = COALESCE(p_consent_record_id, consent_record_id),
             authorized_at = now(),
             updated_at = now()
       WHERE id = p_existing_call_id
         AND organization_id = p_organization_id
         AND status IN ('ringing','authorized')
         AND tc_call_id IS NOT NULL
      RETURNING id, tc_call_id INTO v_call_id, v_tc_call_id;

      IF v_call_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'call_not_answerable');
      END IF;
    ELSE
      v_tc_call_id := upper(replace(gen_random_uuid()::text, '-', ''));

      INSERT INTO public.voip_calls (
        organization_id, tc_session_id, tc_call_id, lead_id, operator_user_id,
        peer_phone, direction, status, token_jti, consent_record_id
      ) VALUES (
        p_organization_id, p_tc_session_id, v_tc_call_id, p_lead_id, p_operator_user_id,
        v_peer, p_direction, 'authorized', v_jti, p_consent_record_id
      )
      RETURNING id INTO v_call_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'operator_busy');
  END;

  INSERT INTO public.voip_call_usage AS u (
    organization_id, whatsapp_instance_id, usage_date,
    calls_authorized, last_authorized_at, updated_at
  ) VALUES (
    p_organization_id, v_instance, v_today, 1, now(), now()
  )
  ON CONFLICT (organization_id, whatsapp_instance_id, usage_date) DO UPDATE
    SET calls_authorized   = u.calls_authorized + 1,
        last_authorized_at = now(),
        updated_at         = now();

  RETURN jsonb_build_object(
    'ok', true,
    'call_id', v_call_id,
    'tc_call_id', v_tc_call_id,
    'token_jti', v_jti,
    'expires_in_ms', 12000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;
