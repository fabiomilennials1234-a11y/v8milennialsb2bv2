-- 20271128000000_realtime_broadcast_s1_pipeline_entries.sql
--
-- Realtime postgres_changes → Broadcast privado · fatia S1: fundação + piloto
-- pipeline_entries. Desenho: .specs/perf/realtime-broadcast/S1.md (MACRO ao lado).
--
-- POR QUE: o poll do WAL do postgres_changes (`SELECT wal->>…`, apply_rls por
-- evento × assinante) é 16,2% do tempo do banco desde 05/10. Broadcast autoriza
-- no JOIN do canal (policy em realtime.messages, cacheada por conexão), não por
-- evento.
--
-- REGRA DURA: este arquivo NUNCA tem `ALTER TABLE realtime.messages` — nem um
-- `ENABLE ROW LEVEL SECURITY` "defensivo". `postgres` não é dono da tabela
-- (supabase_realtime_admin): o ALTER dá 42501 e aborta a transação inteira,
-- levando o CREATE POLICY junto. O RLS já está ligado em prod. CREATE POLICY é
-- delegado ao postgres pelo supautils.policy_grants (ensaio em prod 19/10).
--
-- O QUE CRIA
--  1. private.realtime_can_join(topic) — predicado ÚNICO de autorização de
--     tópico. Default-deny: só conhece `org:{uuid}:pe`. Libera quem é membro
--     ativo da org (get_my_organization_ids: org bloqueada fica fora) E não está
--     no modo estrito de dono (strict_lead_member_orgs). Membro não-admin de org
--     estrita só vê pipeline_entries de lead que é dele (RESTRICTIVE
--     strict_owner_pipeline_entries) — um tópico da org inteira vazaria; ele
--     continua no postgres_changes (híbrido, decisão D3 do MACRO).
--  2. Policy rt_broadcast_select em realtime.messages: SÓ SELECT, TO
--     authenticated. Sem policy de INSERT o cliente não publica (authenticated
--     tem o GRANT de INSERT, o RLS recusa). anon não tem policy: nega.
--  3. public.realtime_subscription_plan(org) — fonte única do transporte para o
--     front. 'broadcast' só se a org ligou a flag E o chamador pode entrar no
--     tópico; senão 'pg_changes'. Não é oráculo: quem não pode entrar recebe
--     'pg_changes' seja qual for a flag.
--  4. Trigger AFTER ROW em pipeline_entries → realtime.send(envelope, private).
--     Publica só para org com feature_flags.realtime_broadcast_pe = true.
--     Payload ALLOWLIST (sem notes, sem metadata): realtime.messages guarda
--     cópia por ~3 dias (LGPD) e o join já autorizou a org inteira — o payload
--     é só o que os consumidores leem (id, funil, etapa, lead, datas).
--     SECURITY DEFINER: realtime.send é INVOKER e o INSERT em realtime.messages
--     de um authenticated cairia no RLS (sem policy de INSERT) — engolido como
--     WARNING, evento perdido em silêncio. Dono postgres (BYPASSRLS) insere.
--     `SET LOCAL app.rt_mute = 'on'` silencia operação em massa.
--
-- NÃO FAZ: não liga a flag de nenhuma org; não tira pipeline_entries da
-- publication supabase_realtime (S5); não mexe em whatsapp_messages (S2).
--
-- ROLLOUT (humano, depois do apply):
--   UPDATE public.organizations
--      SET feature_flags = coalesce(feature_flags,'{}'::jsonb) || '{"realtime_broadcast_pe":true}'
--    WHERE id = '<org piloto>';
-- Kill switch: a mesma linha com false. O trigger para na hora; o front relê o
-- plano em ≤5 min (TTL) e volta ao postgres_changes, com catch-up.
--
-- Rollback exato: supabase/migrations/rollback/20271128000000_realtime_broadcast_s1_pipeline_entries.sql

-- ─── 1. Predicado de join ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.realtime_can_join(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match text[];
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;

  -- Formato fechado, minúsculo (uuid::text). Tópico desconhecido = nega.
  v_match := regexp_match(
    p_topic,
    '^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(pe)$'
  );
  IF v_match IS NULL THEN
    RETURN false;
  END IF;
  v_org := v_match[1]::uuid;

  IF v_match[2] = 'pe' THEN
    RETURN EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS m(org_id) WHERE m.org_id = v_org)
       AND NOT (v_org = ANY (private.strict_lead_member_orgs()));
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION private.realtime_can_join(text) IS
  'Realtime Broadcast: quem pode entrar no tópico. Default-deny; hoje só org:{uuid}:pe. Ver 20271128000000.';

-- Função nova nasce executável por anon/authenticated/service_role (default
-- privileges do Supabase): REVOKE de PUBLIC não alcança. A policy roda como
-- authenticated e precisa do EXECUTE.
REVOKE ALL ON FUNCTION private.realtime_can_join(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.realtime_can_join(text) TO authenticated;

-- ─── 2. Policy em realtime.messages (só CREATE POLICY) ─────────────────────

CREATE POLICY rt_broadcast_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.realtime_can_join((SELECT realtime.topic()))
  );

-- ─── 3. Plano de transporte para o front ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.realtime_subscription_plan(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'pipeline_entries',
    CASE
      WHEN p_organization_id IS NOT NULL
       AND private.realtime_can_join('org:' || p_organization_id::text || ':pe')
       AND EXISTS (
         SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.feature_flags @> '{"realtime_broadcast_pe": true}'::jsonb
       )
      THEN 'broadcast'
      ELSE 'pg_changes'
    END
  );
$$;

COMMENT ON FUNCTION public.realtime_subscription_plan(uuid) IS
  'Transporte realtime por tabela para o chamador nesta org (broadcast | pg_changes). Fonte única do front. Ver 20271128000000.';

REVOKE ALL ON FUNCTION public.realtime_subscription_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.realtime_subscription_plan(uuid) TO authenticated;

-- ─── 4. Publicação de pipeline_entries ─────────────────────────────────────

-- Allowlist do payload. Mudar aqui = mudar BROADCAST_TABLES.pipeline_entries
-- em src/shared/realtime/broadcastTransport.ts (o teste de contrato confere).
CREATE OR REPLACE FUNCTION private.rt_pipeline_entry_row(r public.pipeline_entries)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'organization_id', r.organization_id,
    'pipeline_id', r.pipeline_id,
    'lead_id', r.lead_id,
    'deal_id', r.deal_id,
    'stage_id', r.stage_id,
    'stage_key', r.stage_key,
    'assigned_to', r.assigned_to,
    'entered_at', r.entered_at,
    'stage_changed_at', r.stage_changed_at,
    'closed_at', r.closed_at,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  );
$$;

REVOKE ALL ON FUNCTION private.rt_pipeline_entry_row(public.pipeline_entries) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.rt_broadcast_pipeline_entries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_flag constant jsonb := '{"realtime_broadcast_pe": true}'::jsonb;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF coalesce(current_setting('app.rt_mute', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new := private.rt_pipeline_entry_row(NEW);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old := private.rt_pipeline_entry_row(OLD);
  END IF;

  -- Card trocou de org (raro): para a org de origem ele SAIU.
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM NEW.organization_id
     AND OLD.organization_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id AND o.feature_flags @> v_flag) THEN
    PERFORM realtime.send(
      jsonb_build_object('v', 1, 't', 'pipeline_entries', 'op', 'DELETE', 'id', OLD.id, 'row', NULL, 'old', v_old, 'ts', now()),
      'pipeline_entries',
      'org:' || OLD.organization_id::text || ':pe',
      true
    );
  END IF;

  IF coalesce(NEW.organization_id, OLD.organization_id) IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations o
        WHERE o.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END)
          AND o.feature_flags @> v_flag
     ) THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'v', 1,
      't', 'pipeline_entries',
      'op', TG_OP,
      'id', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
      'row', v_new,
      'old', v_old,
      'ts', now()
    ),
    'pipeline_entries',
    'org:' || (CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END)::text || ':pe',
    true
  );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION private.rt_broadcast_pipeline_entries() IS
  'Publica pipeline_entries no tópico privado org:{org}:pe (allowlist) quando a org tem feature_flags.realtime_broadcast_pe. Ver 20271128000000.';

REVOKE ALL ON FUNCTION private.rt_broadcast_pipeline_entries() FROM PUBLIC, anon, authenticated, service_role;

-- zz_: AFTER triggers disparam em ordem alfabética; este vai por último.
CREATE TRIGGER zz_rt_broadcast_pipeline_entries_ins_del
  AFTER INSERT OR DELETE ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION private.rt_broadcast_pipeline_entries();

-- UPDATE que só carimba updated_at (no-op de UI, touch) não vira evento.
CREATE TRIGGER zz_rt_broadcast_pipeline_entries_upd
  AFTER UPDATE ON public.pipeline_entries
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION private.rt_broadcast_pipeline_entries();
