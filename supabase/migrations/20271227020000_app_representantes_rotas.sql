-- App Representantes: histórico de rotas e visitas, com visão de gestor.
-- Origem: rascunho modelo-rota.sql do repositório Representantes, ensaiado no clone do schema do CRM (imagem torque-crm-real:base) com
-- suítes SQL, mutação e integração. NÃO foi executado em produção.
-- Ordem: depende das migrations anteriores desta série (20271227000000 -> 20271227010000 -> 20271227020000 -> 20271227030000).
-- Rollback: supabase/migrations/rollback/20271227020000_app_representantes_rotas.sql
--
-- modelo-pedido.sql (mobile_op_begin/finish, e deals para ligar o pedido à visita).
--
-- O que esta migration faz
--   1. rep_routes / rep_route_stops    a rota do dia e cada parada, com o resultado da visita.
--   2. mobile_route_sync(...)          grava o ESTADO COMPLETO da rota (snapshot), idempotente por op_id.
--
-- Decisões de desenho
--   · SNAPSHOT, não eventos. O app manda a rota inteira a cada mudança (iniciou, visitou uma parada, encerrou). O servidor
--     troca o conjunto de paradas. Operações chegam em ordem por rota (a fila do app é FIFO por entidade), então a última
--     vence; reenviar a mesma operação devolve o mesmo resultado (status 'replayed'), sem reaplicar.
--   · PRIVACIDADE (LGPD): NÃO há coordenadas, trajeto nem posição. Só o que o representante registra: quais clientes visitou,
--     a hora de chegada (check-in), o resultado e o tempo no cliente. "Localização só durante a navegação e no check-in."
--   · RLS, como no pedido: SECURITY INVOKER. A rota é de quem a criou (user_id = auth.uid()); só o dono ESCREVE. Parada
--     só aceita endereço que o dono ENXERGA (a RLS de lead_addresses decide) e Negócio que o dono criou para o mesmo lead.
--   · VISÃO DE GESTOR (somente leitura): quem tem a permissão `rotas.view_team` numa empresa lê as rotas dos membros dessa
--     empresa. A permissão segue o mecanismo do CRM (admin da empresa e gestor sempre têm; membro comum só por override
--     individual ou padrão da empresa; padrão global = DESLIGADO). O gestor vê SÓ as paradas das empresas em que tem a
--     permissão: um representante em duas empresas não expõe à empresa A o que fez na empresa C. Gestor nunca altera a rota.
--   · Rota encerrada não reabre (PT409), mas aceita atualizar as paradas: um pedido enfileirado pode ser aceito depois do
--     fim da rota e o Negócio precisa ser ligado à visita.
--   · Erros: 42501 (sem sessão/RLS), PT404 (rota de outra pessoa ou endereço sem acesso: sem oráculo de existência),
--     PT409 (op_id reutilizado com outro corpo; reabrir rota encerrada), PT422 (dado inválido).
--
-- Antes de aplicar em produção: conferir o ledger de prod (o número acima foi escolhido depois de 20271226000000).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.rep_routes (
  id          uuid PRIMARY KEY,                    -- gerado no aparelho (permite criar offline)
  user_id     uuid NOT NULL,                       -- auth.uid() de quem fez a rota
  status      text NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rep_routes_finish_chk CHECK (
    (status = 'active' AND finished_at IS NULL)
    OR (status <> 'active' AND (finished_at IS NULL OR finished_at >= started_at))
  )
);
COMMENT ON TABLE public.rep_routes IS
  'Rota do representante (histórico). Sem coordenadas: só quais clientes, check-in, resultado e tempo. Escrita por mobile_route_sync.';

CREATE INDEX rep_routes_user_started_idx ON public.rep_routes (user_id, started_at DESC);

CREATE TABLE public.rep_route_stops (
  route_id        uuid NOT NULL REFERENCES public.rep_routes (id) ON DELETE CASCADE,
  address_id      uuid NOT NULL REFERENCES public.lead_addresses (id),
  lead_id         uuid NOT NULL,
  organization_id uuid NOT NULL,
  position        integer NOT NULL CHECK (position >= 1),
  outcome         text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'visited', 'skipped')),
  result          text CHECK (result IN ('order', 'later', 'absent', 'declined')),
  arrived_at      timestamptz,                     -- check-in
  completed_at    timestamptz,
  seconds         integer CHECK (seconds >= 0),    -- tempo no cliente
  deal_id         uuid REFERENCES public.deals (id),
  PRIMARY KEY (route_id, address_id),
  CONSTRAINT rep_route_stops_position_uniq UNIQUE (route_id, position),
  CONSTRAINT rep_route_stops_result_chk CHECK (result IS NULL OR outcome = 'visited'),
  CONSTRAINT rep_route_stops_done_chk CHECK (outcome = 'pending' OR completed_at IS NOT NULL),
  CONSTRAINT rep_route_stops_deal_chk CHECK (deal_id IS NULL OR result = 'order'),
  CONSTRAINT rep_route_stops_time_chk CHECK (arrived_at IS NULL OR completed_at IS NULL OR completed_at >= arrived_at)
);
COMMENT ON TABLE public.rep_route_stops IS 'Paradas de uma rota, na ordem de visita, com o resultado de cada visita.';

CREATE INDEX rep_route_stops_lead_idx ON public.rep_route_stops (lead_id);
CREATE INDEX rep_route_stops_deal_idx ON public.rep_route_stops (deal_id) WHERE deal_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Permissão da visão de gestor e RLS
-- ───────────────────────────────────────────────────────────────────────────
-- Permissão nova no catálogo do CRM. default_value = false: o dia 1 não muda nada para ninguém; o admin liga por membro
-- (member_feature_permissions) ou por empresa (organization_feature_defaults). Admin da empresa já tem de saída.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
SELECT 'rotas.view_team', fp.module, 'Ver as rotas da equipe',
       'Ler o histórico de rotas e visitas dos representantes da empresa (somente leitura).', false, false, fp.sort_order + 1
  FROM public.feature_permissions fp
 WHERE fp.key = 'team.view'
ON CONFLICT (key) DO NOTHING;

-- Empresas em que o usuário lê as rotas da equipe. SECURITY DEFINER só para consultar o catálogo de permissões; devolve
-- apenas ids de empresa do PRÓPRIO usuário (auth.uid()).
CREATE FUNCTION public.rep_route_team_orgs()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.org_id
    FROM public.get_my_organization_ids() AS o(org_id)
   WHERE public.has_feature_permission('rotas.view_team', o.org_id)
  UNION
  SELECT public.get_my_gestor_organization_ids()
$$;
REVOKE ALL ON FUNCTION public.rep_route_team_orgs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rep_route_team_orgs() TO authenticated, service_role;

ALTER TABLE public.rep_routes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_route_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY rep_routes_select ON public.rep_routes
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.team_members tm
                WHERE tm.user_id = rep_routes.user_id
                  AND tm.organization_id IN (SELECT public.rep_route_team_orgs()))
  );
CREATE POLICY rep_routes_insert ON public.rep_routes
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY rep_routes_update ON public.rep_routes
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY master_ghost_select_rep_routes ON public.rep_routes
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));

-- O dono vê todas as paradas; o gestor, só as das empresas em que tem a permissão (e só de rota que a RLS de rep_routes mostra).
CREATE POLICY rep_route_stops_select ON public.rep_route_stops
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.rep_routes r WHERE r.id = rep_route_stops.route_id AND r.user_id = (SELECT auth.uid()))
    OR (rep_route_stops.organization_id IN (SELECT public.rep_route_team_orgs())
        AND EXISTS (SELECT 1 FROM public.rep_routes r WHERE r.id = rep_route_stops.route_id))
  );

-- Escrita: rota própria E endereço que o usuário enxerga E (se houver) Negócio dele para o mesmo lead.
CREATE POLICY rep_route_stops_insert ON public.rep_route_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.rep_routes r WHERE r.id = rep_route_stops.route_id AND r.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.lead_addresses a
                 WHERE a.id = rep_route_stops.address_id
                   AND a.lead_id = rep_route_stops.lead_id
                   AND a.organization_id = rep_route_stops.organization_id)
    AND (rep_route_stops.deal_id IS NULL
         OR EXISTS (SELECT 1 FROM public.deals d
                     WHERE d.id = rep_route_stops.deal_id
                       AND d.created_by = (SELECT auth.uid())
                       AND d.source_lead_id = rep_route_stops.lead_id))
  );
CREATE POLICY rep_route_stops_delete ON public.rep_route_stops
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rep_routes r WHERE r.id = rep_route_stops.route_id AND r.user_id = (SELECT auth.uid())));

CREATE POLICY master_ghost_select_rep_route_stops ON public.rep_route_stops
  FOR SELECT TO authenticated USING ((SELECT public.is_master_user()));

-- O padrão do projeto dá ALL a authenticated (inclui TRUNCATE, que ignora RLS): revoga e devolve só o necessário.
-- UPDATE em parada não existe: o snapshot apaga e reinsere (uma regra só para escrever).
REVOKE ALL ON TABLE public.rep_routes      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rep_route_stops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rep_routes      TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.rep_route_stops TO authenticated;
GRANT ALL ON TABLE public.rep_routes      TO service_role;
GRANT ALL ON TABLE public.rep_route_stops TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. mobile_route_sync
-- ───────────────────────────────────────────────────────────────────────────
-- p_stops: [{ "address_id": uuid, "outcome": "pending|visited|skipped", "result": "order|later|absent|declined" (opcional),
--             "arrived_at": ts (opcional), "completed_at": ts (obrigatório se outcome <> pending), "seconds": int (opcional),
--             "deal_id": uuid (opcional, só com result = order) }, ...]  1 a 100 linhas; a ORDEM do array é a ordem da visita.
-- lead e empresa de cada parada vêm do ENDEREÇO (o app não manda): nada a falsificar.
CREATE FUNCTION public.mobile_route_sync(
  p_route_id    uuid,
  p_op_id       uuid,
  p_status      text,
  p_started_at  timestamptz,
  p_finished_at timestamptz,
  p_stops       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_hash    text;
  v_begin   record;
  v_cur     record;
  v_prev    uuid[];
  v_seen    uuid[] := '{}';
  v_e       jsonb;
  v_pos     integer := 0;
  v_aid     uuid;
  v_addr    record;
  v_outcome text;
  v_result  text;
  v_arr     timestamptz;
  v_done    timestamptz;
  v_sec     integer;
  v_deal    uuid;
  v_action  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem sessão' USING ERRCODE = '42501';
  END IF;
  IF p_route_id IS NULL OR p_op_id IS NULL OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'rota, operação e início são obrigatórios' USING ERRCODE = 'PT422';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'finished', 'abandoned') THEN
    RAISE EXCEPTION 'estado da rota inválido' USING ERRCODE = 'PT422';
  END IF;
  IF (p_status = 'active' AND p_finished_at IS NOT NULL) OR (p_finished_at IS NOT NULL AND p_finished_at < p_started_at) THEN
    RAISE EXCEPTION 'fim da rota incoerente com o estado ou com o início' USING ERRCODE = 'PT422';
  END IF;
  IF jsonb_typeof(p_stops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stops) > 100 THEN
    RAISE EXCEPTION 'paradas: esperado uma lista de até 100' USING ERRCODE = 'PT422';
  END IF;

  v_hash := encode(sha256(convert_to(jsonb_build_object(
              'route', p_route_id, 'status', p_status, 'started', p_started_at, 'finished', p_finished_at, 'stops', p_stops)::text, 'UTF8')), 'hex');
  SELECT * INTO v_begin FROM public.mobile_op_begin(p_op_id, 'route', v_hash);
  IF NOT v_begin.is_new THEN
    RETURN jsonb_build_object('status', 'replayed', 'route_id', v_begin.entity_id);
  END IF;

  -- Uma rota por vez (dois snapshots da mesma rota não se intercalam).
  PERFORM pg_advisory_xact_lock(hashtextextended('mobile_route:' || p_route_id::text, 0));

  SELECT r.status INTO v_cur FROM public.rep_routes r WHERE r.id = p_route_id AND r.user_id = v_uid;  -- gestor VÊ rotas da equipe, mas nunca é dono delas
  IF FOUND THEN
    IF v_cur.status <> 'active' AND p_status = 'active' THEN
      RAISE EXCEPTION 'a rota já foi encerrada' USING ERRCODE = 'PT409';
    END IF;
    v_action := 'updated';
    SELECT coalesce(array_agg(s.address_id), '{}') INTO v_prev FROM public.rep_route_stops s WHERE s.route_id = p_route_id;
    UPDATE public.rep_routes
       SET status = p_status, finished_at = p_finished_at, started_at = p_started_at, updated_at = now()
     WHERE id = p_route_id;
  ELSE
    v_action := 'created';
    v_prev := '{}';
    BEGIN
      INSERT INTO public.rep_routes (id, user_id, status, started_at, finished_at)
      VALUES (p_route_id, v_uid, p_status, p_started_at, p_finished_at);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'rota não encontrada' USING ERRCODE = 'PT404';  -- existe, mas é de outra pessoa: mesma resposta
    END;
  END IF;

  DELETE FROM public.rep_route_stops WHERE route_id = p_route_id;

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

      -- Endereço que o usuário enxerga (RLS). Um endereço já na rota continua valendo se for apagado depois.
      SELECT a.lead_id, a.organization_id INTO v_addr
        FROM public.lead_addresses a
       WHERE a.id = v_aid AND (a.deleted_at IS NULL OR v_aid = ANY (v_prev));
      IF NOT FOUND THEN
        RAISE EXCEPTION 'endereço da parada % não encontrado', v_pos USING ERRCODE = 'PT404';
      END IF;

      v_outcome := coalesce(v_e ->> 'outcome', 'pending');
      v_result  := nullif(v_e ->> 'result', '');
      v_arr     := (v_e ->> 'arrived_at')::timestamptz;
      v_done    := (v_e ->> 'completed_at')::timestamptz;
      v_sec     := (v_e ->> 'seconds')::integer;
      v_deal    := (v_e ->> 'deal_id')::uuid;

      IF v_outcome NOT IN ('pending', 'visited', 'skipped')
         OR (v_result IS NOT NULL AND (v_result NOT IN ('order', 'later', 'absent', 'declined') OR v_outcome <> 'visited'))
         OR (v_outcome <> 'pending' AND v_done IS NULL)
         OR (v_arr IS NOT NULL AND v_done IS NOT NULL AND v_done < v_arr)
         OR (v_sec IS NOT NULL AND v_sec < 0)
         OR (v_deal IS NOT NULL AND v_result IS DISTINCT FROM 'order')
      THEN
        RAISE EXCEPTION 'parada % com dados incoerentes', v_pos USING ERRCODE = 'PT422';
      END IF;

      IF v_deal IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.deals d
            WHERE d.id = v_deal AND d.created_by = v_uid AND d.source_lead_id = v_addr.lead_id) THEN
        RAISE EXCEPTION 'Negócio da parada % não é seu ou não é deste cliente', v_pos USING ERRCODE = 'PT422';
      END IF;

      INSERT INTO public.rep_route_stops (route_id, address_id, lead_id, organization_id, position, outcome, result,
                                          arrived_at, completed_at, seconds, deal_id)
      VALUES (p_route_id, v_aid, v_addr.lead_id, v_addr.organization_id, v_pos, v_outcome, v_result,
              v_arr, v_done, v_sec, v_deal);
    END LOOP;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow
         OR invalid_datetime_format OR check_violation THEN
    RAISE EXCEPTION 'dado da parada % fora do formato', v_pos USING ERRCODE = 'PT422';
  END;

  PERFORM public.mobile_op_finish(p_op_id, p_route_id);
  RETURN jsonb_build_object('status', v_action, 'route_id', p_route_id, 'stops', v_pos);
END;
$fn$;

REVOKE ALL ON FUNCTION public.mobile_route_sync(uuid, uuid, text, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mobile_route_sync(uuid, uuid, text, timestamptz, timestamptz, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

