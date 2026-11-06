-- App Representantes: endereço estruturado e geocodificado do cliente.
-- Origem: rascunho modelo-endereco.sql do repositório Representantes, ensaiado no clone do schema do CRM (imagem torque-crm-real:base) com
-- suítes SQL, mutação e integração. NÃO foi executado em produção.
-- Ordem: depende das migrations anteriores desta série (20271227000000 -> 20271227010000 -> 20271227020000 -> 20271227030000).
-- Rollback: supabase/migrations/rollback/20271227000000_app_representantes_enderecos.sql
--
-- RASCUNHO v2 DA WAYSTONE 0. NÃO APLICADO NO CRM.
-- Testado em Postgres 15 (Docker) com stubs do CRM: ver backend/endereco/ (17 blocos, 80 asserts, mutações detectadas).
-- Ainda NÃO testado contra o schema real do CRM nem com concorrência real entre sessões.
-- v2 incorpora a revisão /hm-engineer de 2026-11-04 (21 achados).
-- Vive em Representantes/ porque o CRM (v8milennialsb2bv2) está somente leitura.
--
-- Antes de virar migration do CRM:
--   1. Rodar em Supabase local e passar os testes listados em W0-DETALHE.md.
--   2. Escolher o prefixo de versão olhando o LEDGER DE PROD, não só o repo
--      (o CRM já perdeu migrations por colisão de prefixo).
--   3. (feito em 2026-11-06) policy master_ghost_* e formato de lead_history conferidos no schema real.
--
-- Decisões do CTO (2026-11-04):
--   - Cliente = lead com primeira_venda_at preenchido.
--   - Empresa pronta quando 90% ou mais dos clientes têm endereço roteável.
--
-- Convenções copiadas do CRM (20270920000010 e 20271129000000):
--   - RLS com get_my_organization_ids() (plural). get_user_organization_id()
--     devolve só a org mais antiga e quebra quem tem várias.
--   - Escrita só por RPC SECURITY DEFINER com search_path vazio.
--   - Privilégios padrão do projeto dão ALL a anon/authenticated/service_role:
--     por isso o REVOKE ALL explícito.
--   - Erros: 42501 sem permissão, PT404 não encontrado (inclui org alheia),
--     PT409 conflito, PT422 dado inválido.
--   - Não toca `leads` (21 gatilhos de UPDATE). O lead entra só como FK.
--
-- Contrato com o app (mobile-api):
--   - Sincronização por (updated_at, id). updated_at só muda quando algo que o
--     app enxerga muda; tentativas/lease do worker não geram ruído no delta.
--   - O app manda p_expected_updated_at EXATAMENTE como recebeu (string), sem
--     passar por Date, para não perder microssegundos.
--   - Linhas que deixam de ser visíveis (lead reatribuído, lead excluído,
--     exclusão física) NÃO geram tombstone. O app reconcilia: pagina os IDs
--     visíveis (SELECT id sob RLS) e apaga o que sumiu. Ver S2.

BEGIN;

SET LOCAL lock_timeout = '3s';  -- a FK para leads pega SHARE ROW EXCLUSIVE

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lead_addresses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id),
  -- CASCADE: apagar o lead (inclusive por pedido de exclusão da LGPD) leva o endereço.
  lead_id               uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  label                 text NOT NULL DEFAULT 'principal'
                        CHECK (label IN ('principal', 'entrega', 'filial', 'outro')),
  is_primary            boolean NOT NULL DEFAULT false,

  -- Endereço obrigatório: só existe linha com endereço completo.
  -- Brasil apenas: CEP de 8 dígitos e UF de 2 letras.
  postal_code           text NOT NULL CHECK (postal_code ~ '^[0-9]{8}$'),
  street                text NOT NULL CHECK (btrim(street) <> '' AND char_length(street) <= 200),
  number                text CHECK (char_length(number) <= 20),
  no_number             boolean NOT NULL DEFAULT false,
  district              text NOT NULL CHECK (btrim(district) <> '' AND char_length(district) <= 100),
  city                  text NOT NULL CHECK (btrim(city) <> '' AND char_length(city) <= 100),
  uf                    text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  country               text NOT NULL DEFAULT 'BR' CHECK (country = 'BR'),

  complement            text CHECK (char_length(complement) <= 100),
  reference             text CHECK (char_length(reference) <= 200),

  -- Localização
  latitude              double precision CHECK (latitude  BETWEEN  -90 AND  90),
  longitude             double precision CHECK (longitude BETWEEN -180 AND 180),
  geocode_status        text NOT NULL DEFAULT 'pending'
                        CHECK (geocode_status IN ('pending', 'ok', 'low_confidence', 'failed', 'manual')),
  geocode_provider      text,
  geocode_accuracy      text,
  geocode_confidence    numeric(3, 2) CHECK (geocode_confidence BETWEEN 0 AND 1),
  geocoded_at           timestamptz,

  -- Controle do worker (não geram ruído no delta de sincronização)
  geocode_attempts        integer NOT NULL DEFAULT 0,
  geocode_claimed_until   timestamptz,
  geocode_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  geocode_last_error      text CHECK (char_length(geocode_last_error) <= 500),

  address_hash          text NOT NULL DEFAULT '',
  routable              boolean GENERATED ALWAYS AS (
                          deleted_at IS NULL
                          AND geocode_status IN ('ok', 'manual')
                          AND latitude IS NOT NULL
                          AND longitude IS NOT NULL
                        ) STORED,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid,

  CONSTRAINT lead_addresses_number_chk
    CHECK (no_number OR (number IS NOT NULL AND btrim(number) <> '')),
  CONSTRAINT lead_addresses_coords_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

COMMENT ON TABLE public.lead_addresses IS
  'Endereço completo e geocodificado do lead/cliente. Base da rota do app Representantes. Escrita só por RPC.';

CREATE UNIQUE INDEX lead_addresses_one_primary
  ON public.lead_addresses (lead_id)
  WHERE is_primary AND deleted_at IS NULL;

CREATE INDEX lead_addresses_pending
  ON public.lead_addresses (geocode_next_attempt_at)
  WHERE geocode_status = 'pending' AND deleted_at IS NULL;

CREATE INDEX lead_addresses_delta
  ON public.lead_addresses (organization_id, updated_at, id);

CREATE INDEX lead_addresses_lead ON public.lead_addresses (lead_id);

-- Trilha de auditoria (LGPD, RT-15). Guarda o endereço informado: dado pessoal.
-- Decisão: NÃO espelhar em lead_history (legível pelo time todo; guardaria o endereço, dado pessoal, fora
-- desta trilha restrita). Formato verificado: lead_history(lead_id, action, description, metadata jsonb,
-- source, entity_type, entity_id...). Se o CRM quiser a linha na timeline, gravar só "endereço alterado",
-- sem conteúdo. Retenção: lead_address_prune_events (24 meses).
CREATE TABLE public.lead_address_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address_id      uuid NOT NULL,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  action          text NOT NULL
                  CHECK (action IN ('created', 'updated', 'deleted', 'restored', 'pin_set', 'retry_requested')),
  actor           uuid,
  at              timestamptz NOT NULL DEFAULT now(),
  data            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX lead_address_events_lead ON public.lead_address_events (lead_id, at DESC);

-- Registro de operações do app (idempotência de verdade). O reenvio de uma operação que o
-- servidor já aplicou, mas cuja confirmação se perdeu, devolve o resultado anterior em vez de
-- falhar com PT409: a versão (updated_at) já mudou por causa da própria operação.
-- Chave por usuário: um op_id de outra pessoa nunca devolve resultado alheio.
-- Retenção: lead_address_prune_op_log. O app descarta operação mais velha que a retenção.
CREATE TABLE public.mobile_op_log (
  actor      text        NOT NULL,   -- auth.uid()::text, ou 'service'
  op_id      uuid        NOT NULL,
  entity_id  uuid        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, op_id)
);
CREATE INDEX mobile_op_log_applied_at ON public.mobile_op_log (applied_at);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Gatilho: normaliza, calcula o hash, devolve a pending quando o endereço
--    muda e só avança updated_at quando algo visível ao app mudou.
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.lead_addresses_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_hash   text;
  -- Colunas do worker e derivadas: mudar só elas não conta como mudança visível.
  v_ignore text[] := ARRAY['updated_at', 'routable', 'geocode_attempts',
                           'geocode_claimed_until', 'geocode_next_attempt_at',
                           'geocode_last_error'];
BEGIN
  NEW.postal_code := regexp_replace(coalesce(NEW.postal_code, ''), '\D', '', 'g');
  NEW.uf          := upper(btrim(coalesce(NEW.uf, '')));
  NEW.country     := upper(btrim(coalesce(NEW.country, 'BR')));

  -- Caixa e espaços normalizados. (unaccent entraria aqui se a extensão estiver ativa.)
  v_hash := md5(concat_ws('|',
    NEW.postal_code,
    regexp_replace(lower(btrim(coalesce(NEW.street,   ''))), '\s+', ' ', 'g'),
    regexp_replace(lower(btrim(coalesce(NEW.number,   ''))), '\s+', ' ', 'g'),
    regexp_replace(lower(btrim(coalesce(NEW.district, ''))), '\s+', ' ', 'g'),
    regexp_replace(lower(btrim(coalesce(NEW.city,     ''))), '\s+', ' ', 'g'),
    NEW.uf,
    NEW.country
  ));

  IF TG_OP = 'INSERT' OR v_hash IS DISTINCT FROM OLD.address_hash THEN
    NEW.address_hash            := v_hash;
    NEW.geocode_status          := 'pending';
    NEW.latitude                := NULL;
    NEW.longitude               := NULL;
    NEW.geocode_provider        := NULL;
    NEW.geocode_accuracy        := NULL;
    NEW.geocode_confidence      := NULL;
    NEW.geocoded_at             := NULL;
    NEW.geocode_attempts        := 0;
    NEW.geocode_claimed_until   := NULL;
    NEW.geocode_next_attempt_at := now();
    NEW.geocode_last_error      := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - v_ignore) IS DISTINCT FROM (to_jsonb(OLD) - v_ignore) THEN
      NEW.updated_at := now();
    ELSE
      NEW.updated_at := OLD.updated_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER lead_addresses_before_write
  BEFORE INSERT OR UPDATE ON public.lead_addresses
  FOR EACH ROW EXECUTE FUNCTION public.lead_addresses_before_write();

-- ───────────────────────────────────────────────────────────────────────────
-- 3. RLS e privilégios
--    Linhas excluídas continuam legíveis de propósito: o delta do app precisa
--    ver deleted_at. Perda de visibilidade (reatribuição) o app resolve por
--    reconciliação de IDs.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lead_addresses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_address_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_op_log        ENABLE ROW LEVEL SECURITY;  -- sem policy: só service_role e funções SECURITY DEFINER

CREATE POLICY lead_addresses_select ON public.lead_addresses
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_addresses.lead_id)  -- a RLS de leads decide
  );

-- Convenção do CRM (verificada no schema real: 70 tabelas): master_ghost_select_<tabela> com
-- `(SELECT is_master_user())`. O CRM também cria master_ghost_all_<tabela>; aqui NÃO: a escrita é só
-- por RPC, então o master também só lê.
CREATE POLICY master_ghost_select_lead_addresses ON public.lead_addresses
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

CREATE POLICY lead_address_events_select ON public.lead_address_events
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_address_events.lead_id)
  );

CREATE POLICY master_ghost_select_lead_address_events ON public.lead_address_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

-- Privilégios padrão do projeto dão ALL a authenticated (inclui TRUNCATE, que
-- ignora RLS). Revoga tudo e devolve só SELECT.
REVOKE ALL ON TABLE public.lead_addresses      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lead_address_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lead_addresses      TO authenticated;
GRANT SELECT ON TABLE public.lead_address_events TO authenticated;
GRANT ALL    ON TABLE public.lead_addresses      TO service_role;
GRANT ALL    ON TABLE public.lead_address_events TO service_role;
REVOKE ALL ON TABLE public.mobile_op_log FROM PUBLIC, anon, authenticated;
GRANT ALL  ON TABLE public.mobile_op_log TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Autorização central
--    Uma só porta: lead inexistente, excluído ou de outra organização dá PT404
--    (não vaza existência). service_role passa. Membro sem permissão: 42501.
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.lead_address_authorize(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_org     uuid;
BEGIN
  IF auth.uid() IS NULL AND NOT v_service THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;

  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead não encontrado' USING ERRCODE = 'PT404';
  END IF;
  IF v_org IS NULL THEN
    -- Só o backend precisa saber do problema. Usuário comum: lead inalcançável.
    IF v_service THEN
      RAISE EXCEPTION 'lead sem organização' USING ERRCODE = 'PT422';
    END IF;
    RAISE EXCEPTION 'lead não encontrado' USING ERRCODE = 'PT404';
  END IF;

  IF NOT v_service THEN
    IF v_org NOT IN (SELECT public.get_my_organization_ids()) THEN
      RAISE EXCEPTION 'lead não encontrado' USING ERRCODE = 'PT404';  -- org alheia
    END IF;
    IF NOT public.can_update_lead(p_lead_id) THEN
      RAISE EXCEPTION 'sem permissão para alterar o lead' USING ERRCODE = '42501';
    END IF;
    -- Permissão própria: o admin pode tirar a edição de endereço de um membro sem tirar a edição do lead.
    IF NOT public.has_feature_permission('leads.edit_address', v_org) THEN
      RAISE EXCEPTION 'sem permissão para editar endereço' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_org;
END;
$fn$;

-- Permissão nova no catálogo do CRM. default_value = true: quem já edita o lead continua editando o
-- endereço (nada muda no dia 1); o admin desliga por membro com member_feature_permissions.
-- Herda módulo e ordem de leads.edit. Idempotente.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
SELECT 'leads.edit_address', fp.module, 'Editar endereço do lead',
       'Cadastrar, corrigir e excluir o endereço (e o pin no mapa) de um lead.', false, true, fp.sort_order + 1
  FROM public.feature_permissions fp
 WHERE fp.key = 'leads.edit'
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. RPCs de escrita (CRM e app)
-- ───────────────────────────────────────────────────────────────────────────

-- Cria ou atualiza.
--   p_id                  gerado no aparelho: reenviar não duplica.
--   p_expected_updated_at versão que o aparelho viu: se divergir, PT409.
--   p_restore             obrigatório para reviver linha excluída.
--   p_op_id               id da operação na fila do app: reenvio devolve o resultado anterior.
CREATE FUNCTION public.lead_address_upsert(
  p_lead_id             uuid,
  p_address             jsonb,
  p_id                  uuid        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_restore             boolean     DEFAULT false,
  p_op_id               uuid        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org       uuid;
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  v_key       text;
  v_cur       record;
  v_exists    boolean;
  v_has_other boolean;
  v_primary   boolean;
  v_no_number boolean;
  v_action    text := 'created';
  v_actor     text := coalesce(auth.uid()::text, 'service');
  v_prev      uuid;
BEGIN
  v_org := public.lead_address_authorize(p_lead_id);

  -- Tipos do JSON: erro de cast vira PT422, não 22P02.
  IF jsonb_typeof(p_address) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'endereço inválido' USING ERRCODE = 'PT422';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['postal_code', 'street', 'number', 'district', 'city',
                               'uf', 'country', 'complement', 'reference', 'label']
  LOOP
    IF p_address ? v_key AND jsonb_typeof(p_address -> v_key) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'campo % deve ser texto', v_key USING ERRCODE = 'PT422';
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['no_number', 'is_primary']
  LOOP
    IF p_address ? v_key AND jsonb_typeof(p_address -> v_key) NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'campo % deve ser booleano', v_key USING ERRCODE = 'PT422';
    END IF;
  END LOOP;

  v_no_number := coalesce((p_address->>'no_number')::boolean, false);

  IF coalesce(p_address->>'postal_code', '') = ''
     OR coalesce(btrim(p_address->>'street'),   '') = ''
     OR coalesce(btrim(p_address->>'district'), '') = ''
     OR coalesce(btrim(p_address->>'city'),     '') = ''
     OR coalesce(btrim(p_address->>'uf'),       '') = ''
     OR (NOT v_no_number AND coalesce(btrim(p_address->>'number'), '') = '')
     OR coalesce(p_address->>'label', 'principal') NOT IN ('principal', 'entrega', 'filial', 'outro')
     OR coalesce(p_address->>'country', 'BR') <> 'BR'
  THEN
    RAISE EXCEPTION 'endereço incompleto ou inválido' USING ERRCODE = 'PT422';
  END IF;

  -- Reenvio de operação já aplicada: devolve o resultado, sem checar versão nem reaplicar.
  -- O registro nasce aqui e morre junto se qualquer checagem abaixo falhar.
  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.mobile_op_log (actor, op_id, entity_id)
    VALUES (v_actor, p_op_id, v_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      SELECT l.entity_id INTO v_prev FROM public.mobile_op_log l
       WHERE l.actor = v_actor AND l.op_id = p_op_id;
      RETURN v_prev;
    END IF;
  END IF;

  -- Linha existente: dono, exclusão e versão.
  SELECT a.lead_id, a.deleted_at, a.updated_at INTO v_cur
    FROM public.lead_addresses a WHERE a.id = v_id FOR UPDATE;
  v_exists := FOUND;

  IF v_exists THEN
    IF v_cur.lead_id <> p_lead_id THEN
      RAISE EXCEPTION 'id em uso' USING ERRCODE = 'PT409';
    END IF;
    IF v_cur.deleted_at IS NOT NULL AND NOT p_restore THEN
      RAISE EXCEPTION 'endereço excluído' USING ERRCODE = 'PT409';
    END IF;
    IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'conflito de versão' USING ERRCODE = 'PT409', DETAIL = v_cur.updated_at::text;
    END IF;
    v_action := CASE WHEN v_cur.deleted_at IS NOT NULL THEN 'restored' ELSE 'updated' END;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.lead_addresses a
     WHERE a.lead_id = p_lead_id AND a.deleted_at IS NULL AND a.id <> v_id
  ) INTO v_has_other;

  -- O único endereço ativo do lead é sempre o principal.
  v_primary := CASE WHEN NOT v_has_other THEN true
                    ELSE coalesce((p_address->>'is_primary')::boolean, false) END;

  BEGIN
    IF v_primary THEN
      UPDATE public.lead_addresses
         SET is_primary = false, updated_by = auth.uid()
       WHERE lead_id = p_lead_id AND is_primary AND deleted_at IS NULL AND id <> v_id;
    END IF;

    IF v_exists THEN
      UPDATE public.lead_addresses SET
        label       = coalesce(p_address->>'label', 'principal'),
        is_primary  = v_primary,
        postal_code = p_address->>'postal_code',
        street      = p_address->>'street',
        number      = p_address->>'number',
        no_number   = v_no_number,
        district    = p_address->>'district',
        city        = p_address->>'city',
        uf          = p_address->>'uf',
        country     = coalesce(p_address->>'country', 'BR'),
        complement  = p_address->>'complement',
        reference   = p_address->>'reference',
        updated_by  = auth.uid(),
        deleted_at  = NULL,
        deleted_by  = NULL
      WHERE id = v_id;
    ELSE
      INSERT INTO public.lead_addresses (
        id, organization_id, lead_id, label, is_primary,
        postal_code, street, number, no_number, district, city, uf, country,
        complement, reference, created_by, updated_by
      ) VALUES (
        v_id, v_org, p_lead_id, coalesce(p_address->>'label', 'principal'), v_primary,
        p_address->>'postal_code', p_address->>'street', p_address->>'number', v_no_number,
        p_address->>'district', p_address->>'city', p_address->>'uf',
        coalesce(p_address->>'country', 'BR'),
        p_address->>'complement', p_address->>'reference', auth.uid(), auth.uid()
      );
    END IF;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'endereço inválido' USING ERRCODE = 'PT422';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'conflito de endereço principal' USING ERRCODE = 'PT409';
  END;

  INSERT INTO public.lead_address_events (address_id, lead_id, organization_id, action, actor, data)
  VALUES (v_id, p_lead_id, v_org, v_action, auth.uid(), p_address);

  RETURN v_id;
END;
$fn$;

-- Ajuste manual do pin (CRM). A localização passa a valer como 'manual'.
CREATE FUNCTION public.lead_address_set_pin(
  p_address_id uuid,
  p_lat        double precision,
  p_lng        double precision
)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_lead uuid;
  v_org  uuid;
BEGIN
  SELECT a.lead_id INTO v_lead
    FROM public.lead_addresses a WHERE a.id = p_address_id AND a.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'endereço não encontrado' USING ERRCODE = 'PT404';
  END IF;
  v_org := public.lead_address_authorize(v_lead);

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'coordenada inválida' USING ERRCODE = 'PT422';
  END IF;

  UPDATE public.lead_addresses
     SET latitude = p_lat, longitude = p_lng,
         geocode_status = 'manual', geocode_provider = 'manual',
         geocode_accuracy = 'pin', geocode_confidence = 1,
         geocoded_at = now(), geocode_claimed_until = NULL, geocode_last_error = NULL,
         updated_by = auth.uid()
   WHERE id = p_address_id;

  INSERT INTO public.lead_address_events (address_id, lead_id, organization_id, action, actor, data)
  VALUES (p_address_id, v_lead, v_org, 'pin_set', auth.uid(),
          jsonb_build_object('latitude', p_lat, 'longitude', p_lng));
END;
$fn$;

-- Exclusão lógica. Se era o principal, o endereço ativo mais recente assume.
-- p_op_id: reenvio de exclusão já aplicada não vira PT404.
CREATE FUNCTION public.lead_address_delete(p_address_id uuid, p_op_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_lead    uuid;
  v_org     uuid;
  v_primary boolean;
  v_deleted timestamptz;
  v_actor   text := coalesce(auth.uid()::text, 'service');
BEGIN
  SELECT a.lead_id, a.is_primary, a.deleted_at INTO v_lead, v_primary, v_deleted
    FROM public.lead_addresses a WHERE a.id = p_address_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'endereço não encontrado' USING ERRCODE = 'PT404';
  END IF;
  v_org := public.lead_address_authorize(v_lead);

  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.mobile_op_log (actor, op_id, entity_id)
    VALUES (v_actor, p_op_id, p_address_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN;  -- já aplicada
    END IF;
  END IF;

  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'endereço não encontrado' USING ERRCODE = 'PT404';
  END IF;

  UPDATE public.lead_addresses
     SET deleted_at = now(), deleted_by = auth.uid(), is_primary = false, updated_by = auth.uid()
   WHERE id = p_address_id;

  IF v_primary THEN
    UPDATE public.lead_addresses
       SET is_primary = true, updated_by = auth.uid()
     WHERE id = (
       SELECT a.id FROM public.lead_addresses a
        WHERE a.lead_id = v_lead AND a.deleted_at IS NULL AND a.id <> p_address_id
        ORDER BY a.updated_at DESC, a.id
        LIMIT 1
     );
  END IF;

  INSERT INTO public.lead_address_events (address_id, lead_id, organization_id, action, actor, data)
  VALUES (p_address_id, v_lead, v_org, 'deleted', auth.uid(), '{}'::jsonb);
END;
$fn$;

-- Botão "tentar de novo" no CRM para endereço que ficou em failed.
CREATE FUNCTION public.lead_address_retry_geocode(p_address_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_lead uuid;
  v_org  uuid;
BEGIN
  SELECT a.lead_id INTO v_lead
    FROM public.lead_addresses a WHERE a.id = p_address_id AND a.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'endereço não encontrado' USING ERRCODE = 'PT404';
  END IF;
  v_org := public.lead_address_authorize(v_lead);

  UPDATE public.lead_addresses
     SET geocode_status = 'pending', geocode_attempts = 0, geocode_claimed_until = NULL,
         geocode_next_attempt_at = now(), geocode_last_error = NULL, updated_by = auth.uid()
   WHERE id = p_address_id AND geocode_status IN ('failed', 'low_confidence');

  INSERT INTO public.lead_address_events (address_id, lead_id, organization_id, action, actor, data)
  VALUES (p_address_id, v_lead, v_org, 'retry_requested', auth.uid(), '{}'::jsonb);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Funções do worker de geocodificação (só service_role)
-- ───────────────────────────────────────────────────────────────────────────

-- Reserva um lote com LEASE. SKIP LOCKED sozinho não basta: o lock termina com
-- a chamada. O lease impede que outro worker pegue as mesmas linhas, e o
-- debounce evita uma chamada paga por tecla digitada no CRM.
CREATE FUNCTION public.lead_address_claim_pending(
  p_limit    integer  DEFAULT 50,
  p_lease    interval DEFAULT interval '5 minutes',
  p_debounce interval DEFAULT interval '30 seconds'
)
RETURNS TABLE (
  id uuid, address_hash text, postal_code text, street text, number text,
  district text, city text, uf text, country text
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT a.id
      FROM public.lead_addresses a
     WHERE a.geocode_status = 'pending'
       AND a.deleted_at IS NULL
       AND a.geocode_attempts < 5
       AND a.geocode_next_attempt_at <= now()
       AND (a.geocode_claimed_until IS NULL OR a.geocode_claimed_until < now())
       AND a.updated_at < now() - p_debounce
     ORDER BY a.geocode_next_attempt_at
     LIMIT greatest(1, least(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.lead_addresses a
     SET geocode_attempts = a.geocode_attempts + 1,
         geocode_claimed_until = now() + p_lease
    FROM picked
   WHERE a.id = picked.id
  RETURNING a.id, a.address_hash, a.postal_code, a.street, a.number,
            a.district, a.city, a.uf, a.country;
END;
$fn$;

-- Resultado com coordenada. O hash descarta resultado de endereço que mudou no
-- meio do caminho. Valores de accuracy a confirmar no spike S4.
CREATE FUNCTION public.lead_address_apply_geocode(
  p_id            uuid,
  p_expected_hash text,
  p_lat           double precision,
  p_lng           double precision,
  p_provider      text,
  p_accuracy      text,
  p_confidence    numeric
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'coordenada ausente: use lead_address_mark_geocode_failure' USING ERRCODE = 'PT422';
  END IF;

  IF p_accuracy IN ('rooftop', 'parcel', 'point') AND coalesce(p_confidence, 0) >= 0.8 THEN
    v_status := 'ok';
  ELSE
    v_status := 'low_confidence';
  END IF;

  UPDATE public.lead_addresses
     SET latitude = p_lat, longitude = p_lng,
         geocode_status = v_status, geocode_provider = p_provider,
         geocode_accuracy = p_accuracy, geocode_confidence = p_confidence,
         geocoded_at = now(), geocode_claimed_until = NULL, geocode_last_error = NULL
   WHERE id = p_id
     AND address_hash = p_expected_hash
     AND deleted_at IS NULL
     AND geocode_status = 'pending';

  RETURN FOUND;
END;
$fn$;

-- Falha. Erro transitório (timeout, 5xx) volta à fila com backoff; "não achou"
-- vira failed na hora. Esgotadas as tentativas, também vira failed.
CREATE FUNCTION public.lead_address_mark_geocode_failure(
  p_id            uuid,
  p_expected_hash text,
  p_retryable     boolean,
  p_error         text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.lead_addresses a
     SET geocode_last_error    = left(p_error, 500),
         geocode_claimed_until = NULL,
         geocode_status = CASE WHEN p_retryable AND a.geocode_attempts < 5
                               THEN 'pending' ELSE 'failed' END,
         geocode_next_attempt_at = CASE WHEN p_retryable AND a.geocode_attempts < 5
                                        THEN now() + (interval '1 minute' * power(2::double precision, a.geocode_attempts::double precision))
                                        ELSE a.geocode_next_attempt_at END
   WHERE a.id = p_id
     AND a.address_hash = p_expected_hash
     AND a.deleted_at IS NULL
     AND a.geocode_status = 'pending';

  RETURN FOUND;
END;
$fn$;

-- Limpeza do registro de operações. Agendar com pg_cron (por exemplo diariamente).
-- A retenção tem de ser MAIOR que a idade máxima de uma operação na fila do app (14 dias).
CREATE FUNCTION public.lead_address_prune_op_log(p_older_than interval DEFAULT interval '30 days')
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.mobile_op_log WHERE applied_at < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Retenção da trilha de endereço (dado pessoal, LGPD). Padrão 24 meses. Agendar com pg_cron
-- (por exemplo semanalmente). A exclusão do lead já leva a trilha junto (ON DELETE CASCADE).
CREATE FUNCTION public.lead_address_prune_events(p_older_than interval DEFAULT interval '24 months')
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_older_than < interval '90 days' THEN
    RAISE EXCEPTION 'retenção mínima de 90 dias' USING ERRCODE = 'PT422';
  END IF;
  DELETE FROM public.lead_address_events WHERE at < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Varredura: pendente com tentativas esgotadas e lease vencido vira failed.
-- Agendar com pg_cron (já existe no CRM), por exemplo a cada 5 minutos.
CREATE FUNCTION public.lead_address_expire_exhausted()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.lead_addresses
     SET geocode_status = 'failed', geocode_last_error = 'tentativas esgotadas',
         geocode_claimed_until = NULL
   WHERE geocode_status = 'pending' AND deleted_at IS NULL
     AND geocode_attempts >= 5
     AND (geocode_claimed_until IS NULL OR geocode_claimed_until < now());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Prontidão da organização
--    Cliente = primeira_venda_at preenchido (decisão do CTO).
--    Pronta com p_threshold% ou mais de clientes com endereço roteável.
--    OPCIONAL, medir antes: índice parcial em leads (organization_id)
--    WHERE primeira_venda_at IS NOT NULL AND deleted_at IS NULL. Não vai aqui
--    porque toca `leads`.
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.org_address_readiness(p_org uuid, p_threshold numeric DEFAULT 90)
RETURNS TABLE (total_clients bigint, with_address bigint, routable bigint, pct_routable numeric, ready boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM public.assert_org_access(p_org);

  RETURN QUERY
  WITH clients AS (
    SELECT l.id
      FROM public.leads l
     WHERE l.organization_id = p_org
       AND l.deleted_at IS NULL
       AND l.primeira_venda_at IS NOT NULL
  ), addr AS (
    SELECT DISTINCT ON (a.lead_id) a.lead_id, a.routable
      FROM public.lead_addresses a
     WHERE a.organization_id = p_org AND a.deleted_at IS NULL
     ORDER BY a.lead_id, a.is_primary DESC, a.updated_at DESC
  ), agg AS (
    SELECT count(*)                                     AS n_clients,
           count(addr.lead_id)                          AS n_with,
           count(*) FILTER (WHERE addr.routable)        AS n_routable
      FROM clients c
      LEFT JOIN addr ON addr.lead_id = c.id
  )
  SELECT agg.n_clients::bigint, agg.n_with::bigint, agg.n_routable::bigint,
         CASE WHEN agg.n_clients = 0 THEN 0
              ELSE round(100.0 * agg.n_routable / agg.n_clients, 1) END,
         -- CASE evita divisão por zero: o AND não garante ordem de avaliação.
         CASE WHEN agg.n_clients = 0 THEN false
              ELSE (100.0 * agg.n_routable / agg.n_clients) >= p_threshold END
    FROM agg;
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. Privilégios das funções
-- ───────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.lead_address_authorize(uuid)
  FROM PUBLIC, anon, authenticated, service_role;  -- só as RPCs (dono) chamam

REVOKE ALL ON FUNCTION public.lead_address_upsert(uuid, jsonb, uuid, timestamptz, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_address_set_pin(uuid, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_address_delete(uuid, uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_address_retry_geocode(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_address_readiness(uuid, numeric) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.lead_address_claim_pending(integer, interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_address_apply_geocode(uuid, text, double precision, double precision, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_address_mark_geocode_failure(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_address_expire_exhausted()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_address_prune_op_log(interval)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_address_prune_events(interval)  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lead_address_upsert(uuid, jsonb, uuid, timestamptz, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_set_pin(uuid, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_delete(uuid, uuid)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_retry_geocode(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_address_readiness(uuid, numeric) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.lead_address_claim_pending(integer, interval, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_apply_geocode(uuid, text, double precision, double precision, text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_mark_geocode_failure(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_expire_exhausted()      TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_prune_op_log(interval)  TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_address_prune_events(interval)  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

