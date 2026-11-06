-- App Representantes: papéis Admin/Representante, produtos e plano do dia.
-- Origem: rascunho modelo-papeis.sql do repositório Representantes, ensaiado no clone do schema do CRM (imagem torque-crm-real:base) com
-- suítes SQL, mutação e integração. NÃO foi executado em produção.
-- Ordem: depende das migrations anteriores desta série (20271227000000 -> 20271227010000 -> 20271227020000 -> 20271227030000).
-- Rollback: supabase/migrations/rollback/20271227030000_app_representantes_papeis.sql
--
--
-- Os dois papéis do app VÊM DO TORQUE, não são um cadastro novo:
--   · Admin         = membro ativo com team_members.role = 'admin' na empresa (é o mesmo critério de is_org_admin()).
--   · Representante = qualquer outro membro ativo da empresa (sdr, closer, bdr, member...).
--   O app pergunta `mobile_me()` ao abrir e decide a interface; a SEGURANÇA continua no servidor (RPCs e RLS abaixo).
--
-- O que esta migration faz
--   1. mobile_me()            quem sou eu em cada empresa: papel, número de WhatsApp conectado, empresa liberada.
--   2. mobile_product_save()  admin cadastra, edita e desativa produto (idempotente; conflito de versão PT409).
--   3. rep_day_plans/_stops   o PLANO DO DIA: o admin monta a lista de clientes e as instruções do dia de um representante;
--                             o representante também monta o próprio (autonomia) e pode ajustar o que o admin passou.
--   4. mobile_plan_save()     grava o plano inteiro (snapshot), idempotente.
--   5. lead_addresses_select  ampliada: o representante lê o ENDEREÇO dos clientes que estão no plano dele.
--
-- Decisões (verificadas no schema real do CRM)
--   · Produto: o RLS do CRM deixa QUALQUER membro da empresa escrever em `products` (products_*_own_org). O app só
--     escreve por mobile_product_save, que exige admin. Isso NÃO fecha a porta do CRM web nem do PostgREST direto: fechar
--     é mudar a política do CRM (decisão do CTO, fora desta migration). O representante LÊ o catálogo pela política de
--     leitura existente (products_select_own_org).
--   · Plano do dia: um plano ABERTO por representante, empresa e data. Todas as paradas são da empresa do plano.
--     Admin da empresa cria e altera planos de qualquer membro; o representante cria e altera os SEUS (inclusive os que o
--     admin montou: é a autonomia pedida). Ninguém muda o dono de um plano; para outro representante, cria-se outro plano.
--   · O plano NÃO dá direito ao lead: o representante lê o endereço (para rotear), mas pedido continua exigindo o lead
--     visível pela RLS do CRM (responsável). Cliente sem responsável: o admin precisa atribuir o lead.
--   · Número de WhatsApp: a instância do representante é a `preferred_whatsapp_instance_id` do membro; sem ela, a que ele
--     é dono (`owner_team_member_id`). Quem lê é o próprio membro (a RLS de whatsapp_instances decide).
--   · Erros: 42501 (sem sessão, sem permissão de admin, RLS), PT404 (inexistente OU de outra empresa), PT409 (op_id
--     reutilizado com outro corpo; versão do produto mudou; já existe plano aberto no dia), PT422 (dado inválido).
--
-- Antes de aplicar em produção: conferir o ledger de prod (o número acima foi escolhido depois de 20271226000000).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. mobile_me
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.mobile_me()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'memberships', coalesce(jsonb_agg(s.m ORDER BY s.m ->> 'org_name'), '[]'::jsonb)
  )
  FROM (
    SELECT jsonb_build_object(
      'member_id', tm.id,
      'org_id', o.id,
      'org_name', o.name,
      'name', tm.name,
      'crm_role', tm.role::text,
      'app_role', CASE WHEN tm.role = 'admin' THEN 'admin' ELSE 'representante' END,
      'app_enabled', coalesce(o.feature_flags -> 'representantes_app' = 'true'::jsonb, false),
      'whatsapp', (
        SELECT jsonb_build_object('instance_id', wi.id, 'name', wi.instance_name, 'phone', wi.phone_number, 'status', wi.status)
          FROM public.whatsapp_instances wi
         WHERE wi.organization_id = o.id
           AND (wi.id = tm.preferred_whatsapp_instance_id OR wi.owner_team_member_id = tm.id)
         ORDER BY (wi.id = tm.preferred_whatsapp_instance_id) DESC, wi.created_at
         LIMIT 1)
    ) AS m
      FROM public.team_members tm
      JOIN public.organizations o ON o.id = tm.organization_id
     WHERE tm.user_id = auth.uid() AND tm.is_active
  ) s
$fn$;
COMMENT ON FUNCTION public.mobile_me() IS 'Quem é o usuário em cada empresa: papel no app (admin|representante), WhatsApp conectado e se a empresa liberou o app.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. mobile_product_save (só admin)
-- ───────────────────────────────────────────────────────────────────────────
-- p_product: { "id": uuid (opcional: gerado no aparelho), "name": text, "type": "mrr|projeto|unitario" (padrão unitario),
--              "ticket": numeric > 0, "ticket_minimo": numeric (opcional, > 0 e <= ticket), "sku": text, "description": text,
--              "is_active": boolean (padrão true), "expected_updated_at": timestamptz (opcional: conflito se a versão mudou) }
CREATE FUNCTION public.mobile_product_save(p_org uuid, p_op_id uuid, p_product jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_name    text;
  v_type    text;
  v_ticket  numeric;
  v_min     numeric;
  v_sku     text;
  v_desc    text;
  v_active  boolean;
  v_expect  timestamptz;
  v_hash    text;
  v_begin   record;
  v_cur     record;
  v_action  text;
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NULL OR p_op_id IS NULL THEN
    RAISE EXCEPTION 'empresa e operação são obrigatórias' USING ERRCODE = 'PT422';
  END IF;
  IF NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'somente o administrador da empresa cadastra produtos' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_product) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'produto inválido' USING ERRCODE = 'PT422';
  END IF;

  BEGIN
    v_id     := coalesce((p_product ->> 'id')::uuid, gen_random_uuid());
    v_name   := btrim(coalesce(p_product ->> 'name', ''));
    v_type   := coalesce(nullif(p_product ->> 'type', ''), 'unitario');
    v_ticket := (p_product ->> 'ticket')::numeric;
    v_min    := (p_product ->> 'ticket_minimo')::numeric;
    v_sku    := nullif(btrim(coalesce(p_product ->> 'sku', '')), '');
    v_desc   := nullif(btrim(coalesce(p_product ->> 'description', '')), '');
    v_active := coalesce((p_product ->> 'is_active')::boolean, true);
    v_expect := (p_product ->> 'expected_updated_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'produto com valor fora do formato' USING ERRCODE = 'PT422';
  END;

  IF v_name = '' OR char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'o nome do produto é obrigatório (até 200 caracteres)' USING ERRCODE = 'PT422';
  END IF;
  IF v_type NOT IN ('mrr', 'projeto', 'unitario') THEN
    RAISE EXCEPTION 'tipo de produto inválido' USING ERRCODE = 'PT422';
  END IF;
  IF v_ticket IS NULL OR v_ticket <= 0 OR v_ticket > 100000000 THEN
    RAISE EXCEPTION 'o preço precisa ser maior que zero' USING ERRCODE = 'PT422';
  END IF;
  IF v_min IS NOT NULL AND (v_min <= 0 OR v_min > v_ticket) THEN
    RAISE EXCEPTION 'o preço mínimo precisa ser maior que zero e não passar do preço' USING ERRCODE = 'PT422';
  END IF;
  IF char_length(coalesce(v_sku, '')) > 80 OR char_length(coalesce(v_desc, '')) > 2000 THEN
    RAISE EXCEPTION 'sku ou descrição longos demais' USING ERRCODE = 'PT422';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object('org', p_org, 'id', v_id, 'name', v_name, 'type', v_type, 'ticket', v_ticket,
              'min', v_min, 'sku', v_sku, 'desc', v_desc, 'active', v_active, 'expect', v_expect)::text, 'UTF8')), 'hex');
  SELECT * INTO v_begin FROM public.mobile_op_begin(p_op_id, 'product', v_hash);
  IF NOT v_begin.is_new THEN
    RETURN jsonb_build_object('status', 'replayed', 'product_id', v_begin.entity_id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_product:' || v_id::text, 0));

  SELECT p.organization_id, p.updated_at INTO v_cur FROM public.products p WHERE p.id = v_id;
  IF FOUND THEN
    IF v_cur.organization_id IS DISTINCT FROM p_org THEN
      RAISE EXCEPTION 'produto não encontrado' USING ERRCODE = 'PT404';
    END IF;
    IF v_expect IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'o produto foi alterado por outra pessoa; recarregue e tente de novo' USING ERRCODE = 'PT409';
    END IF;
    v_action := 'updated';
    UPDATE public.products
       SET name = v_name, type = v_type, ticket = v_ticket, ticket_minimo = v_min, sku = v_sku, description = v_desc, is_active = v_active
     WHERE id = v_id AND organization_id = p_org
     RETURNING updated_at INTO v_updated;
  ELSE
    v_action := 'created';
    BEGIN
      INSERT INTO public.products (id, organization_id, name, type, ticket, ticket_minimo, sku, description, is_active)
      VALUES (v_id, p_org, v_name, v_type, v_ticket, v_min, v_sku, v_desc, v_active)
      RETURNING updated_at INTO v_updated;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'produto não encontrado' USING ERRCODE = 'PT404';  -- id já existe em outra empresa: mesma resposta
    END;
  END IF;

  PERFORM public.mobile_op_finish(p_op_id, v_id);
  RETURN jsonb_build_object('status', v_action, 'product_id', v_id, 'updated_at', v_updated);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Plano do dia
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.rep_day_plans (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,                       -- o representante que vai cumprir o dia
  plan_date       date NOT NULL,
  title           text CHECK (char_length(title) <= 120),
  notes           text CHECK (char_length(notes) <= 1000),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'canceled')),
  created_by      uuid NOT NULL,                       -- quem montou (o admin ou o próprio representante)
  updated_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rep_day_plans IS 'Plano do dia do representante: clientes e instruções, montado pelo admin ou pelo próprio. Escrita por mobile_plan_save.';

-- Um plano aberto por representante, empresa e dia.
CREATE UNIQUE INDEX rep_day_plans_one_open ON public.rep_day_plans (organization_id, user_id, plan_date) WHERE status = 'open';
CREATE INDEX rep_day_plans_user_date_idx ON public.rep_day_plans (user_id, plan_date DESC);

CREATE TABLE public.rep_day_plan_stops (
  plan_id         uuid NOT NULL REFERENCES public.rep_day_plans (id) ON DELETE CASCADE,
  address_id      uuid NOT NULL REFERENCES public.lead_addresses (id),
  lead_id         uuid NOT NULL,
  organization_id uuid NOT NULL,
  position        integer NOT NULL CHECK (position >= 1),
  note            text CHECK (char_length(note) <= 200),
  PRIMARY KEY (plan_id, address_id),
  CONSTRAINT rep_day_plan_stops_position_uniq UNIQUE (plan_id, position) DEFERRABLE INITIALLY DEFERRED  -- reordenar troca posições na mesma transação
);
CREATE INDEX rep_day_plan_stops_address_idx ON public.rep_day_plan_stops (address_id);

ALTER TABLE public.rep_day_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_day_plan_stops ENABLE ROW LEVEL SECURITY;

-- Quem lê: o representante do plano e o admin da empresa.
CREATE POLICY rep_day_plans_select ON public.rep_day_plans
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_org_admin(organization_id));

-- Quem cria: o representante para si, ou o admin da empresa para um membro ativo dela.
CREATE POLICY rep_day_plans_insert ON public.rep_day_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid()) AND updated_by = (SELECT auth.uid())
    AND (user_id = (SELECT auth.uid()) OR public.is_org_admin(organization_id))
    AND EXISTS (SELECT 1 FROM public.team_members tm
                 WHERE tm.user_id = rep_day_plans.user_id AND tm.organization_id = rep_day_plans.organization_id AND tm.is_active)
  );

-- Quem altera: o representante do plano (autonomia) e o admin. O dono e a empresa NÃO mudam (WITH CHECK confere o mesmo).
CREATE POLICY rep_day_plans_update ON public.rep_day_plans
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_org_admin(organization_id))
  WITH CHECK (updated_by = (SELECT auth.uid()) AND (user_id = (SELECT auth.uid()) OR public.is_org_admin(organization_id)));

CREATE POLICY master_ghost_select_rep_day_plans ON public.rep_day_plans
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));

CREATE POLICY rep_day_plan_stops_select ON public.rep_day_plan_stops
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_day_plans p WHERE p.id = rep_day_plan_stops.plan_id));  -- a RLS do plano decide

CREATE POLICY rep_day_plan_stops_insert ON public.rep_day_plan_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.rep_day_plans p
             WHERE p.id = rep_day_plan_stops.plan_id AND p.organization_id = rep_day_plan_stops.organization_id)
    AND EXISTS (SELECT 1 FROM public.lead_addresses a
                 WHERE a.id = rep_day_plan_stops.address_id AND a.lead_id = rep_day_plan_stops.lead_id
                   AND a.organization_id = rep_day_plan_stops.organization_id)
  );
CREATE POLICY rep_day_plan_stops_update ON public.rep_day_plan_stops
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_day_plans p WHERE p.id = rep_day_plan_stops.plan_id))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.rep_day_plans p
             WHERE p.id = rep_day_plan_stops.plan_id AND p.organization_id = rep_day_plan_stops.organization_id)
    AND EXISTS (SELECT 1 FROM public.lead_addresses a
                 WHERE a.id = rep_day_plan_stops.address_id AND a.lead_id = rep_day_plan_stops.lead_id
                   AND a.organization_id = rep_day_plan_stops.organization_id)
  );
CREATE POLICY rep_day_plan_stops_delete ON public.rep_day_plan_stops
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_day_plans p WHERE p.id = rep_day_plan_stops.plan_id));

CREATE POLICY master_ghost_select_rep_day_plan_stops ON public.rep_day_plan_stops
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));

REVOKE ALL ON TABLE public.rep_day_plans      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rep_day_plan_stops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rep_day_plans      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rep_day_plan_stops TO authenticated;
GRANT ALL ON TABLE public.rep_day_plans      TO service_role;
GRANT ALL ON TABLE public.rep_day_plan_stops TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. O representante lê o endereço dos clientes que estão no plano dele
-- ───────────────────────────────────────────────────────────────────────────
-- Sem isto, o admin montaria um plano com clientes que o representante não enxerga (a RLS de leads manda). Só o ENDEREÇO
-- fica visível (para rotear); o lead e o pedido seguem as regras do CRM. Plano cancelado deixa de valer.
-- Função SECURITY DEFINER só para quebrar o ciclo de RLS (lead_addresses -> paradas -> lead_addresses): ela responde um
-- booleano sobre o PRÓPRIO usuário (auth.uid()) e não devolve dado algum.
CREATE FUNCTION public.rep_plan_address_visible(p_address_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.rep_day_plan_stops s
      JOIN public.rep_day_plans p ON p.id = s.plan_id
     WHERE s.address_id = p_address_id AND p.user_id = auth.uid() AND p.status = 'open')
$fn$;
REVOKE ALL ON FUNCTION public.rep_plan_address_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_plan_address_visible(uuid) TO authenticated, service_role;

DROP POLICY lead_addresses_select ON public.lead_addresses;
CREATE POLICY lead_addresses_select ON public.lead_addresses
  FOR SELECT TO authenticated
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids())
     AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_addresses.lead_id))  -- a RLS de leads decide
    OR public.rep_plan_address_visible(lead_addresses.id)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 5. mobile_plan_save
-- ───────────────────────────────────────────────────────────────────────────
-- p_stops: [{ "address_id": uuid, "note": text (opcional) }, ...]  até 100; a ORDEM do array é a ordem de visita.
CREATE FUNCTION public.mobile_plan_save(
  p_plan_id uuid,
  p_op_id   uuid,
  p_org     uuid,
  p_user_id uuid,
  p_date    date,
  p_title   text,
  p_notes   text,
  p_status  text,
  p_stops   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
  v_hash   text;
  v_begin  record;
  v_cur    record;
  v_e      jsonb;
  v_pos    integer := 0;
  v_aid    uuid;
  v_seen   uuid[] := '{}';
  v_addr   record;
  v_action text;
  v_constraint text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_plan_id IS NULL OR p_op_id IS NULL OR p_org IS NULL OR p_user_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'plano, operação, empresa, representante e data são obrigatórios' USING ERRCODE = 'PT422';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open', 'canceled') THEN
    RAISE EXCEPTION 'estado do plano inválido' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_typeof(p_stops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stops) > 100 THEN
    RAISE EXCEPTION 'paradas: esperado uma lista de até 100' USING ERRCODE = 'PT422';
  END IF;
  IF char_length(coalesce(v_title, '')) > 120 OR char_length(coalesce(v_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'título ou instruções longos demais' USING ERRCODE = 'PT422';
  END IF;
  -- Quem pode: o representante para si, ou o admin da empresa para qualquer membro dela.
  IF p_user_id <> v_uid AND NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'somente o administrador monta o plano de outro representante' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.user_id = p_user_id AND tm.organization_id = p_org AND tm.is_active) THEN
    RAISE EXCEPTION 'o representante não é membro ativo desta empresa' USING ERRCODE = 'PT422';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object('plan', p_plan_id, 'org', p_org, 'user', p_user_id, 'date', p_date,
              'title', v_title, 'notes', v_notes, 'status', p_status, 'stops', p_stops)::text, 'UTF8')), 'hex');
  SELECT * INTO v_begin FROM public.mobile_op_begin(p_op_id, 'plan', v_hash);
  IF NOT v_begin.is_new THEN
    RETURN jsonb_build_object('status', 'replayed', 'plan_id', v_begin.entity_id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_plan:' || p_plan_id::text, 0));

  SELECT p.organization_id, p.user_id INTO v_cur FROM public.rep_day_plans p WHERE p.id = p_plan_id;  -- a RLS só mostra o que o usuário pode ver
  IF FOUND THEN
    IF v_cur.organization_id <> p_org OR v_cur.user_id <> p_user_id THEN
      RAISE EXCEPTION 'o dono e a empresa de um plano não mudam; crie outro plano' USING ERRCODE = 'PT422';
    END IF;
    v_action := 'updated';
    BEGIN
      UPDATE public.rep_day_plans
         SET plan_date = p_date, title = v_title, notes = v_notes, status = p_status, updated_by = v_uid, updated_at = now()
       WHERE id = p_plan_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'já existe um plano aberto para este representante neste dia' USING ERRCODE = 'PT409';
    END;
  ELSE
    v_action := 'created';
    BEGIN
      INSERT INTO public.rep_day_plans (id, organization_id, user_id, plan_date, title, notes, status, created_by, updated_by)
      VALUES (p_plan_id, p_org, p_user_id, p_date, v_title, v_notes, p_status, v_uid, v_uid);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'rep_day_plans_pkey' THEN
        RAISE EXCEPTION 'plano não encontrado' USING ERRCODE = 'PT404';  -- o id existe, mas é de um plano que o usuário não enxerga
      END IF;
      RAISE EXCEPTION 'já existe um plano aberto para este representante neste dia' USING ERRCODE = 'PT409';
    END;
  END IF;

  -- Cancelar guarda as paradas como estavam (histórico); só o cabeçalho muda.
  IF p_status = 'canceled' THEN
    PERFORM public.mobile_op_finish(p_op_id, p_plan_id);
    RETURN jsonb_build_object('status', v_action, 'plan_id', p_plan_id, 'stops', (SELECT count(*) FROM public.rep_day_plan_stops WHERE plan_id = p_plan_id));
  END IF;

  -- 1) Valida TODAS as paradas antes de tocar em qualquer uma (o endereço é lido enquanto o usuário ainda o enxerga).
  BEGIN
    FOR v_e IN SELECT e FROM jsonb_array_elements(p_stops) AS t(e)
    LOOP
      v_pos := v_pos + 1;
      IF jsonb_typeof(v_e) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'parada % inválida', v_pos USING ERRCODE = 'PT422';
      END IF;
      v_aid := (v_e ->> 'address_id')::uuid;
      IF v_aid IS NULL OR v_aid = ANY (v_seen) THEN
        RAISE EXCEPTION 'parada % sem endereço ou repetida', v_pos USING ERRCODE = 'PT422';
      END IF;
      v_seen := v_seen || v_aid;
      IF char_length(coalesce(v_e ->> 'note', '')) > 200 THEN
        RAISE EXCEPTION 'observação da parada % longa demais', v_pos USING ERRCODE = 'PT422';
      END IF;

      SELECT a.lead_id INTO v_addr
        FROM public.lead_addresses a
       WHERE a.id = v_aid AND a.deleted_at IS NULL AND a.organization_id = p_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'endereço da parada % não encontrado nesta empresa', v_pos USING ERRCODE = 'PT404';
      END IF;
    END LOOP;
  EXCEPTION WHEN invalid_text_representation OR check_violation THEN
    RAISE EXCEPTION 'dado da parada % fora do formato', v_pos USING ERRCODE = 'PT422';
  END;

  -- 2) Aplica por DIFERENÇA: tira só o que saiu e grava o que ficou ou entrou. O representante continua enxergando os
  --    endereços que já estavam no plano enquanto ele é editado (a leitura vem das próprias paradas).
  DELETE FROM public.rep_day_plan_stops WHERE plan_id = p_plan_id AND address_id <> ALL (v_seen);
  v_pos := 0;
  FOR v_e IN SELECT e FROM jsonb_array_elements(p_stops) AS t(e)
  LOOP
    v_pos := v_pos + 1;
    v_aid := (v_e ->> 'address_id')::uuid;
    SELECT a.lead_id, a.organization_id INTO v_addr FROM public.lead_addresses a WHERE a.id = v_aid;
    INSERT INTO public.rep_day_plan_stops (plan_id, address_id, lead_id, organization_id, position, note)
    VALUES (p_plan_id, v_aid, v_addr.lead_id, v_addr.organization_id, v_pos, nullif(btrim(coalesce(v_e ->> 'note', '')), ''))
    ON CONFLICT (plan_id, address_id) DO UPDATE SET position = EXCLUDED.position, note = EXCLUDED.note;
  END LOOP;

  PERFORM public.mobile_op_finish(p_op_id, p_plan_id);
  RETURN jsonb_build_object('status', v_action, 'plan_id', p_plan_id, 'stops', v_pos);
END;
$fn$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Privilégios
-- ───────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mobile_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_product_save(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mobile_plan_save(uuid, uuid, uuid, uuid, date, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_product_save(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_plan_save(uuid, uuid, uuid, uuid, date, text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

