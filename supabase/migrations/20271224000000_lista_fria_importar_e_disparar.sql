-- Lista fria · "Importar e Disparar" (ADR-0048)
--
-- Depois de achar os contatos, o usuário pode importar, abrir um negócio de
-- cada um num funil e etapa que ele escolhe e mandar uma mensagem cadenciada.
-- Quem faz o trabalho é a edge function lista-fria-importar-e-disparar; este
-- arquivo dá a ela o registro durável do que foi pedido e a porta de entrada
-- que valida tudo antes de qualquer escrita.
--
--   1. public.lista_fria_disparos — um pedido de "importar e disparar".
--      Escrita só por service_role (a edge function) e pela RPC de preparo.
--   2. public.lista_fria_disparo_preparar — valida (flag, permissão, busca,
--      funil, etapa, chips, cadência, teto) e abre o pedido. Idempotente por
--      busca: um pedido ativo por vez.
--
-- Não toca no import (lista_fria_importar segue igual), na marca do lead nem
-- nas guardas de lead_created/webhook.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.lista_fria_disparos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  busca_id         uuid NOT NULL REFERENCES public.lista_fria_buscas(id) ON DELETE CASCADE,
  pipeline_id      uuid NOT NULL REFERENCES public.pipelines(id),
  stage_id         uuid NOT NULL REFERENCES public.pipeline_stages(id),
  mensagem         text NOT NULL CHECK (char_length(btrim(mensagem)) BETWEEN 1 AND 4000),
  instance_ids     uuid[] NOT NULL CHECK (cardinality(instance_ids) BETWEEN 1 AND 10),
  delay_min_ms     integer NOT NULL CHECK (delay_min_ms >= 3000),
  delay_max_ms     integer NOT NULL CHECK (delay_max_ms >= delay_min_ms AND delay_max_ms <= 300000),
  status           text NOT NULL DEFAULT 'importando'
                   CHECK (status IN ('importando', 'negocios', 'disparando', 'concluido', 'falhou')),
  total_previsto   integer NOT NULL CHECK (total_previsto > 0),
  importados       integer NOT NULL DEFAULT 0,
  negocios         integer NOT NULL DEFAULT 0,
  plan_id          uuid,
  erro             text,
  criado_por       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ultimo_sinal_em  timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

COMMENT ON TABLE public.lista_fria_disparos IS
  'Pedido de "Importar e Disparar" da Lista fria (ADR-0048). Um ativo por busca; escrito só pela edge function lista-fria-importar-e-disparar.';
COMMENT ON COLUMN public.lista_fria_disparos.ultimo_sinal_em IS
  'Último sinal de vida da edge function neste pedido. Pedido ativo sem sinal há 15 min é dado como abandonado. NÃO é âncora de métrica.';
COMMENT ON COLUMN public.lista_fria_disparos.plan_id IS
  'blast_plans.id do disparo cadenciado. Sem FK de propósito: apagar o plano não apaga o registro do pedido.';

-- Um pedido ativo por busca: clicar duas vezes não importa nem manda duas vezes.
CREATE UNIQUE INDEX lista_fria_disparos_ativo_uq
  ON public.lista_fria_disparos (busca_id)
  WHERE status IN ('importando', 'negocios', 'disparando');

CREATE INDEX lista_fria_disparos_org_idx
  ON public.lista_fria_disparos (organization_id, created_at DESC);

ALTER TABLE public.lista_fria_disparos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lista_fria_disparos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lista_fria_disparos TO authenticated;
GRANT ALL ON public.lista_fria_disparos TO service_role;

CREATE POLICY lista_fria_disparos_leitura ON public.lista_fria_disparos
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT private.lista_fria_orgs_visiveis()));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Preparo: valida tudo e abre o pedido
-- ─────────────────────────────────────────────────────────────────────────

-- Teto de contatos por pedido. Disparo frio em escala é o que queima chip: o
-- teto é do desenho, não da tela. Subir exige migration.
CREATE FUNCTION public.lista_fria_disparo_preparar(
  p_busca        uuid,
  p_pipeline     uuid,
  p_stage        uuid,
  p_mensagem     text,
  p_instance_ids uuid[],
  p_delay_min_ms integer,
  p_delay_max_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_teto constant integer := 500;
  b public.lista_fria_buscas%ROWTYPE;
  v_total integer;
  v_id uuid;
  v_ok integer;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;

  PERFORM private.lista_fria_exigir(b.organization_id, 'edit');

  IF b.status NOT IN ('concluida', 'parada') THEN
    RAISE EXCEPTION 'A busca ainda não terminou.' USING ERRCODE = 'PT422', DETAIL = 'busca_em_andamento';
  END IF;

  -- Funil da própria org e ativo.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
     WHERE p.id = p_pipeline AND p.organization_id = b.organization_id AND p.is_active
  ) THEN
    RAISE EXCEPTION 'Funil inválido.' USING ERRCODE = 'PT422', DETAIL = 'funil_invalido';
  END IF;

  -- Etapa daquele funil, ativa e de trabalho: negócio não nasce ganho nem perdido.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages s
     WHERE s.id = p_stage
       AND s.pipeline_id = p_pipeline
       AND s.organization_id = b.organization_id
       AND s.is_active
       AND NOT s.is_final_positive
       AND NOT s.is_final_negative
  ) THEN
    RAISE EXCEPTION 'Etapa inválida.' USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  IF p_mensagem IS NULL OR char_length(btrim(p_mensagem)) = 0 THEN
    RAISE EXCEPTION 'A mensagem é obrigatória.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_obrigatoria';
  END IF;
  IF char_length(p_mensagem) > 4000 THEN
    RAISE EXCEPTION 'A mensagem passou de 4000 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_longa';
  END IF;

  -- Cadência: piso de 3 s (o mesmo que o servidor de disparo impõe) e teto de 5 min.
  IF p_delay_min_ms IS NULL OR p_delay_max_ms IS NULL
     OR p_delay_min_ms < 3000 OR p_delay_max_ms < p_delay_min_ms OR p_delay_max_ms > 300000 THEN
    RAISE EXCEPTION 'Intervalo entre mensagens inválido.' USING ERRCODE = 'PT422', DETAIL = 'cadencia_invalida';
  END IF;

  -- Chips: da org, WhatsApp não oficial (o oficial exige template) e sem
  -- reserva de setor (o número da cobrança não manda prospecção).
  IF p_instance_ids IS NULL OR cardinality(p_instance_ids) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Escolha de 1 a 10 números.' USING ERRCODE = 'PT422', DETAIL = 'chips_invalidos';
  END IF;
  SELECT count(*) INTO v_ok
    FROM public.whatsapp_instances i
   WHERE i.id = ANY (SELECT DISTINCT unnest(p_instance_ids))
     AND i.organization_id = b.organization_id
     AND i.provider IN ('uazapi', 'evolution')
     AND i.reserved_for IS NULL;
  IF v_ok <> (SELECT count(DISTINCT x) FROM unnest(p_instance_ids) x) THEN
    RAISE EXCEPTION 'Um dos números não pode ser usado neste disparo.'
      USING ERRCODE = 'PT422', DETAIL = 'chips_invalidos';
  END IF;

  -- O que vai entrar: o mesmo recorte que lista_fria_importar usa.
  SELECT count(*) INTO v_total
    FROM public.lista_fria_resultados r
   WHERE r.busca_id = p_busca AND r.lead_id IS NULL AND NOT r.ja_e_lead AND r.selecionado;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum contato selecionado para importar.'
      USING ERRCODE = 'PT422', DETAIL = 'nada_para_importar';
  END IF;
  IF v_total > v_teto THEN
    RAISE EXCEPTION 'Um disparo leva no máximo % contatos. Desmarque o excedente.', v_teto
      USING ERRCODE = 'PT422', DETAIL = 'limite_do_disparo';
  END IF;

  -- Pedido que travou (a edge function morreu no meio) não prende a busca para sempre.
  UPDATE public.lista_fria_disparos
     SET status = 'falhou', erro = 'abandonado', finished_at = now(), ultimo_sinal_em = now()
   WHERE busca_id = p_busca
     AND status IN ('importando', 'negocios', 'disparando')
     AND ultimo_sinal_em < now() - interval '15 minutes';

  BEGIN
    INSERT INTO public.lista_fria_disparos
      (organization_id, busca_id, pipeline_id, stage_id, mensagem, instance_ids,
       delay_min_ms, delay_max_ms, total_previsto, criado_por)
    VALUES
      (b.organization_id, p_busca, p_pipeline, p_stage, p_mensagem,
       ARRAY(SELECT DISTINCT unnest(p_instance_ids)),
       p_delay_min_ms, p_delay_max_ms, v_total, auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um disparo em andamento para esta busca.'
      USING ERRCODE = 'PT409', DETAIL = 'disparo_em_andamento';
  END;

  RETURN jsonb_build_object(
    'disparo_id', v_id,
    'organization_id', b.organization_id,
    'total', v_total
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_disparo_preparar(uuid, uuid, uuid, text, uuid[], integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_fria_disparo_preparar(uuid, uuid, uuid, text, uuid[], integer, integer)
  TO authenticated, service_role;
