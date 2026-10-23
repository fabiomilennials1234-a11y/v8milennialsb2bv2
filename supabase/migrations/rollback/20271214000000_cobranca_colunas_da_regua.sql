-- Rollback de 20271214000000_cobranca_colunas_da_regua.sql
--
-- Volta a régua por passos. As colunas FICAM com o nome novo ("7 dias de
-- atraso"...): cada coluna com dias vira de novo um passo de atraso que move o
-- caso para ela, então o quadro e a régua seguem funcionando. A volta do
-- compromisso quebrado fica "não move" (NULL) — escolha de novo na tela.
--
-- PERDE DADO, só este: a fila e o histórico dos envios por movimento à mão
-- (gatilho 'entrada_manual'). Os eventos 'mensagem_enviada' na ficha ficam.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1. Dados: coluna com dias → passo de atraso
INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id, ativo)
SELECT e.organization_id, 'atraso', e.entrada_dias, e.mensagem, e.id, e.automacao_ativa
  FROM public.cobranca_etapas e
 WHERE e.entrada_dias IS NOT NULL
ON CONFLICT ON CONSTRAINT cobranca_regua_passos_dia_unico DO NOTHING;

UPDATE public.cobranca_regua_envios en
   SET passo_id = p.id
  FROM public.cobranca_regua_passos p
 WHERE en.gatilho = 'atraso' AND en.passo_id IS NULL
   AND p.organization_id = en.organization_id AND p.gatilho = 'atraso' AND p.dias = en.dias;

DELETE FROM public.cobranca_regua_envios WHERE gatilho = 'entrada_manual';

-- 2. Fila: chave única antiga
DROP INDEX public.cobranca_regua_envios_manual_uma_vez;
DROP INDEX public.cobranca_regua_envios_uma_vez;
ALTER TABLE public.cobranca_regua_envios
  ADD CONSTRAINT cobranca_regua_envios_uma_vez UNIQUE (caso_id, gatilho, dias, referencia),
  DROP CONSTRAINT cobranca_regua_envios_gatilho,
  DROP COLUMN etapa_id,
  DROP COLUMN criado_por;

-- 3. Funções novas
DROP FUNCTION public.cobranca_coluna_salvar(uuid, uuid, jsonb);
DROP FUNCTION public.cobranca_coluna_remover(uuid);
DROP FUNCTION public.cobranca_caso_previa_envio(uuid, uuid, timestamptz);
DROP FUNCTION private.cobranca_colunas_migrar(uuid);
DROP FUNCTION private.cobranca_etapas_reordenar(uuid);
DROP FUNCTION private.cobranca_rotulo_de_dias(integer);
DROP FUNCTION private.cobranca_cor_de_dias(integer);

-- 4. Corpos antigos (cópia literal de 20271212000000 e 20271213000000)
DROP FUNCTION public.cobranca_caso_mover(uuid, uuid, double precision, boolean);

CREATE FUNCTION public.cobranca_caso_mover(p_caso uuid, p_etapa uuid, p_posicao double precision DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_etapa public.cobranca_etapas%ROWTYPE;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL THEN
    RAISE EXCEPTION 'Caso não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');
  IF v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso encerrado não volta ao fluxo.' USING ERRCODE = 'PT422', DETAIL = 'caso_encerrado';
  END IF;

  SELECT * INTO v_etapa FROM public.cobranca_etapas
   WHERE id = p_etapa AND organization_id = v_caso.organization_id;
  IF v_etapa.id IS NULL THEN
    RAISE EXCEPTION 'Etapa não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'etapa_nao_encontrada';
  END IF;

  IF v_etapa.papel = 'aberta' THEN
    UPDATE public.cobranca_casos
       SET etapa_id = p_etapa,
           posicao = COALESCE(p_posicao,
                       COALESCE((SELECT max(posicao) FROM public.cobranca_casos
                                  WHERE etapa_id = p_etapa AND encerrado_em IS NULL), 0) + 1),
           etapa_desde = CASE WHEN etapa_id = p_etapa THEN etapa_desde ELSE now() END
     WHERE id = p_caso;
    IF v_caso.etapa_id <> p_etapa THEN
      PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
        'etapa_alterada', jsonb_build_object('de', v_caso.etapa_id, 'para', p_etapa));
    END IF;
    RETURN p_caso;
  END IF;

  IF v_etapa.papel = 'recuperado' AND EXISTS (
       SELECT 1 FROM public.cobranca_titulos_saldo
        WHERE inadimplente_id = v_caso.inadimplente_id AND saldo > 0) THEN
    RAISE EXCEPTION 'Ainda há saldo em aberto. Registre o pagamento para recuperar o caso.'
      USING ERRCODE = 'PT422', DETAIL = 'saldo_em_aberto';
  END IF;

  IF v_etapa.papel = 'cancelado' THEN
    UPDATE public.cobranca_titulos SET status = 'cancelado'
     WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto';
  END IF;

  PERFORM private.cobranca_encerrar_caso(p_caso, v_etapa.papel);
  RETURN p_caso;
END
$fn$;

REVOKE ALL ON FUNCTION public.cobranca_caso_mover(uuid, uuid, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_caso_mover(uuid, uuid, double precision) TO authenticated, service_role;

DROP FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz);

CREATE FUNCTION private.cobranca_regua_candidatos(p_org uuid, p_agora timestamptz)
RETURNS TABLE (
  caso_id uuid, inadimplente_id uuid, passo_id uuid, gatilho text, dias integer,
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
    SELECT ca.caso_id, ca.inadimplente_id, p.id AS passo_id, 'atraso'::text AS gatilho, p.dias,
           ca.venc AS referencia,
           CASE WHEN p.mensagem IS NULL THEN 'pulado'
                WHEN ca.telefone IS NULL THEN 'pulado'
                WHEN ca.nao_contatar THEN 'pulado'
                ELSE 'pendente' END AS status,
           CASE WHEN p.mensagem IS NULL THEN 'so_etapa'
                WHEN ca.telefone IS NULL THEN 'sem_telefone'
                WHEN ca.nao_contatar THEN 'nao_contatar' END AS motivo,
           p.mover_para_etapa_id AS mover_para,
           ca.respondeu OR ca.recente AS adiar
      FROM casos ca
      CROSS JOIN cfg
      CROSS JOIN LATERAL (
        SELECT p.* FROM public.cobranca_regua_passos p
         WHERE p.organization_id = cfg.organization_id AND p.ativo AND p.gatilho = 'atraso'
           AND p.dias <= cfg.hoje - ca.venc
         ORDER BY p.dias DESC
         LIMIT 1
      ) p
     WHERE ca.papel = 'aberta' AND NOT ca.pausa_regua AND NOT ca.tem_compromisso
       AND ca.saldo > 0 AND ca.venc IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cobranca_regua_envios en
          WHERE en.caso_id = ca.caso_id AND en.gatilho = 'atraso'
            AND en.dias = p.dias AND en.referencia = ca.venc)
  ), lembrete AS (
    SELECT ca.caso_id, ca.inadimplente_id, p.id AS passo_id, 'lembrete_compromisso'::text AS gatilho, p.dias,
           pa.vencimento AS referencia,
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
  SELECT caso_id, inadimplente_id, passo_id, gatilho, dias, referencia, status, motivo, mover_para
    FROM (SELECT * FROM atraso UNION ALL SELECT * FROM lembrete) x
   WHERE NOT (x.status = 'pendente' AND x.adiar);
$fn$;

REVOKE ALL ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) TO service_role;

DROP FUNCTION private.cobranca_regua_quebrar_compromissos(uuid, date, timestamptz);

CREATE FUNCTION private.cobranca_regua_quebrar_compromissos(p_org uuid, p_hoje date)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r       record;
  v_n     integer := 0;
  v_volta uuid;
BEGIN
  SELECT etapa_apos_quebra_id INTO v_volta FROM public.cobranca_regua WHERE organization_id = p_org;

  FOR r IN
    SELECT co.id, co.caso_id, c.inadimplente_id, d.devido, COALESCE(pg.pago, 0) AS pago
      FROM public.cobranca_compromissos co
      JOIN public.cobranca_casos c ON c.id = co.caso_id AND c.encerrado_em IS NULL
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
    IF v_volta IS NOT NULL THEN
      PERFORM private.cobranca_regua_mover(r.caso_id, v_volta, '{"motivo":"compromisso_quebrado"}'::jsonb);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION private.cobranca_regua_quebrar_compromissos(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.cobranca_semear_etapas(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cobranca_etapas WHERE organization_id = p_org) THEN
    RETURN;
  END IF;
  INSERT INTO public.cobranca_etapas (organization_id, nome, posicao, papel, cor, pausa_regua) VALUES
    (p_org, 'Vencido',            1, 'aberta',     '#7cc3f8', false),
    (p_org, 'Em cobrança',        2, 'aberta',     '#3ea6f5', false),
    (p_org, 'Em negociação',      3, 'aberta',     '#a78bfa', true),
    (p_org, 'Promessa ou acordo', 4, 'aberta',     '#ffc800', true),
    (p_org, 'Cobrança intensiva', 5, 'aberta',     '#fb923c', false),
    (p_org, 'Jurídico',           6, 'aberta',     '#f26d6d', true),
    (p_org, 'Recuperado',         7, 'recuperado', '#50d685', true),
    (p_org, 'Perdido',            8, 'perdido',    '#ef4444', true),
    (p_org, 'Cancelado',          9, 'cancelado',  '#a3a3a3', true);
END
$fn$;

CREATE OR REPLACE FUNCTION private.cobranca_regua_semear(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_em_cobranca uuid;
  v_intensiva   uuid;
  v_juridico    uuid;
BEGIN
  PERFORM private.cobranca_semear_etapas(p_org);

  SELECT id INTO v_em_cobranca FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Em cobrança';
  SELECT id INTO v_intensiva FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Cobrança intensiva';
  SELECT id INTO v_juridico FROM public.cobranca_etapas
   WHERE organization_id = p_org AND papel = 'aberta' AND nome = 'Jurídico';

  INSERT INTO public.cobranca_regua (organization_id, etapa_apos_quebra_id, updated_by)
  VALUES (p_org, v_em_cobranca, NULL)
  ON CONFLICT (organization_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM public.cobranca_regua_passos WHERE organization_id = p_org) THEN
    RETURN;
  END IF;

  -- Textos dentro do CDC (art. 42): sem exposição, constrangimento ou ameaça.
  -- O primeiro ensina a sair — reduz denúncia de spam, que é o que bane chip.
  INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id) VALUES
    (p_org, 'atraso', 1,
     E'Olá, {primeiro_nome}! Aqui é da {empresa}. O pagamento de {valor}, com vencimento em {vencimento}, ainda não consta para nós. Se já pagou, pode desconsiderar esta mensagem.\n{como_pagar}\nPara não receber mais estas mensagens, responda SAIR.',
     NULL),
    (p_org, 'atraso', 3,
     E'{primeiro_nome}, tudo bem? Passando para lembrar do valor de {valor} em aberto desde {vencimento}. Se precisar de ajuda para regularizar, é só responder esta mensagem.\n{como_pagar}',
     NULL),
    (p_org, 'atraso', 7,
     E'Olá, {primeiro_nome}. O valor de {valor} segue em aberto há {dias_atraso} dias. Queremos ajudar você a resolver da melhor forma: responda aqui e a nossa equipe fala com você.\n{como_pagar}',
     v_em_cobranca),
    (p_org, 'atraso', 15,
     E'{primeiro_nome}, ainda não identificamos o pagamento de {valor} (vencido em {vencimento}). Podemos combinar uma data ou um parcelamento. Responda esta mensagem para conversarmos.',
     NULL),
    (p_org, 'atraso', 30,
     E'Olá, {primeiro_nome}. O débito de {valor} está em aberto há {dias_atraso} dias. Queremos encontrar com você a melhor forma de regularizar. Responda esta mensagem para falar com a nossa equipe.',
     v_intensiva),
    (p_org, 'lembrete_compromisso', 1,
     E'Olá, {primeiro_nome}! Lembrete: {quando} ({parcela_vencimento}) vence o pagamento de {parcela_valor} que combinamos.\n{como_pagar}',
     NULL);

  IF v_juridico IS NOT NULL THEN
    INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id)
    VALUES (p_org, 'atraso', 60, NULL, v_juridico);
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_planejar(p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org    record;
  c        record;
  v_novos  integer := 0;
  v_moves  integer := 0;
  v_quebra integer := 0;
  v_quando timestamptz;
BEGIN

  FOR v_org IN
    SELECT r.organization_id, r.janela, o.timezone
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.ativa
       AND private.cobranca_habilitada(r.organization_id)
       AND private.cobranca_regua_instancia(r.organization_id) IS NOT NULL
  LOOP
    v_quebra := v_quebra + private.cobranca_regua_quebrar_compromissos(
      v_org.organization_id, (p_agora AT TIME ZONE v_org.timezone)::date);

    v_quando := COALESCE(private.cobranca_proxima_janela(v_org.janela, v_org.timezone, p_agora), p_agora);

    FOR c IN SELECT * FROM private.cobranca_regua_candidatos(v_org.organization_id, p_agora) LOOP
      INSERT INTO public.cobranca_regua_envios
        (organization_id, caso_id, inadimplente_id, passo_id, gatilho, dias, referencia, status, motivo, agendado_para)
      VALUES
        (v_org.organization_id, c.caso_id, c.inadimplente_id, c.passo_id, c.gatilho, c.dias, c.referencia,
         c.status, c.motivo, v_quando)
      ON CONFLICT ON CONSTRAINT cobranca_regua_envios_uma_vez DO NOTHING;
      IF FOUND THEN
        v_novos := v_novos + 1;
        IF c.mover_para IS NOT NULL
           AND private.cobranca_regua_mover(c.caso_id, c.mover_para,
                 jsonb_build_object('motivo', 'passo', 'dias', c.dias)) THEN
          v_moves := v_moves + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('envios_criados', v_novos, 'etapas_movidas', v_moves, 'compromissos_quebrados', v_quebra);
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_reservar(p_lote integer DEFAULT 10, p_agora timestamptz DEFAULT now())
RETURNS TABLE (
  envio_id uuid, organization_id uuid, instancia_id uuid, telefone text,
  mensagem text, variaveis jsonb
)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
DECLARE
  v_org    record;
  v_env    public.cobranca_regua_envios%ROWTYPE;
  v_motivo text;
  v_inst   uuid;
  v_tel    text;
  v_msg    text;
  v_perdido record;
  v_n      integer := 0;
BEGIN

  FOR v_perdido IN
    UPDATE public.cobranca_regua_envios en
       SET status = 'falhou', motivo = 'resultado_incerto', lease_ate = NULL,
           ultimo_erro = 'O worker caiu durante o envio; a mensagem pode ou não ter saído.'
     WHERE en.status = 'enviando' AND en.lease_ate < p_agora
     RETURNING en.organization_id AS org, en.inadimplente_id AS inad, en.caso_id AS caso, en.id AS envio
  LOOP
    PERFORM private.cobranca_evento(v_perdido.org, v_perdido.inad, v_perdido.caso, 'envio_falhou',
      jsonb_build_object('envio_id', v_perdido.envio, 'motivo', 'resultado_incerto'));
  END LOOP;

  FOR v_org IN
    SELECT r.organization_id, r.janela, r.teto_diario, r.intervalo_min_segundos, r.intervalo_max_segundos,
           o.timezone
      FROM public.cobranca_regua r
      JOIN public.organizations o ON o.id = r.organization_id
     WHERE r.ativa
       AND (r.proximo_envio_apos IS NULL OR r.proximo_envio_apos <= p_agora)
       AND private.cobranca_habilitada(r.organization_id)
       AND private.cobranca_na_janela(r.janela, o.timezone, p_agora)
       AND EXISTS (SELECT 1 FROM public.cobranca_regua_envios en
                    WHERE en.organization_id = r.organization_id AND en.status = 'pendente'
                      AND en.agendado_para <= p_agora)
     ORDER BY r.proximo_envio_apos NULLS FIRST
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    EXIT WHEN v_n >= p_lote;

    v_inst := private.cobranca_regua_instancia(v_org.organization_id);
    CONTINUE WHEN v_inst IS NULL;

    CONTINUE WHEN (SELECT count(*) FROM public.cobranca_regua_envios en
                    WHERE en.organization_id = v_org.organization_id AND en.status = 'enviado'
                      AND (en.enviado_em AT TIME ZONE v_org.timezone)::date
                          = (p_agora AT TIME ZONE v_org.timezone)::date) >= v_org.teto_diario;

    -- Até achar um envio válido desta org (os inválidos viram 'cancelado').
    LOOP
      SELECT * INTO v_env FROM public.cobranca_regua_envios en
       WHERE en.organization_id = v_org.organization_id AND en.status = 'pendente'
         AND en.agendado_para <= p_agora
       -- Mais atrasado primeiro; empate na fila desfeito por chegada e id.
       ORDER BY en.dias DESC, en.agendado_para, en.created_at, en.id
       LIMIT 1
       FOR UPDATE SKIP LOCKED;
      EXIT WHEN NOT FOUND;

      v_motivo := NULL;
      v_tel := NULL;
      SELECT CASE
               WHEN c.encerrado_em IS NOT NULL THEN 'caso_encerrado'
               WHEN i.arquivado_em IS NOT NULL THEN 'arquivado'
               WHEN i.nao_contatar THEN 'nao_contatar'
               WHEN i.telefone IS NULL THEN 'sem_telefone'
               WHEN v_env.gatilho = 'atraso' AND (e.papel <> 'aberta' OR e.pausa_regua) THEN 'etapa_pausada'
               WHEN v_env.gatilho = 'atraso' AND EXISTS (
                      SELECT 1 FROM public.cobranca_compromissos co
                       WHERE co.caso_id = c.id AND co.status = 'ativo') THEN 'compromisso_ativo'
               WHEN v_env.gatilho = 'atraso' AND COALESCE((
                      SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0)
                        FROM public.cobranca_titulos_saldo ts
                       WHERE ts.inadimplente_id = c.inadimplente_id), 'infinity'::date) <> v_env.referencia
                    THEN 'divida_mudou'
               WHEN v_env.gatilho = 'lembrete_compromisso' AND NOT EXISTS (
                      SELECT 1 FROM public.cobranca_compromissos co
                        JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
                       WHERE co.caso_id = c.id AND co.status = 'ativo' AND pa.vencimento = v_env.referencia)
                    THEN 'compromisso_encerrado'
             END,
             i.telefone
        INTO v_motivo, v_tel
        FROM public.cobranca_casos c
        JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
        JOIN public.cobranca_etapas e ON e.id = c.etapa_id
       WHERE c.id = v_env.caso_id;
      IF NOT FOUND THEN
        v_motivo := 'caso_encerrado';
      END IF;

      v_msg := NULL;
      SELECT p.mensagem INTO v_msg FROM public.cobranca_regua_passos p WHERE p.id = v_env.passo_id;
      IF v_motivo IS NULL AND (v_msg IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.cobranca_regua_passos p WHERE p.id = v_env.passo_id AND p.ativo)) THEN
        v_motivo := 'passo_desligado';
      END IF;

      IF v_motivo IS NOT NULL THEN
        UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = v_motivo WHERE id = v_env.id;
        CONTINUE;
      END IF;

      UPDATE public.cobranca_regua_envios
         SET status = 'enviando', tentativas = tentativas + 1, lease_ate = p_agora + interval '3 minutes',
             telefone = v_tel
       WHERE id = v_env.id;

      UPDATE public.cobranca_regua
         SET proximo_envio_apos = p_agora + make_interval(secs =>
               v_org.intervalo_min_segundos
               + floor(random() * (v_org.intervalo_max_segundos - v_org.intervalo_min_segundos + 1)))
       WHERE organization_id = v_org.organization_id;

      envio_id := v_env.id;
      organization_id := v_org.organization_id;
      instancia_id := v_inst;
      telefone := v_tel;
      mensagem := v_msg;
      variaveis := private.cobranca_regua_variaveis(v_env.caso_id, v_env.gatilho, v_env.referencia, p_agora);
      RETURN NEXT;
      v_n := v_n + 1;
      EXIT;
    END LOOP;
  END LOOP;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_concluir(
  p_envio uuid, p_resultado text, p_texto text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL, p_erro text DEFAULT NULL,
  p_agora timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_env public.cobranca_regua_envios%ROWTYPE;
BEGIN
  IF p_resultado NOT IN ('enviado', 'retentar', 'falhou', 'sem_whatsapp') THEN
    RAISE EXCEPTION 'Resultado inválido: %', p_resultado USING ERRCODE = 'PT422';
  END IF;

  SELECT * INTO v_env FROM public.cobranca_regua_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND OR v_env.status <> 'enviando' THEN
    RETURN COALESCE(v_env.status, 'inexistente');
  END IF;

  IF p_resultado = 'enviado' THEN
    UPDATE public.cobranca_regua_envios
       SET status = 'enviado', enviado_em = p_agora, lease_ate = NULL, texto = p_texto,
           provider_message_id = p_provider_message_id, ultimo_erro = NULL
     WHERE id = p_envio;
    PERFORM private.cobranca_evento(v_env.organization_id, v_env.inadimplente_id, v_env.caso_id, 'mensagem_enviada',
      jsonb_build_object('origem', 'regua', 'envio_id', p_envio, 'gatilho', v_env.gatilho,
                         'dias', v_env.dias, 'texto', left(p_texto, 1000)));
    RETURN 'enviado';
  END IF;

  IF p_resultado = 'retentar' AND v_env.tentativas < 3 THEN
    UPDATE public.cobranca_regua_envios
       SET status = 'pendente', lease_ate = NULL, ultimo_erro = left(p_erro, 1000),
           agendado_para = p_agora + make_interval(mins => 5 * (2 ^ (v_env.tentativas - 1))::int)
     WHERE id = p_envio;
    RETURN 'pendente';
  END IF;

  UPDATE public.cobranca_regua_envios
     SET status = 'falhou', lease_ate = NULL, ultimo_erro = left(p_erro, 1000),
         motivo = CASE WHEN p_resultado = 'sem_whatsapp' THEN 'sem_whatsapp' ELSE 'erro_no_envio' END
   WHERE id = p_envio;
  PERFORM private.cobranca_evento(v_env.organization_id, v_env.inadimplente_id, v_env.caso_id, 'envio_falhou',
    jsonb_build_object('envio_id', p_envio,
                       'motivo', CASE WHEN p_resultado = 'sem_whatsapp' THEN 'sem_whatsapp' ELSE 'erro_no_envio' END,
                       'erro', left(p_erro, 300)));
  RETURN 'falhou';
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_ativar(p_org uuid, p_ativa boolean)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF p_ativa THEN
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances
                    WHERE organization_id = p_org AND reserved_for = 'collections') THEN
      RAISE EXCEPTION 'Escolha o número da cobrança antes de ligar a régua.'
        USING ERRCODE = 'PT422', DETAIL = 'sem_numero';
    END IF;
    IF private.cobranca_regua_instancia(p_org) IS NULL THEN
      RAISE EXCEPTION 'O número da cobrança está desconectado. Reconecte em Configurações › WhatsApp.'
        USING ERRCODE = 'PT422', DETAIL = 'numero_desconectado';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua_passos
                    WHERE organization_id = p_org AND ativo AND mensagem IS NOT NULL) THEN
      RAISE EXCEPTION 'A régua não tem nenhum passo com mensagem ligado.'
        USING ERRCODE = 'PT422', DETAIL = 'sem_passos';
    END IF;
  ELSE
    -- Desligar esvazia a fila: religar replaneja do zero, sem rajada acumulada.
    UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'regua_desligada'
     WHERE organization_id = p_org AND status = 'pendente';
  END IF;

  UPDATE public.cobranca_regua SET ativa = p_ativa, updated_at = now(), updated_by = auth.uid()
   WHERE organization_id = p_org;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_passo_salvar(p_org uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id      uuid;
  v_gatilho text := COALESCE(p_dados ->> 'gatilho', 'atraso');
  v_dias    int;
  v_msg     text := NULLIF(btrim(COALESCE(p_dados ->> 'mensagem', '')), '');
  v_mover   uuid := NULLIF(p_dados ->> 'mover_para_etapa_id', '')::uuid;
  v_ativo   boolean := COALESCE((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  BEGIN
    v_dias := (p_dados ->> 'dias')::int;
  EXCEPTION WHEN OTHERS THEN
    v_dias := NULL;
  END;
  IF v_gatilho NOT IN ('atraso', 'lembrete_compromisso') THEN
    RAISE EXCEPTION 'Tipo de passo inválido.' USING ERRCODE = 'PT422', DETAIL = 'gatilho_invalido';
  END IF;
  IF v_dias IS NULL
     OR (v_gatilho = 'atraso' AND v_dias NOT BETWEEN 1 AND 365)
     OR (v_gatilho = 'lembrete_compromisso' AND v_dias NOT BETWEEN 0 AND 7) THEN
    RAISE EXCEPTION 'Dias fora do permitido: atraso de 1 a 365; lembrete de 0 a 7 dias antes.'
      USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'A mensagem passa de 1.000 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_longa';
  END IF;
  IF v_gatilho = 'lembrete_compromisso' AND (v_msg IS NULL OR v_mover IS NOT NULL) THEN
    RAISE EXCEPTION 'Lembrete precisa de mensagem e não muda etapa.' USING ERRCODE = 'PT422', DETAIL = 'lembrete_invalido';
  END IF;
  IF v_msg IS NULL AND v_mover IS NULL THEN
    RAISE EXCEPTION 'O passo precisa mandar mensagem, mudar a etapa, ou os dois.'
      USING ERRCODE = 'PT422', DETAIL = 'passo_vazio';
  END IF;
  IF v_mover IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas WHERE id = v_mover AND organization_id = p_org AND papel = 'aberta') THEN
    RAISE EXCEPTION 'Etapa de destino inválida.' USING ERRCODE = 'PT422', DETAIL = 'etapa_invalida';
  END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id, ativo)
      VALUES (p_org, v_gatilho, v_dias, v_msg, v_mover, v_ativo)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.cobranca_regua_passos
         SET gatilho = v_gatilho, dias = v_dias, mensagem = v_msg, mover_para_etapa_id = v_mover, ativo = v_ativo
       WHERE id = p_id AND organization_id = p_org
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'Passo não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'passo_inexistente';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um passo neste dia.' USING ERRCODE = 'PT409', DETAIL = 'passo_duplicado';
  END;
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.cobranca_regua_previa(p_org uuid, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cfg  record;
  v_hoje date;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'view');

  SELECT r.*, o.timezone INTO v_cfg
    FROM public.cobranca_regua r JOIN public.organizations o ON o.id = r.organization_id
   WHERE r.organization_id = p_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configurada', false);
  END IF;
  v_hoje := (p_agora AT TIME ZONE v_cfg.timezone)::date;

  RETURN jsonb_build_object(
    'configurada', true,
    'ativa', v_cfg.ativa,
    'numero_pronto', private.cobranca_regua_instancia(p_org) IS NOT NULL,
    'na_janela', private.cobranca_na_janela(v_cfg.janela, v_cfg.timezone, p_agora),
    'proxima_janela', private.cobranca_proxima_janela(v_cfg.janela, v_cfg.timezone, p_agora),
    'teto_diario', v_cfg.teto_diario,
    'enviados_hoje', (SELECT count(*) FROM public.cobranca_regua_envios en
                       WHERE en.organization_id = p_org AND en.status = 'enviado'
                         AND (en.enviado_em AT TIME ZONE v_cfg.timezone)::date = v_hoje),
    'na_fila', (SELECT count(*) FROM public.cobranca_regua_envios en
                 WHERE en.organization_id = p_org AND en.status IN ('pendente', 'enviando')),
    'candidatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'caso_id', c.caso_id, 'inadimplente_id', c.inadimplente_id, 'nome', i.nome,
               'gatilho', c.gatilho, 'dias', c.dias, 'status', c.status, 'motivo', c.motivo,
               'mover_para', c.mover_para, 'mensagem', p.mensagem,
               'variaveis', private.cobranca_regua_variaveis(c.caso_id, c.gatilho, c.referencia, p_agora))
             ORDER BY c.gatilho, c.dias DESC, i.nome)
        FROM private.cobranca_regua_candidatos(p_org, p_agora) c
        JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
        LEFT JOIN public.cobranca_regua_passos p ON p.id = c.passo_id), '[]'::jsonb));
END
$fn$;


-- 5. Colunas
DROP INDEX public.cobranca_etapas_uma_coluna_por_dia;
ALTER TABLE public.cobranca_etapas
  DROP CONSTRAINT cobranca_etapas_automacao_so_em_aberta,
  DROP COLUMN entrada_dias,
  DROP COLUMN mensagem,
  DROP COLUMN automacao_ativa;


COMMIT;
