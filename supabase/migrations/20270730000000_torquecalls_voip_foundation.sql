-- 20270730000000_torquecalls_voip_foundation.sql
--
-- TorqueCalls — S8 (CRM DB) + S9 (permissões semeadas), fatia única.
-- Chamada de voz WhatsApp via serviço próprio (VPS `calls.torquecrm.com.br`),
-- em paralelo ao Uazapi. Fases 1/2/2b/2c aprovadas pelo CTO em 2026-07-29.
--
-- POR QUE UMA MIGRATION SÓ
-- ------------------------
-- Se as permissões vierem depois do schema, a feature sobe inerte e o fallback
-- terminal do permission engine nega todo membro não-admin com
-- `permission_not_defined`. Schema e permissão nascem juntos.
--
-- DESENHO (C) — TRAVADO PELO CTO, não negociável sem ele
-- ------------------------------------------------------
-- Contador próprio (`voip_call_usage`), mas as ÚNICAS chaves de desligar ficam
-- em `whatsapp_instances` (`voice_calls_enabled`, `daily_call_cap`) — ao lado de
-- `daily_blast_cap`, que é onde um humano procura durante incidente.
--   * NÃO existe `voip_call_policies`. Duas tabelas para desligar coisa é uma
--     tabela esquecida no incidente seguinte.
--   * NÃO ancorar em `whatsapp_instance_reputation`: inerte (0 linhas para 137
--     instâncias, nenhum leitor).
--   * NÃO ligar o Send Governor de mensagem: frente separada, em produção.
-- Os demais tetos (concorrência, taxa/min, teto/dia por destino, backoff) são
-- CONSTANTES declaradas em `fn_voip_call_reserve`, documentadas lá. Virar knob
-- exige decisão do CTO — não é omissão.
--
-- ESTADO INERTE POR CONSTRUÇÃO
-- ----------------------------
-- `voice_calls_enabled` nasce `false` nas 137 instâncias. Nenhuma linha de
-- chamada pode existir sem alguém ligar a chave. Zero backfill, zero DO block
-- que toque dado de cliente.
--
-- BLAST RADIUS DAS TABELAS QUE JÁ EXISTEM (medido em prod, 2026-07-29)
-- --------------------------------------------------------------------
--   consent_records: 0 linhas   |   call_logs: 1 linha
-- O endurecimento de policy abaixo, portanto, não tira acesso de ninguém hoje.
--
-- ROLLBACK pareado: rollback/20270730000000_torquecalls_voip_foundation.sql

-- ===========================================================================
-- 1. CHAVES DE DESLIGAR — desenho (C)
-- ===========================================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS voice_calls_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS daily_call_cap integer NOT NULL DEFAULT 40;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.whatsapp_instances'::regclass
      AND conname = 'whatsapp_instances_daily_call_cap_nonneg'
  ) THEN
    ALTER TABLE public.whatsapp_instances
      ADD CONSTRAINT whatsapp_instances_daily_call_cap_nonneg
      CHECK (daily_call_cap >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.whatsapp_instances.voice_calls_enabled IS
  'Kill-switch de chamada de voz TorqueCalls para este número. Nasce false. '
  'Lido por fn_voip_call_reserve — desligar aqui derruba a discagem da org na '
  'próxima reserva, sem deploy. É o primeiro lugar a olhar num incidente de voz.';

COMMENT ON COLUMN public.whatsapp_instances.daily_call_cap IS
  'Teto diário de chamadas AUTORIZADAS por este número (fuso America/Sao_Paulo). '
  'Espelha daily_blast_cap, que governa mensagem. Contado em voip_call_usage.';

-- ===========================================================================
-- 2. voip_sessions — mapa autoritativo org ↔ sessão da VPS
-- ===========================================================================
--
-- A VPS mantém o mesmo vínculo no SQLite dela (S6) para sobreviver a restart.
-- Aqui é a cópia que as edge functions consultam para autorizar SEM perguntar
-- para a VPS — que é justamente a parte não confiável do sistema.
--
-- whatsapp_instance_id é NOT NULL de propósito: é dele que saem as chaves de
-- desligar do desenho (C). Sessão sem instância vinculada não disca.

CREATE TABLE IF NOT EXISTS public.voip_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  whatsapp_instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  tc_session_id        text NOT NULL UNIQUE,
  name                 text,
  jid                  text UNIQUE,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','pairing','open','quarantined','closed')),
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voip_sessions_org
  ON public.voip_sessions (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_voip_sessions_instance
  ON public.voip_sessions (whatsapp_instance_id);

COMMENT ON TABLE public.voip_sessions IS
  'Sessões WhatsApp pareadas no TorqueCalls (VPS). Mapa autoritativo org↔sessão: '
  'toda autorização de chamada e todo webhook de entrada derivam a org DAQUI, '
  'nunca do corpo da requisição — mesmo padrão de whatsapp_instance_secrets no '
  'whatsapp-webhook. Escrita só por service_role.';

COMMENT ON COLUMN public.voip_sessions.jid IS
  'JID resolvido via IsOnWhatsApp (formato 5548XXXXXXXX@s.whatsapp.net, 8 dígitos '
  'após o DDD). UNIQUE aplica a regra "um número, uma sessão". NÃO é o telefone '
  'digitado por humano, que tem 9 dígitos — confundir os dois era o bug de '
  'falha silenciosa da Fase 2.';

COMMENT ON COLUMN public.voip_sessions.status IS
  'pending → pairing → open. quarantined = sessão que a VPS conhece mas que '
  'ainda não foi adotada por uma org (rota de adoção, S6). closed = deslogada.';

ALTER TABLE public.voip_sessions ENABLE ROW LEVEL SECURITY;

-- get_my_organization_ids() é SECURITY DEFINER e já filtra is_active = true
-- (e soma as orgs de gestor de portfólio). Subquery inline em team_members
-- dentro de policy causa recursão quando o Realtime avalia apply_rls().
DROP POLICY IF EXISTS "voip_sessions_select_org" ON public.voip_sessions;
CREATE POLICY "voip_sessions_select_org" ON public.voip_sessions
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "master_select_all_voip_sessions" ON public.voip_sessions;
CREATE POLICY "master_select_all_voip_sessions" ON public.voip_sessions
  FOR SELECT TO authenticated USING ((SELECT is_master_user()));

-- Sem policy de escrita: quem cria/pareia/adota sessão é o plano de controle
-- (edge function, service_role). authenticated só lê.
GRANT SELECT ON public.voip_sessions TO authenticated;
GRANT ALL    ON public.voip_sessions TO service_role;

-- ===========================================================================
-- 3. voip_calls — ledger de chamada; é ele que torna a chamada autorizável
-- ===========================================================================
--
-- A edge function não enxerga o registry em memória do Go. Sem esta tabela não
-- há como autorizar "encerrar ESTA chamada" nem contar cota.
--
-- tc_call_id tem proveniência ASSIMÉTRICA e é por isso que ele NÃO é a chave
-- primária: no outbound nós geramos; no inbound o `call-id` vem do stanza do
-- peer remoto (callrouting.go lê o atributo cru, sem validação nenhuma).
-- Chave de tabela multi-tenant não pode ser string escolhida por terceiro —
-- duas orgs com o mesmo call-id colidiriam. Daí id uuid próprio +
-- UNIQUE (tc_session_id, tc_call_id).

CREATE TABLE IF NOT EXISTS public.voip_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tc_session_id     text NOT NULL REFERENCES public.voip_sessions(tc_session_id) ON DELETE CASCADE,
  tc_call_id        text,
  lead_id           uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  operator_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  peer_phone        text NOT NULL CHECK (peer_phone ~ '^[0-9]{8,15}$'),
  direction         text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status            text NOT NULL DEFAULT 'authorized'
                    CHECK (status IN ('authorized','ringing','connected','ended','expired')),
  end_reason        text,
  token_jti         uuid UNIQUE,
  consent_record_id uuid REFERENCES public.consent_records(id) ON DELETE SET NULL,
  authorized_at     timestamptz NOT NULL DEFAULT now(),
  ringing_at        timestamptz,
  connected_at      timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voip_calls_network_id_unique UNIQUE (tc_session_id, tc_call_id)
);

CREATE INDEX IF NOT EXISTS idx_voip_calls_org_live
  ON public.voip_calls (organization_id, status)
  WHERE status IN ('authorized','ringing','connected');
CREATE INDEX IF NOT EXISTS idx_voip_calls_org_authorized_at
  ON public.voip_calls (organization_id, authorized_at DESC);
CREATE INDEX IF NOT EXISTS idx_voip_calls_peer
  ON public.voip_calls (organization_id, peer_phone, authorized_at DESC);
CREATE INDEX IF NOT EXISTS idx_voip_calls_lead
  ON public.voip_calls (lead_id, authorized_at DESC) WHERE lead_id IS NOT NULL;

-- "Uma chamada viva por operador" vira INVARIANTE DE ARMAZENAMENTO, não checagem
-- de aplicação: duas reservas concorrentes do mesmo operador disputam o índice e
-- exatamente uma sobrevive. NULL não colide com NULL em índice único, então
-- inbound ainda sem operador (registrado no ringing) não é afetado.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voip_calls_one_live_per_operator
  ON public.voip_calls (operator_user_id)
  WHERE operator_user_id IS NOT NULL
    AND status IN ('authorized','ringing','connected');

COMMENT ON TABLE public.voip_calls IS
  'Ledger de chamadas TorqueCalls. Fonte de verdade para autorizar accept/end, '
  'para a cota do governor e para alimentar call_logs. Escrita só por service_role.';

COMMENT ON COLUMN public.voip_calls.tc_call_id IS
  'Identificador de REDE da chamada. Proveniência assimétrica: outbound é gerado '
  'por nós; inbound vem do atributo call-id do stanza, escolhido pelo peer remoto '
  'e sem validação no protocolo. Por isso não é PK e é único apenas dentro da '
  'sessão. NULL enquanto a chamada existe só como reserva.';

COMMENT ON COLUMN public.voip_calls.operator_user_id IS
  'NULLABLE de propósito: chamada de entrada é registrada no ringing, antes de '
  'existir operador. Atender é o que exige autorização e consome cota.';

COMMENT ON COLUMN public.voip_calls.peer_phone IS
  'Somente dígitos, sem +. Normalizado por fn_voip_call_reserve antes de gravar — '
  'contar teto por destino sobre formato livre é burlável trocando a máscara. '
  'Não há coluna de hash: RLS já esconde a linha inteira de quem não pode ver o lead.';

COMMENT ON COLUMN public.voip_calls.token_jti IS
  'jti do token tc-call emitido para esta chamada. UNIQUE fecha replay de token '
  'no lado do CRM, além do jtiCache da VPS.';

ALTER TABLE public.voip_calls ENABLE ROW LEVEL SECURITY;

-- Fronteira do lead: quem não pode ver o lead não vê o número discado para ele.
-- Wrapper SECURITY DEFINER para não referenciar `leads` (que tem RLS) dentro da
-- policy de outra tabela — é a regra da casa contra recursão com Realtime.
CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT public.can_see_lead_by_permissions(l.sdr_id, l.closer_id)
         FROM public.leads l
        WHERE l.id = p_lead_id),
      false)
  END
$$;

REVOKE ALL ON FUNCTION public.voip_can_see_call(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voip_can_see_call(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.voip_can_see_call(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.voip_can_see_call(uuid) IS
  'Fronteira do lead para linhas de chamada. lead_id nulo (número desconhecido '
  'ligando) é visível para a org inteira, por decisão de produto: a chamada tem '
  'que ser atendível por quem está de plantão.';

DROP POLICY IF EXISTS "voip_calls_select_org" ON public.voip_calls;
CREATE POLICY "voip_calls_select_org" ON public.voip_calls
  FOR SELECT USING (
    organization_id IN (SELECT get_my_organization_ids())
    AND public.voip_can_see_call(lead_id)
  );

DROP POLICY IF EXISTS "master_select_all_voip_calls" ON public.voip_calls;
CREATE POLICY "master_select_all_voip_calls" ON public.voip_calls
  FOR SELECT TO authenticated USING ((SELECT is_master_user()));

GRANT SELECT ON public.voip_calls TO authenticated;
GRANT ALL    ON public.voip_calls TO service_role;

-- ===========================================================================
-- 4. voip_call_usage — o contador do desenho (C)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.voip_call_usage (
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  whatsapp_instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  usage_date           date NOT NULL,
  calls_authorized     integer NOT NULL DEFAULT 0,
  calls_connected      integer NOT NULL DEFAULT 0,
  last_authorized_at   timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, whatsapp_instance_id, usage_date)
);

COMMENT ON TABLE public.voip_call_usage IS
  'Contador diário de chamadas por instância (fuso America/Sao_Paulo). Existe '
  'para o teto diário ser O(1) e para um humano ver o consumo sem varrer o '
  'ledger. Incrementado dentro de fn_voip_call_reserve, na mesma transação da '
  'reserva. Concorrência e taxa/min continuam sendo contadas em voip_calls, que '
  'é a janela viva.';

ALTER TABLE public.voip_call_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voip_call_usage_select_org" ON public.voip_call_usage;
CREATE POLICY "voip_call_usage_select_org" ON public.voip_call_usage
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "master_select_all_voip_call_usage" ON public.voip_call_usage;
CREATE POLICY "master_select_all_voip_call_usage" ON public.voip_call_usage
  FOR SELECT TO authenticated USING ((SELECT is_master_user()));

GRANT SELECT ON public.voip_call_usage TO authenticated;
GRANT ALL    ON public.voip_call_usage TO service_role;

-- ===========================================================================
-- 5. CONSENTIMENTO — opt-in SEPARADO para chamada, e não decorativo
-- ===========================================================================
--
-- A política do WhatsApp exige opt-in próprio para ligar ("Obtaining a separate
-- opt-in to initiate a call to a user"). Na via não-oficial ninguém enforça —
-- vira requisito nosso.
--
-- Hoje qualquer membro da org insere e atualiza consent_records escolhendo o
-- `source` (useConsent.ts). Só ampliar o CHECK criaria um gate que o próprio
-- vendedor se dá: por isso o tipo novo fica FORA do alcance de `authenticated`
-- e só entra por RPC de service_role, que carimba origem/IP/user-agent.

ALTER TABLE public.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_consent_type_check;

ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN (
    'marketing_email','marketing_whatsapp','marketing_sms',
    'data_processing','data_sharing','voice_call_whatsapp'
  ));

-- As três policies existentes usavam subquery inline em team_members SEM
-- is_active — membro desativado escrevia consentimento. Trocadas por
-- get_my_organization_ids(), que já filtra ativo.
DROP POLICY IF EXISTS "Org members see consents" ON public.consent_records;
CREATE POLICY "Org members see consents" ON public.consent_records
  FOR SELECT USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "Org members manage consents" ON public.consent_records;
CREATE POLICY "Org members manage consents" ON public.consent_records
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT get_my_organization_ids())
    AND consent_type <> 'voice_call_whatsapp'
  );

DROP POLICY IF EXISTS "Org members update consents" ON public.consent_records;
CREATE POLICY "Org members update consents" ON public.consent_records
  FOR UPDATE
  USING (
    organization_id IN (SELECT get_my_organization_ids())
    AND consent_type <> 'voice_call_whatsapp'
  )
  WITH CHECK (
    organization_id IN (SELECT get_my_organization_ids())
    AND consent_type <> 'voice_call_whatsapp'
  );

-- WITH CHECK enxerga só a linha NOVA, então não consegue barrar "limpar
-- revoked_at". Revogação que se desfaz sozinha não é revogação — trigger.
-- SECURITY INVOKER de propósito (é o default; explícito porque importa): dentro
-- de SECURITY DEFINER, `current_user` vira o dono da função e o teste de role
-- passaria a valer sempre — o guard viraria decoração.
CREATE OR REPLACE FUNCTION public.fn_consent_records_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'consent_records: revogação não pode ser desfeita (registre um novo consentimento)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consent_records_guard ON public.consent_records;
CREATE TRIGGER trg_consent_records_guard
  BEFORE UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_consent_records_guard();

-- Única porta de entrada do consentimento de voz.
CREATE OR REPLACE FUNCTION public.fn_voip_consent_record(
  p_organization_id uuid,
  p_lead_id         uuid,
  p_granted         boolean,
  p_source          text,
  p_contact_phone   text DEFAULT NULL,
  p_ip_address      text DEFAULT NULL,
  p_user_agent      text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- 'manual' fica de fora de propósito: consentimento de chamada afirmado pelo
  -- próprio vendedor no CRM não é consentimento, é auto-serviço.
  IF p_source NOT IN ('form','api','webhook') THEN
    RAISE EXCEPTION 'fn_voip_consent_record: source inválido (%). Use form, api ou webhook.', p_source
      USING ERRCODE = '22023';
  END IF;

  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.id = p_lead_id AND l.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'fn_voip_consent_record: lead não pertence à organização'
      USING ERRCODE = '42501';
  END IF;

  IF NOT p_granted THEN
    UPDATE public.consent_records
       SET revoked_at = now()
     WHERE organization_id = p_organization_id
       AND consent_type = 'voice_call_whatsapp'
       AND revoked_at IS NULL
       AND granted = true
       AND (p_lead_id IS NULL OR lead_id = p_lead_id);
  END IF;

  INSERT INTO public.consent_records (
    organization_id, lead_id, contact_phone, consent_type, granted,
    revoked_at, source, ip_address, user_agent, metadata
  ) VALUES (
    p_organization_id, p_lead_id, p_contact_phone, 'voice_call_whatsapp', p_granted,
    CASE WHEN p_granted THEN NULL ELSE now() END,
    p_source, p_ip_address, p_user_agent, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- DROP+CREATE de função devolve EXECUTE para PUBLIC. REVOKE explícito, sempre.
REVOKE ALL ON FUNCTION public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_voip_consent_record(uuid, uuid, boolean, text, text, text, text, jsonb) IS
  'Único caminho de escrita do consentimento voice_call_whatsapp. service_role '
  'apenas — as policies de consent_records barram authenticated nesse tipo.';

-- ===========================================================================
-- 6. fn_voip_call_reserve — a reserva atômica
-- ===========================================================================
--
-- Cota de chamada em memória de edge function não sobrevive nem a concorrência
-- nem a cold start. A única versão correta é uma transação no Postgres.
--
-- Esta função é chamada por UM caller só: authorizeCallAndMint (S10), que é a
-- única função capaz de assinar token de escopo `call`. Passar pelo governor e
-- obter autoridade são a mesma operação — não existe caller a instrumentar.

CREATE OR REPLACE FUNCTION public.fn_voip_call_reserve(
  p_organization_id   uuid,
  p_operator_user_id  uuid,
  p_tc_session_id     text,
  p_peer_phone        text,
  p_lead_id           uuid    DEFAULT NULL,
  p_direction         text    DEFAULT 'outbound',
  p_consent_record_id uuid    DEFAULT NULL,
  p_existing_call_id  uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Tetos fixos. Desenho (C): as chaves configuráveis são só
  -- whatsapp_instances.voice_calls_enabled e .daily_call_cap. Mexer nos valores
  -- abaixo é decisão do CTO, não de quem está com o arquivo aberto.
  --
  -- max_org_live = 2 espelha WACALLS_MAX_CALLS na VPS, baixado de 8 para 2 até
  -- existir medição de CPU por chamada simultânea (Fase 2b não mediu).
  --
  -- NÃO há janela comercial aqui: sem knob por org, horário fixo em código
  -- bloquearia silenciosamente quem vende fora dele. Entra quando existir onde
  -- configurar.
  c_reservation_ttl  constant interval := interval '12 seconds';
  c_max_org_live     constant integer  := 2;
  c_max_per_minute   constant integer  := 6;
  c_max_per_peer_day constant integer  := 3;
  c_peer_backoff     constant interval := interval '15 minutes';

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
  v_jti       uuid := gen_random_uuid();
BEGIN
  IF p_direction NOT IN ('inbound','outbound') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_direction');
  END IF;

  v_peer := regexp_replace(COALESCE(p_peer_phone, ''), '\D', '', 'g');
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

  -- Outbound exige lead e consentimento de voz vivo. Inbound não: quem ligou
  -- foi o outro lado.
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

  -- Serializa as reservas da org. Reserva é evento raro; o custo do lock é
  -- irrelevante perto de contar cota errado sob concorrência.
  PERFORM pg_advisory_xact_lock(hashtext('voip:' || p_organization_id::text));

  -- Auto-cura: reserva vencida devolve cota na hora, sem esperar o reaper de
  -- 1 minuto. O reaper existe para higiene de status, não como caminho crítico.
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

  IF COALESCE(v_used, 0) >= v_cap THEN
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
      -- Inbound sendo atendido: a linha já nasceu no ringing, sem operador.
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
      RETURNING id INTO v_call_id;

      IF v_call_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'call_not_answerable');
      END IF;
    ELSE
      INSERT INTO public.voip_calls (
        organization_id, tc_session_id, lead_id, operator_user_id,
        peer_phone, direction, status, token_jti, consent_record_id
      ) VALUES (
        p_organization_id, p_tc_session_id, p_lead_id, p_operator_user_id,
        v_peer, p_direction, 'authorized', v_jti, p_consent_record_id
      )
      RETURNING id INTO v_call_id;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      -- idx_voip_calls_one_live_per_operator. O teto por operador é invariante
      -- de armazenamento: sob corrida, exatamente uma reserva sobrevive.
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
    'token_jti', v_jti,
    'expires_in_ms', 12000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.fn_voip_call_reserve(uuid, uuid, text, text, uuid, text, uuid, uuid) IS
  'Reserva atômica de chamada: kill-switch da instância, teto diário, '
  'concorrência da org, taxa por minuto, teto por destino, backoff pós '
  'não-atendida e consentimento de voz — tudo numa transação, fail-closed. '
  'Chamada exclusivamente por authorizeCallAndMint (S10). service_role apenas.';

-- ===========================================================================
-- 7. REAPER — higiene de status das reservas vencidas
-- ===========================================================================
--
-- pg_cron tem granularidade de 1 minuto e a reserva vale 12 segundos, então o
-- reaper NÃO pode ser o caminho crítico de devolução de cota — quem devolve é a
-- própria fn_voip_call_reserve, na entrada. Aqui é só para o ledger não guardar
-- linha `authorized` eterna quando ninguém mais tenta discar.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voip-reap-authorized') THEN
    PERFORM cron.unschedule('voip-reap-authorized');
  END IF;
  PERFORM cron.schedule(
    'voip-reap-authorized',
    '* * * * *',
    $reap$
    UPDATE public.voip_calls
       SET status = 'expired',
           end_reason = 'reservation_expired',
           ended_at = now(),
           updated_at = now()
     WHERE status = 'authorized'
       AND authorized_at < now() - interval '12 seconds'
    $reap$
  );
END
$cron$;

-- ===========================================================================
-- 8. call_logs — recebe o que a chamada de voz produz
-- ===========================================================================

-- Chamada de entrada é registrada antes de existir operador.
ALTER TABLE public.call_logs ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_outcome_check;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_outcome_check
  CHECK (outcome IN (
    'connected','no_answer','busy','voicemail','wrong_number','callback_scheduled',
    'rejected','failed','canceled'
  ));

-- A visibilidade era org inteira; a de voip_calls é a fronteira do lead. Duas
-- tabelas contando a mesma ligação com fronteiras diferentes é rebaixamento por
-- caminho alternativo.
DROP POLICY IF EXISTS "Users see org call logs" ON public.call_logs;
CREATE POLICY "Users see org call logs" ON public.call_logs
  FOR SELECT USING (
    organization_id IN (SELECT get_my_organization_ids())
    AND public.voip_can_see_call(lead_id)
  );

DROP POLICY IF EXISTS "Users create call logs" ON public.call_logs;
CREATE POLICY "Users create call logs" ON public.call_logs
  FOR INSERT WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

COMMENT ON COLUMN public.call_logs.user_id IS
  'NULLABLE desde a fundação TorqueCalls: chamada de entrada é registrada no '
  'ringing, antes de haver operador. Linha sem user_id só é atualizável por '
  'service_role — a policy de UPDATE compara com auth.uid().';

-- ===========================================================================
-- 9. S9 — PERMISSÕES SEMEADAS
-- ===========================================================================
--
-- Sem estas linhas o permission engine cai no fallback terminal e nega todo
-- membro não-admin com `permission_not_defined` — o discador nasceria admin-only
-- por acidente. Espelho no servidor: _shared/permission_engine.ts
-- (PermissionAction + ACTION_TO_FEATURE), que este commit também altera.
--
-- start/answer nascem `true` porque a porta de verdade é
-- whatsapp_instances.voice_calls_enabled, que nasce `false`: enquanto o CTO não
-- liga a org, nada é discável, e quando liga o time não precisa de 30 toggles.
-- dial_manual nasce `false`: discar dígito arbitrário sem lead é o caminho que
-- fura a fronteira do lead, o teto por destino e a trilha.

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('voip.call.start', 'Chamadas', 'Ligar para leads',
   'Permite iniciar chamada de voz pelo WhatsApp para leads sob sua responsabilidade.',
   false, true, 10),
  ('voip.call.answer', 'Chamadas', 'Atender chamadas',
   'Permite atender chamadas de voz recebidas no número da organização.',
   false, true, 20),
  ('voip.call.dial_manual', 'Chamadas', 'Discar número avulso',
   'Permite discar um número digitado à mão, sem lead vinculado. Sem lead não há '
   'fronteira de visibilidade nem trilha no histórico.',
   false, false, 30),
  ('voip.session.manage', 'Chamadas', 'Gerenciar número de chamadas',
   'Parear, adotar e desconectar o número usado para chamadas de voz.',
   true, false, 40)
ON CONFLICT (key) DO NOTHING;
