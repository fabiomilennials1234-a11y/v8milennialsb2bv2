-- Rollback de 20280118000000_cobranca_trilhas_colunas_manuais_e_prazo.sql
--
-- Restaura as funções da régua como estavam e remove trilha, coluna manual e
-- prazo. ANTES de rodar: o que existir de coluna 'multiplos' ou personalizada
-- é desfeito (casos nelas voltam para a coluna de entrada; envios na fila
-- dessas colunas são cancelados). Mensagens longas (> 1.000) são cortadas.

BEGIN;

SET LOCAL lock_timeout = '3s';

UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'rollback_trilhas'
 WHERE status = 'pendente'
   AND etapa_id IN (SELECT id FROM public.cobranca_etapas WHERE personalizada OR trilha = 'multiplos');

UPDATE public.cobranca_casos c
   SET etapa_id = (SELECT e.id FROM public.cobranca_etapas e
                    WHERE e.organization_id = c.organization_id AND e.papel = 'aberta'
                      AND e.entrada_dias IS NULL AND NOT e.pausa_regua
                    ORDER BY e.posicao LIMIT 1)
 WHERE c.encerrado_em IS NULL
   AND c.etapa_id IN (SELECT id FROM public.cobranca_etapas WHERE personalizada OR trilha = 'multiplos');

DELETE FROM public.cobranca_etapas WHERE personalizada OR trilha = 'multiplos';

UPDATE public.cobranca_etapas SET mensagem = left(mensagem, 1000) WHERE length(mensagem) > 1000;

CREATE OR REPLACE FUNCTION private.cobranca_regua_variaveis(p_caso uuid, p_gatilho text, p_referencia date, p_agora timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH base AS (
    SELECT i.nome, o.name AS empresa, o.timezone, r.como_pagar,
           (p_agora AT TIME ZONE o.timezone)::date AS hoje,
           s.saldo, s.venc, s.titulos
      FROM public.cobranca_casos c
      JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
      JOIN public.organizations o ON o.id = c.organization_id
      LEFT JOIN public.cobranca_regua r ON r.organization_id = c.organization_id
      LEFT JOIN LATERAL (
        SELECT sum(ts.saldo) AS saldo,
               min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS venc,
               count(*) FILTER (WHERE ts.saldo > 0) AS titulos
          FROM public.cobranca_titulos_saldo ts
         WHERE ts.inadimplente_id = c.inadimplente_id
      ) s ON true
     WHERE c.id = p_caso
  ), parcela AS (
    SELECT pa.vencimento, pa.valor
      FROM public.cobranca_compromissos co
      JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
     WHERE co.caso_id = p_caso AND co.status = 'ativo'
       AND p_gatilho = 'lembrete_compromisso' AND pa.vencimento = p_referencia
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'nome',               b.nome,
    'primeiro_nome',      split_part(btrim(b.nome), ' ', 1),
    'empresa',            b.empresa,
    'valor',              COALESCE(b.saldo, 0),
    'vencimento',         b.venc,
    'dias_atraso',        CASE WHEN b.venc IS NULL THEN NULL ELSE b.hoje - b.venc END,
    'titulos',            COALESCE(b.titulos, 0),
    'como_pagar',         COALESCE(b.como_pagar, ''),
    'parcela_valor',      (SELECT valor FROM parcela),
    'parcela_vencimento', (SELECT vencimento FROM parcela),
    'quando',             CASE
                            WHEN (SELECT vencimento FROM parcela) IS NULL THEN NULL
                            WHEN (SELECT vencimento FROM parcela) = b.hoje THEN 'hoje'
                            WHEN (SELECT vencimento FROM parcela) = b.hoje + 1 THEN 'amanhã'
                            ELSE 'em ' || ((SELECT vencimento FROM parcela) - b.hoje) || ' dias'
                          END)
    FROM base b;
$fn$;

CREATE OR REPLACE FUNCTION private.cobranca_etapas_reordenar(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.cobranca_etapas SET posicao = posicao + 10000 WHERE organization_id = p_org;
  WITH ord AS (
    SELECT id, row_number() OVER (ORDER BY
             CASE WHEN papel <> 'aberta' THEN 4
                  WHEN entrada_dias IS NULL AND NOT pausa_regua THEN 0
                  WHEN entrada_dias IS NOT NULL AND NOT pausa_regua THEN 1
                  WHEN entrada_dias IS NULL THEN 2
                  ELSE 3 END,
             entrada_dias NULLS LAST, posicao) AS nova
      FROM public.cobranca_etapas
     WHERE organization_id = p_org
  )
  UPDATE public.cobranca_etapas e SET posicao = o.nova FROM ord o WHERE e.id = o.id;
END
$fn$;

CREATE OR REPLACE FUNCTION private.cobranca_regua_candidatos(p_org uuid, p_agora timestamptz)
RETURNS TABLE (
  caso_id uuid, inadimplente_id uuid, passo_id uuid, etapa_id uuid, gatilho text, dias integer,
  referencia date, status text, motivo text, mover_para uuid
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH cfg AS (
    SELECT r.*, o.timezone,
           (p_agora AT TIME ZONE o.timezone)::date AS hoje
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.organization_id = p_org
  ), casos AS (
    SELECT c.id AS caso_id, c.inadimplente_id, e.posicao AS etapa_posicao, e.papel, e.pausa_regua,
           i.telefone, i.nao_contatar, s.venc, COALESCE(s.saldo, 0) AS saldo,
           EXISTS (SELECT 1 FROM public.cobranca_compromissos co
                    WHERE co.caso_id = c.id AND co.status = 'ativo') AS tem_compromisso,
           EXISTS (SELECT 1 FROM public.cobranca_eventos ev
                    WHERE ev.caso_id = c.id AND ev.tipo = 'mensagem_recebida'
                      AND ev.created_at > p_agora - make_interval(days => cfg.pausa_apos_resposta_dias)) AS respondeu,
           EXISTS (SELECT 1 FROM public.cobranca_regua_envios en
                    WHERE en.caso_id = c.id AND en.status IN ('enviado', 'enviando', 'pendente')
                      AND COALESCE(en.enviado_em, en.agendado_para) > p_agora - make_interval(days => cfg.intervalo_minimo_dias)) AS recente
      FROM cfg
      JOIN public.cobranca_casos c ON c.organization_id = cfg.organization_id AND c.encerrado_em IS NULL
      JOIN public.cobranca_etapas e ON e.id = c.etapa_id
      JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id AND i.arquivado_em IS NULL
      LEFT JOIN LATERAL (
        SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS venc, sum(ts.saldo) AS saldo
          FROM public.cobranca_titulos_saldo ts
         WHERE ts.inadimplente_id = c.inadimplente_id
      ) s ON true
  ), atraso AS (
    SELECT ca.caso_id, ca.inadimplente_id, NULL::uuid AS passo_id, t.id AS etapa_id,
           'atraso'::text AS gatilho, t.entrada_dias AS dias, ca.venc AS referencia,
           CASE WHEN t.mensagem IS NULL OR ca.telefone IS NULL OR ca.nao_contatar THEN 'pulado'
                ELSE 'pendente' END AS status,
           CASE WHEN t.mensagem IS NULL THEN 'so_etapa'
                WHEN ca.telefone IS NULL THEN 'sem_telefone'
                WHEN ca.nao_contatar THEN 'nao_contatar' END AS motivo,
           t.id AS mover_para,
           ca.respondeu OR ca.recente AS adiar
      FROM casos ca
      CROSS JOIN cfg
      CROSS JOIN LATERAL (
        SELECT e.* FROM public.cobranca_etapas e
         WHERE e.organization_id = cfg.organization_id AND e.papel = 'aberta' AND e.automacao_ativa
           AND e.entrada_dias IS NOT NULL AND e.entrada_dias <= cfg.hoje - ca.venc
         ORDER BY e.entrada_dias DESC
         LIMIT 1
      ) t
     WHERE ca.papel = 'aberta' AND NOT ca.pausa_regua AND NOT ca.tem_compromisso
       AND ca.saldo > 0 AND ca.venc IS NOT NULL
       AND t.posicao > ca.etapa_posicao
       AND NOT EXISTS (
         SELECT 1 FROM public.cobranca_regua_envios en
          WHERE en.caso_id = ca.caso_id AND en.gatilho = 'atraso'
            AND en.dias = t.entrada_dias AND en.referencia = ca.venc)
       -- A mensagem desta coluna já saiu à mão nesta dívida: a equipe tirou o
       -- card de lá depois; a régua não repete.
       AND NOT EXISTS (
         SELECT 1 FROM public.cobranca_regua_envios en
          WHERE en.caso_id = ca.caso_id AND en.gatilho = 'entrada_manual' AND en.etapa_id = t.id
            AND en.referencia >= ca.venc AND en.status IN ('pendente', 'enviando', 'enviado'))
  ), lembrete AS (
    SELECT ca.caso_id, ca.inadimplente_id, p.id AS passo_id, NULL::uuid AS etapa_id,
           'lembrete_compromisso'::text AS gatilho, p.dias, pa.vencimento AS referencia,
           CASE WHEN ca.telefone IS NULL OR ca.nao_contatar THEN 'pulado' ELSE 'pendente' END AS status,
           CASE WHEN ca.telefone IS NULL THEN 'sem_telefone'
                WHEN ca.nao_contatar THEN 'nao_contatar' END AS motivo,
           NULL::uuid AS mover_para,
           false AS adiar
      FROM casos ca
      CROSS JOIN cfg
      JOIN public.cobranca_compromissos co ON co.caso_id = ca.caso_id AND co.status = 'ativo'
      CROSS JOIN LATERAL (
        SELECT pa.vencimento FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id AND pa.vencimento >= cfg.hoje
         ORDER BY pa.vencimento
         LIMIT 1
      ) pa
      CROSS JOIN LATERAL (
        SELECT p.* FROM public.cobranca_regua_passos p
         WHERE p.organization_id = cfg.organization_id AND p.ativo AND p.gatilho = 'lembrete_compromisso'
           AND p.dias >= pa.vencimento - cfg.hoje
         ORDER BY p.dias
         LIMIT 1
      ) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.cobranca_regua_envios en
        WHERE en.caso_id = ca.caso_id AND en.gatilho = 'lembrete_compromisso'
          AND en.dias = p.dias AND en.referencia = pa.vencimento)
  )
  SELECT caso_id, inadimplente_id, passo_id, etapa_id, gatilho, dias, referencia, status, motivo, mover_para
    FROM (SELECT * FROM atraso UNION ALL SELECT * FROM lembrete) x
   WHERE NOT (x.status = 'pendente' AND x.adiar);
$fn$;

CREATE OR REPLACE FUNCTION private.cobranca_regua_quebrar_compromissos(p_org uuid, p_hoje date, p_quando timestamptz)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r       record;
  v_n     integer := 0;
  v_cfg   uuid;
  v_volta uuid;
  v_col   public.cobranca_etapas%ROWTYPE;
BEGIN
  SELECT etapa_apos_quebra_id INTO v_cfg FROM public.cobranca_regua WHERE organization_id = p_org;

  FOR r IN
    SELECT co.id, co.caso_id, c.inadimplente_id, d.devido, COALESCE(pg.pago, 0) AS pago,
           i.telefone, i.nao_contatar,
           (SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0)
              FROM public.cobranca_titulos_saldo ts WHERE ts.inadimplente_id = c.inadimplente_id) AS venc
      FROM public.cobranca_compromissos co
      JOIN public.cobranca_casos c ON c.id = co.caso_id AND c.encerrado_em IS NULL
      JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(pa.valor), 0) AS devido
          FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id AND pa.vencimento < p_hoje - 1
      ) d
      LEFT JOIN LATERAL (
        SELECT sum(pg.valor) AS pago
          FROM public.cobranca_pagamentos pg
         WHERE pg.caso_id = co.caso_id AND pg.created_at >= co.created_at
      ) pg ON true
     WHERE co.organization_id = p_org AND co.status = 'ativo'
       AND d.devido > 0 AND COALESCE(pg.pago, 0) + 0.005 < d.devido
     FOR UPDATE OF co SKIP LOCKED
  LOOP
    UPDATE public.cobranca_compromissos
       SET status = 'quebrado', encerrado_em = now(), updated_at = now()
     WHERE id = r.id;
    PERFORM private.cobranca_evento(p_org, r.inadimplente_id, r.caso_id, 'compromisso_encerrado',
      jsonb_build_object('status', 'quebrado', 'origem', 'regua', 'devido', r.devido, 'pago', r.pago));

    v_volta := v_cfg;
    v_col := NULL;
    IF v_volta IS NULL AND r.venc IS NOT NULL THEN
      SELECT e.* INTO v_col FROM public.cobranca_etapas e
       WHERE e.organization_id = p_org AND e.papel = 'aberta' AND e.automacao_ativa
         AND e.entrada_dias IS NOT NULL AND e.entrada_dias <= p_hoje - r.venc
       ORDER BY e.entrada_dias DESC LIMIT 1;
      v_volta := v_col.id;
    END IF;
    IF v_volta IS NULL THEN
      SELECT e.id INTO v_volta FROM public.cobranca_etapas e
       WHERE e.organization_id = p_org AND e.papel = 'aberta' AND NOT e.pausa_regua
       ORDER BY e.posicao LIMIT 1;
    END IF;
    IF v_volta IS NOT NULL THEN
      PERFORM private.cobranca_regua_mover(r.caso_id, v_volta, '{"motivo":"compromisso_quebrado"}'::jsonb);
    END IF;
    IF v_col.id IS NOT NULL THEN
      INSERT INTO public.cobranca_regua_envios
        (organization_id, caso_id, inadimplente_id, etapa_id, gatilho, dias, referencia, status, motivo,
         agendado_para, criado_por)
      VALUES
        (p_org, r.caso_id, r.inadimplente_id, v_col.id, 'atraso', v_col.entrada_dias, r.venc,
         CASE WHEN v_col.mensagem IS NULL OR r.telefone IS NULL OR r.nao_contatar THEN 'pulado' ELSE 'pendente' END,
         CASE WHEN v_col.mensagem IS NULL THEN 'so_etapa'
              WHEN r.telefone IS NULL THEN 'sem_telefone'
              WHEN r.nao_contatar THEN 'nao_contatar' END,
         p_quando, NULL)
      ON CONFLICT (caso_id, gatilho, dias, referencia) WHERE gatilho <> 'entrada_manual' DO NOTHING;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_coluna_salvar(p_org uuid, p_etapa uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id    uuid;
  v_atual public.cobranca_etapas%ROWTYPE;
  v_dias  integer;
  v_msg   text := NULLIF(btrim(COALESCE(p_dados ->> 'mensagem', '')), '');
  v_nome  text := NULLIF(btrim(COALESCE(p_dados ->> 'nome', '')), '');
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_semear_etapas(p_org);

  BEGIN
    v_dias := NULLIF(p_dados ->> 'entrada_dias', '')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Dias de atraso inválidos.' USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END;
  IF v_dias IS NOT NULL AND v_dias NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Dias de atraso de 1 a 365.' USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'A mensagem passa de 1.000 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_longa';
  END IF;
  IF v_nome IS NOT NULL AND length(v_nome) > 60 THEN
    RAISE EXCEPTION 'Nome até 60 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'nome_longo';
  END IF;

  BEGIN
    IF p_etapa IS NULL THEN
      IF v_dias IS NULL THEN
        RAISE EXCEPTION 'Coluna nova precisa dos dias de atraso em que o caso entra.'
          USING ERRCODE = 'PT422', DETAIL = 'dias_obrigatorios';
      END IF;
      INSERT INTO public.cobranca_etapas
        (organization_id, nome, posicao, papel, cor, pausa_regua, entrada_dias, mensagem, automacao_ativa)
      VALUES
        (p_org, COALESCE(v_nome, private.cobranca_rotulo_de_dias(v_dias)), 30000 + v_dias, 'aberta',
         private.cobranca_cor_de_dias(v_dias), false, v_dias, v_msg,
         COALESCE((p_dados ->> 'automacao_ativa')::boolean, true))
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_atual FROM public.cobranca_etapas WHERE id = p_etapa AND organization_id = p_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coluna não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'coluna_inexistente';
      END IF;
      IF v_atual.papel <> 'aberta' AND (v_dias IS NOT NULL OR v_msg IS NOT NULL) THEN
        RAISE EXCEPTION 'Coluna de desfecho não tem automação.' USING ERRCODE = 'PT422', DETAIL = 'desfecho_sem_automacao';
      END IF;
      -- Coluna de dias sem dias viraria uma fase solta no começo do quadro.
      IF p_dados ? 'entrada_dias' AND v_dias IS NULL AND v_atual.entrada_dias IS NOT NULL AND NOT v_atual.pausa_regua THEN
        RAISE EXCEPTION 'Coluna de dias de atraso precisa dos dias.' USING ERRCODE = 'PT422', DETAIL = 'dias_obrigatorios';
      END IF;
      UPDATE public.cobranca_etapas
         SET nome = CASE WHEN p_dados ? 'nome' THEN COALESCE(v_nome, nome) ELSE nome END,
             entrada_dias = CASE WHEN p_dados ? 'entrada_dias' THEN v_dias ELSE entrada_dias END,
             mensagem = CASE WHEN p_dados ? 'mensagem' THEN v_msg ELSE mensagem END,
             automacao_ativa = COALESCE((p_dados ->> 'automacao_ativa')::boolean, automacao_ativa)
       WHERE id = p_etapa
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma coluna com esse nome ou com esses dias de atraso.'
      USING ERRCODE = 'PT409', DETAIL = 'coluna_duplicada';
  END;

  PERFORM private.cobranca_etapas_reordenar(p_org);
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_coluna_remover(p_etapa uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_etapa public.cobranca_etapas%ROWTYPE;
BEGIN
  SELECT * INTO v_etapa FROM public.cobranca_etapas WHERE id = p_etapa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coluna não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'coluna_inexistente';
  END IF;
  PERFORM private.cobranca_exigir(v_etapa.organization_id, 'edit');
  IF v_etapa.papel <> 'aberta' OR v_etapa.entrada_dias IS NULL OR v_etapa.pausa_regua THEN
    RAISE EXCEPTION 'Só colunas de dias de atraso podem ser removidas.' USING ERRCODE = 'PT422', DETAIL = 'coluna_fixa';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cobranca_casos WHERE etapa_id = p_etapa AND encerrado_em IS NULL) THEN
    RAISE EXCEPTION 'Há casos nesta coluna. Mova-os antes de remover.' USING ERRCODE = 'PT409', DETAIL = 'coluna_com_casos';
  END IF;
  UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'coluna_removida'
   WHERE etapa_id = p_etapa AND status = 'pendente';
  DELETE FROM public.cobranca_etapas WHERE id = p_etapa;
  PERFORM private.cobranca_etapas_reordenar(v_etapa.organization_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_salvar(p_org uuid, p_dados jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_etapa uuid := NULLIF(p_dados ->> 'etapa_apos_quebra_id', '')::uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_dados ? 'janela' AND NOT private.cobranca_janela_valida(p_dados -> 'janela') THEN
    RAISE EXCEPTION 'Horário de envio inválido: cada dia precisa de início antes do fim (HH:MM).'
      USING ERRCODE = 'PT422', DETAIL = 'janela_invalida';
  END IF;
  IF v_etapa IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas
        WHERE id = v_etapa AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa inválida para a volta do compromisso quebrado.'
      USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  BEGIN
    UPDATE public.cobranca_regua SET
      janela                   = CASE WHEN p_dados ? 'janela' THEN p_dados -> 'janela' ELSE janela END,
      teto_diario              = COALESCE((p_dados ->> 'teto_diario')::int, teto_diario),
      intervalo_min_segundos   = COALESCE((p_dados ->> 'intervalo_min_segundos')::int, intervalo_min_segundos),
      intervalo_max_segundos   = COALESCE((p_dados ->> 'intervalo_max_segundos')::int, intervalo_max_segundos),
      pausa_apos_resposta_dias = COALESCE((p_dados ->> 'pausa_apos_resposta_dias')::int, pausa_apos_resposta_dias),
      intervalo_minimo_dias    = COALESCE((p_dados ->> 'intervalo_minimo_dias')::int, intervalo_minimo_dias),
      como_pagar               = CASE WHEN p_dados ? 'como_pagar'
                                      THEN NULLIF(btrim(p_dados ->> 'como_pagar'), '') ELSE como_pagar END,
      etapa_apos_quebra_id     = CASE WHEN p_dados ? 'etapa_apos_quebra_id' THEN v_etapa ELSE etapa_apos_quebra_id END,
      updated_at = now(), updated_by = auth.uid()
     WHERE organization_id = p_org;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Valores fora do permitido: teto de 1 a 300 por dia, intervalo de 30 s a 30 min (mínimo até o máximo), pausas de até 30 dias, "como pagar" até 600 caracteres.'
      USING ERRCODE = 'PT422', DETAIL = 'valores_fora_do_permitido';
  END;
END
$fn$;

DROP FUNCTION private.cobranca_prazo(jsonb, text, timestamptz, integer);

ALTER TABLE public.cobranca_regua DROP COLUMN prazo_dias_uteis;

ALTER TABLE public.cobranca_etapas DROP CONSTRAINT cobranca_etapas_mensagem_check;
ALTER TABLE public.cobranca_etapas
  ADD CONSTRAINT cobranca_etapas_mensagem_check
  CHECK (length(btrim(mensagem)) BETWEEN 1 AND 1000);

ALTER TABLE public.cobranca_etapas
  DROP CONSTRAINT cobranca_etapas_trilha_so_com_dias,
  DROP CONSTRAINT cobranca_etapas_personalizada_sem_dias,
  DROP COLUMN trilha,
  DROP COLUMN personalizada;

COMMIT;
