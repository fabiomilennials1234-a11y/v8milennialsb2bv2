-- Lista fria · "Importar e Disparar" retoma de onde parou (ADR-0048, correção)
--
-- Sintoma (03/11): o disparo importou 81 contatos e abriu 81 negócios, e falhou
-- no último passo (criar o plano de envio). A busca ficou com 0 contatos para
-- importar; clicar de novo dava `nada_para_importar` e os 81 leads ficaram no
-- funil sem mensagem, sem caminho de volta.
--
-- Agora o pedido enxerga o que uma tentativa anterior deixou pela metade:
-- contatos desta busca importados DURANTE um pedido que falhou sem criar plano
-- e que ainda não estão em nenhum plano de envio. Esses entram no pedido novo;
-- quem já tem negócio no funil não ganha outro (a edge function pula o
-- `abrir_negocio`, que NÃO é idempotente: um segundo negócio vira "recompra").
--
--   1. public.lista_fria_disparo_pendentes — os leads que o pedido deve tratar
--      e se cada um já tem negócio no funil. Só service_role (edge function).
--   2. public.lista_fria_disparo_aguardando — quantos, para a tela mostrar.
--   3. public.lista_fria_disparo_preparar — conta importáveis + aguardando.
--
-- Não toca no import, na marca do lead nem em blast-plan-create.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Quem o pedido deve tratar
-- ─────────────────────────────────────────────────────────────────────────

-- Janela de um pedido = [created_at, finished_at]. Entram os pedidos que falharam
-- sem plano (retomada) e o pedido corrente (`p_disparo`, os recém-importados).
-- Pedido `concluido` NÃO entra: se o plano deixou alguém de fora (recusa, opt-out),
-- foi decisão do motor e não se repete. Quem já é destinatário de plano sai.
CREATE FUNCTION public.lista_fria_disparo_pendentes(
  p_busca    uuid,
  p_pipeline uuid,
  p_disparo  uuid
)
RETURNS TABLE (lead_id uuid, tem_negocio boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT DISTINCT
         r.lead_id,
         EXISTS (
           SELECT 1 FROM public.pipeline_entries pe
            WHERE pe.lead_id = r.lead_id
              AND pe.pipeline_id = p_pipeline
              AND pe.deal_id IS NOT NULL
         ) AS tem_negocio
    FROM public.lista_fria_resultados r
    JOIN public.leads l ON l.id = r.lead_id AND l.deleted_at IS NULL
   WHERE r.busca_id = p_busca
     AND r.lead_id IS NOT NULL
     AND r.importado_em IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.lista_fria_disparos d
            WHERE d.busca_id = p_busca
              AND (d.id = p_disparo OR (d.status = 'falhou' AND d.plan_id IS NULL))
              AND r.importado_em >= d.created_at
              AND (d.finished_at IS NULL OR r.importado_em <= d.finished_at)
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.blast_plan_recipients br
             JOIN public.lista_fria_disparos d2 ON d2.plan_id = br.plan_id
            WHERE d2.busca_id = p_busca
              AND br.lead_id = r.lead_id
         );
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_disparo_pendentes(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lista_fria_disparo_pendentes(uuid, uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Quantos aguardam disparo (a tela)
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.lista_fria_disparo_aguardando(p_busca uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.lista_fria_buscas WHERE id = p_busca;
  IF v_org IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM private.lista_fria_exigir(v_org, 'view');

  RETURN (SELECT count(*) FROM public.lista_fria_disparo_pendentes(p_busca, NULL, NULL))::integer;
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_disparo_aguardando(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_fria_disparo_aguardando(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Preparo: importáveis + aguardando
-- ─────────────────────────────────────────────────────────────────────────

-- Mesma assinatura e mesmos GRANTs da 20271224000000. Mudanças:
--   * o pedido travado é encerrado ANTES de contar (a janela dele passa a valer);
--   * o total é o que falta importar + o que uma tentativa anterior deixou;
--   * `nada_para_importar` só quando os dois são zero.
CREATE OR REPLACE FUNCTION public.lista_fria_disparo_preparar(
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
  v_novos integer;
  v_retomada integer;
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

  -- Pedido que travou (a edge function morreu no meio) não prende a busca para
  -- sempre. Encerrado ANTES de contar: o que ele importou conta como retomada.
  UPDATE public.lista_fria_disparos
     SET status = 'falhou', erro = 'abandonado', finished_at = now(), ultimo_sinal_em = now()
   WHERE busca_id = p_busca
     AND status IN ('importando', 'negocios', 'disparando')
     AND ultimo_sinal_em < now() - interval '15 minutes';

  -- O que ainda vai entrar: o mesmo recorte que lista_fria_importar usa.
  SELECT count(*) INTO v_novos
    FROM public.lista_fria_resultados r
   WHERE r.busca_id = p_busca AND r.lead_id IS NULL AND NOT r.ja_e_lead AND r.selecionado;

  -- O que uma tentativa anterior deixou pela metade (importado, sem plano).
  SELECT count(*) INTO v_retomada
    FROM public.lista_fria_disparo_pendentes(p_busca, p_pipeline, NULL);

  v_total := v_novos + v_retomada;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum contato selecionado para importar.'
      USING ERRCODE = 'PT422', DETAIL = 'nada_para_importar';
  END IF;
  -- Teto de contatos por pedido. Disparo frio em escala é o que queima chip: o
  -- teto é do desenho, não da tela. Subir exige migration.
  IF v_total > v_teto THEN
    RAISE EXCEPTION 'Um disparo leva no máximo % contatos. Desmarque o excedente.', v_teto
      USING ERRCODE = 'PT422', DETAIL = 'limite_do_disparo';
  END IF;

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
    'total', v_total,
    'retomada', v_retomada
  );
END
$fn$;
