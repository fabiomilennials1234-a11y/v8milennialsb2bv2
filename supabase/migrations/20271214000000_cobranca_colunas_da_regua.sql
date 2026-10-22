-- 20271214000000_cobranca_colunas_da_regua.sql
--
-- Cobrança · a régua vira as colunas do Fluxo (pedido do CTO, 22/10).
-- ROLLBACK pareado: rollback/20271214000000_cobranca_colunas_da_regua.sql
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────────
-- Antes: colunas por fase (Em cobrança, Cobrança intensiva) e, à parte, passos
-- da régua por dias de atraso, que só às vezes moviam o caso.
-- Agora: a COLUNA é a automação.
--   · entrada_dias: o caso entra sozinho com N dias de atraso (só para a frente);
--   · mensagem:     sai quando o caso ENTRA na coluna — pela régua, ou movido à
--                   mão com "Mover e enviar" (a tela pergunta, com prévia);
--   · automacao_ativa: liga/desliga a entrada automática e a mensagem dela.
-- O lembrete de promessa/parcela segue como passo (não é coluna).
--
-- Layout novo (orgs novas e migração das existentes):
--   Vencido · 1 · 3 · 7 · 15 · 30 dias de atraso · Em negociação ·
--   Promessa ou acordo · Jurídico (entra com 60, sem mensagem) · desfechos.
-- "Em cobrança" vira "7 dias de atraso" e "Cobrança intensiva" vira "30 dias
-- de atraso" (os casos vão junto); 1, 3 e 15 dias nascem dos passos.
--
-- ── ENTRADA AUTOMÁTICA: UMA VEZ ─────────────────────────────────────────────
-- Cada entrada automática grava uma linha em cobranca_regua_envios (enviada,
-- na fila, ou 'pulado' quando não há o que mandar) com a chave
-- (caso, 'atraso', dias da coluna, vencimento âncora). A régua só move o caso
-- para uma coluna cuja chave ainda não existe: se a equipe voltar o card, a
-- régua não o empurra de novo para a mesma coluna — só para a próxima.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Colunas com automação
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.cobranca_etapas
  ADD COLUMN entrada_dias    integer CHECK (entrada_dias BETWEEN 1 AND 365),
  ADD COLUMN mensagem        text    CHECK (length(btrim(mensagem)) BETWEEN 1 AND 1000),
  ADD COLUMN automacao_ativa boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT cobranca_etapas_automacao_so_em_aberta
    CHECK ((entrada_dias IS NULL AND mensagem IS NULL) OR papel = 'aberta');

CREATE UNIQUE INDEX cobranca_etapas_uma_coluna_por_dia
  ON public.cobranca_etapas (organization_id, entrada_dias) WHERE entrada_dias IS NOT NULL;

ALTER TABLE public.cobranca_regua_envios
  ADD COLUMN etapa_id   uuid REFERENCES public.cobranca_etapas(id) ON DELETE SET NULL,
  ADD COLUMN criado_por uuid DEFAULT auth.uid(),
  ADD CONSTRAINT cobranca_regua_envios_gatilho
    CHECK (gatilho IN ('atraso', 'lembrete_compromisso', 'entrada_manual'));

-- Idempotência em duas chaves. Régua: uma entrada por (caso, gatilho, dias,
-- âncora), como antes. Movimento à mão: uma mensagem por coluna por dia — a
-- chave antiga juntaria duas colunas sem dias (Em negociação, Promessa) no
-- mesmo "dias = 0" e barraria a segunda.
ALTER TABLE public.cobranca_regua_envios DROP CONSTRAINT cobranca_regua_envios_uma_vez;
CREATE UNIQUE INDEX cobranca_regua_envios_uma_vez
  ON public.cobranca_regua_envios (caso_id, gatilho, dias, referencia) WHERE gatilho <> 'entrada_manual';
CREATE UNIQUE INDEX cobranca_regua_envios_manual_uma_vez
  ON public.cobranca_regua_envios (caso_id, etapa_id, referencia) WHERE gatilho = 'entrada_manual';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ajudantes: rótulo, cor e ordem das colunas
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.cobranca_rotulo_de_dias(p_dias integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_dias = 1 THEN '1 dia de atraso' ELSE p_dias || ' dias de atraso' END;
$fn$;

-- Do azul (começo) ao vermelho (longe): a cor diz o quão atrasado está.
CREATE FUNCTION private.cobranca_cor_de_dias(p_dias integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_dias <= 3 THEN '#3ea6f5'
              WHEN p_dias <= 7 THEN '#818cf8'
              WHEN p_dias <= 15 THEN '#fbbf24'
              WHEN p_dias <= 30 THEN '#fb923c'
              ELSE '#f26d6d' END;
$fn$;

-- Ordem do quadro: entrada (sem dias, sem pausa) · colunas de dias · pausadas
-- sem dias · pausadas com dias (Jurídico) · desfechos.
CREATE FUNCTION private.cobranca_etapas_reordenar(p_org uuid)
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

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Sementes (orgs novas)
-- ─────────────────────────────────────────────────────────────────────────

-- Textos dentro do CDC (art. 42): sem exposição, constrangimento ou ameaça.
-- A primeira ensina a sair — reduz denúncia de spam, que é o que bane chip.
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
  INSERT INTO public.cobranca_etapas (organization_id, nome, posicao, papel, cor, pausa_regua, entrada_dias, mensagem) VALUES
    (p_org, 'Vencido', 1, 'aberta', '#7cc3f8', false, NULL, NULL),
    (p_org, '1 dia de atraso', 2, 'aberta', '#3ea6f5', false, 1,
     E'Olá, {primeiro_nome}! Aqui é da {empresa}. O pagamento de {valor}, com vencimento em {vencimento}, ainda não consta para nós. Se já pagou, pode desconsiderar esta mensagem.\n{como_pagar}\nPara não receber mais estas mensagens, responda SAIR.'),
    (p_org, '3 dias de atraso', 3, 'aberta', '#3ea6f5', false, 3,
     E'{primeiro_nome}, tudo bem? Passando para lembrar do valor de {valor} em aberto desde {vencimento}. Se precisar de ajuda para regularizar, é só responder esta mensagem.\n{como_pagar}'),
    (p_org, '7 dias de atraso', 4, 'aberta', '#818cf8', false, 7,
     E'Olá, {primeiro_nome}. O valor de {valor} segue em aberto há {dias_atraso} dias. Queremos ajudar você a resolver da melhor forma: responda aqui e a nossa equipe fala com você.\n{como_pagar}'),
    (p_org, '15 dias de atraso', 5, 'aberta', '#fbbf24', false, 15,
     E'{primeiro_nome}, ainda não identificamos o pagamento de {valor} (vencido em {vencimento}). Podemos combinar uma data ou um parcelamento. Responda esta mensagem para conversarmos.'),
    (p_org, '30 dias de atraso', 6, 'aberta', '#fb923c', false, 30,
     E'Olá, {primeiro_nome}. O débito de {valor} está em aberto há {dias_atraso} dias. Queremos encontrar com você a melhor forma de regularizar. Responda esta mensagem para falar com a nossa equipe.'),
    (p_org, 'Em negociação', 7, 'aberta', '#a78bfa', true, NULL, NULL),
    (p_org, 'Promessa ou acordo', 8, 'aberta', '#ffc800', true, NULL, NULL),
    (p_org, 'Jurídico', 9, 'aberta', '#f26d6d', true, 60, NULL),
    (p_org, 'Recuperado', 10, 'recuperado', '#50d685', true, NULL, NULL),
    (p_org, 'Perdido', 11, 'perdido', '#ef4444', true, NULL, NULL),
    (p_org, 'Cancelado', 12, 'cancelado', '#a3a3a3', true, NULL, NULL);
END
$fn$;

-- A régua passa a semear só a configuração e o lembrete (atraso mora nas colunas).
CREATE OR REPLACE FUNCTION private.cobranca_regua_semear(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.cobranca_semear_etapas(p_org);

  INSERT INTO public.cobranca_regua (organization_id, updated_by)
  VALUES (p_org, NULL)
  ON CONFLICT (organization_id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua_passos
                  WHERE organization_id = p_org AND gatilho = 'lembrete_compromisso') THEN
    INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem) VALUES
      (p_org, 'lembrete_compromisso', 1,
       E'Olá, {primeiro_nome}! Lembrete: {quando} ({parcela_vencimento}) vence o pagamento de {parcela_valor} que combinamos.\n{como_pagar}');
  END IF;
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Migração das orgs que já têm a régua: passos de atraso → colunas
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.cobranca_colunas_migrar(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  p public.cobranca_regua_passos%ROWTYPE;
  v_e public.cobranca_etapas%ROWTYPE;
  r record;
BEGIN
  -- Já migrada (ou nasceu no layout novo): nada a fazer.
  IF EXISTS (SELECT 1 FROM public.cobranca_etapas WHERE organization_id = p_org AND entrada_dias IS NOT NULL) THEN
    RETURN;
  END IF;

  -- Org com o quadro antigo que nunca abriu a régua: ganha os passos padrão
  -- (os mesmos da semente antiga) para cair no mesmo caminho abaixo.
  IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua_passos WHERE organization_id = p_org AND gatilho = 'atraso') THEN
    INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, mover_para_etapa_id)
    SELECT p_org, 'atraso', d.dias, d.mensagem,
           (SELECT id FROM public.cobranca_etapas
             WHERE organization_id = p_org AND papel = 'aberta' AND nome = d.coluna)
      FROM (VALUES
        (1, E'Olá, {primeiro_nome}! Aqui é da {empresa}. O pagamento de {valor}, com vencimento em {vencimento}, ainda não consta para nós. Se já pagou, pode desconsiderar esta mensagem.\n{como_pagar}\nPara não receber mais estas mensagens, responda SAIR.', NULL::text),
        (3, E'{primeiro_nome}, tudo bem? Passando para lembrar do valor de {valor} em aberto desde {vencimento}. Se precisar de ajuda para regularizar, é só responder esta mensagem.\n{como_pagar}', NULL),
        (7, E'Olá, {primeiro_nome}. O valor de {valor} segue em aberto há {dias_atraso} dias. Queremos ajudar você a resolver da melhor forma: responda aqui e a nossa equipe fala com você.\n{como_pagar}', 'Em cobrança'),
        (15, E'{primeiro_nome}, ainda não identificamos o pagamento de {valor} (vencido em {vencimento}). Podemos combinar uma data ou um parcelamento. Responda esta mensagem para conversarmos.', NULL),
        (30, E'Olá, {primeiro_nome}. O débito de {valor} está em aberto há {dias_atraso} dias. Queremos encontrar com você a melhor forma de regularizar. Responda esta mensagem para falar com a nossa equipe.', 'Cobrança intensiva'),
        (60, NULL, 'Jurídico')
      ) AS d(dias, mensagem, coluna)
     WHERE d.mensagem IS NOT NULL OR EXISTS (
       SELECT 1 FROM public.cobranca_etapas
        WHERE organization_id = p_org AND papel = 'aberta' AND nome = d.coluna);
  END IF;

  FOR p IN SELECT * FROM public.cobranca_regua_passos
            WHERE organization_id = p_org AND gatilho = 'atraso' ORDER BY dias LOOP
    v_e := NULL;
    IF p.mover_para_etapa_id IS NOT NULL THEN
      SELECT * INTO v_e FROM public.cobranca_etapas
       WHERE id = p.mover_para_etapa_id AND papel = 'aberta' AND entrada_dias IS NULL;
    END IF;

    IF v_e.id IS NOT NULL AND NOT v_e.pausa_regua THEN
      -- Fase que o passo alimentava vira a coluna de dias (casos vão junto).
      UPDATE public.cobranca_etapas
         SET nome = private.cobranca_rotulo_de_dias(p.dias), cor = private.cobranca_cor_de_dias(p.dias),
             entrada_dias = p.dias, mensagem = p.mensagem, automacao_ativa = p.ativo
       WHERE id = v_e.id;
    ELSIF v_e.id IS NOT NULL THEN
      -- Coluna pausada (Jurídico): ganha a entrada por dias, mantém o nome.
      UPDATE public.cobranca_etapas
         SET entrada_dias = p.dias, mensagem = p.mensagem, automacao_ativa = p.ativo
       WHERE id = v_e.id;
    ELSIF NOT EXISTS (SELECT 1 FROM public.cobranca_etapas
                       WHERE organization_id = p_org AND entrada_dias = p.dias) THEN
      INSERT INTO public.cobranca_etapas
        (organization_id, nome, posicao, papel, cor, pausa_regua, entrada_dias, mensagem, automacao_ativa)
      VALUES
        (p_org, private.cobranca_rotulo_de_dias(p.dias), 20000 + p.dias, 'aberta',
         private.cobranca_cor_de_dias(p.dias), false, p.dias, p.mensagem, p.ativo);
    END IF;
  END LOOP;

  -- Envios já feitos pela régua antiga: amarram na coluna do mesmo dia. É o
  -- que impede a régua nova de mandar de novo a mensagem que já saiu.
  UPDATE public.cobranca_regua_envios en
     SET etapa_id = e.id
    FROM public.cobranca_etapas e
   WHERE en.organization_id = p_org AND en.gatilho = 'atraso' AND en.etapa_id IS NULL
     AND e.organization_id = p_org AND e.entrada_dias = en.dias;

  DELETE FROM public.cobranca_regua_passos WHERE organization_id = p_org AND gatilho = 'atraso';

  -- Quebra de compromisso volta para a coluna do atraso atual (automático).
  UPDATE public.cobranca_regua SET etapa_apos_quebra_id = NULL WHERE organization_id = p_org;

  PERFORM private.cobranca_etapas_reordenar(p_org);

  -- Envio ainda na fila: o card vai para a coluna dele (só para a frente),
  -- senão o worker o cancelaria por 'saiu_da_coluna'.
  FOR r IN SELECT en.caso_id, en.etapa_id, en.dias FROM public.cobranca_regua_envios en
            WHERE en.organization_id = p_org AND en.gatilho = 'atraso'
              AND en.status IN ('pendente', 'enviando') AND en.etapa_id IS NOT NULL LOOP
    PERFORM private.cobranca_regua_mover(r.caso_id, r.etapa_id, jsonb_build_object('motivo', 'coluna', 'dias', r.dias));
  END LOOP;
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Candidatos: entrar na próxima coluna de dias
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz);

-- Atraso: caso aberto em coluna que não pausa a régua, sem compromisso, com
-- saldo. Alvo = coluna ativa de MAIOR entrada_dias <= atraso. Só entra se ela
-- estiver à frente da atual e a chave da entrada ainda não existir. Sem
-- mensagem, sem telefone ou "não contatar": entra assim mesmo, com a linha
-- 'pulado'. Respondeu há pouco / recebeu mensagem há pouco: espera (não entra).
CREATE FUNCTION private.cobranca_regua_candidatos(p_org uuid, p_agora timestamptz)
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

REVOKE ALL ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_regua_candidatos(uuid, timestamptz) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Planejar: grava a entrada e move o card
-- ─────────────────────────────────────────────────────────────────────────

-- Compromisso quebrado: o card volta para a coluna do atraso atual (ou para a
-- configurada em "volta para") e, se a entrada daquela coluna ainda não
-- aconteceu nesta dívida, ganha a mensagem dela — como se tivesse entrado
-- pela régua. Já recebida: só volta, sem repetir.
DROP FUNCTION private.cobranca_regua_quebrar_compromissos(uuid, date);
CREATE FUNCTION private.cobranca_regua_quebrar_compromissos(p_org uuid, p_hoje date, p_quando timestamptz)
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

REVOKE ALL ON FUNCTION private.cobranca_regua_quebrar_compromissos(uuid, date, timestamptz) FROM PUBLIC, anon, authenticated;

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
    v_quando := COALESCE(private.cobranca_proxima_janela(v_org.janela, v_org.timezone, p_agora), p_agora);

    v_quebra := v_quebra + private.cobranca_regua_quebrar_compromissos(
      v_org.organization_id, (p_agora AT TIME ZONE v_org.timezone)::date, v_quando);

    FOR c IN SELECT * FROM private.cobranca_regua_candidatos(v_org.organization_id, p_agora) LOOP
      INSERT INTO public.cobranca_regua_envios
        (organization_id, caso_id, inadimplente_id, passo_id, etapa_id, gatilho, dias, referencia,
         status, motivo, agendado_para, criado_por)
      VALUES
        (v_org.organization_id, c.caso_id, c.inadimplente_id, c.passo_id, c.etapa_id, c.gatilho, c.dias,
         c.referencia, c.status, c.motivo, v_quando, NULL)
      ON CONFLICT (caso_id, gatilho, dias, referencia) WHERE gatilho <> 'entrada_manual' DO NOTHING;
      IF FOUND THEN
        v_novos := v_novos + 1;
        IF c.mover_para IS NOT NULL
           AND private.cobranca_regua_mover(c.caso_id, c.mover_para,
                 jsonb_build_object('motivo', 'coluna', 'dias', c.dias)) THEN
          v_moves := v_moves + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('envios_criados', v_novos, 'etapas_movidas', v_moves, 'compromissos_quebrados', v_quebra);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Reservar: a mensagem vem da coluna (atraso e manual) ou do passo (lembrete)
-- ─────────────────────────────────────────────────────────────────────────

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
  v_org     record;
  v_env     public.cobranca_regua_envios%ROWTYPE;
  v_motivo  text;
  v_inst    uuid;
  v_tel     text;
  v_msg     text;
  v_perdido record;
  v_n       integer := 0;
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

    LOOP
      -- Movimento à mão primeiro (alguém está esperando); depois o mais atrasado.
      SELECT * INTO v_env FROM public.cobranca_regua_envios en
       WHERE en.organization_id = v_org.organization_id AND en.status = 'pendente'
         AND en.agendado_para <= p_agora
       ORDER BY (en.gatilho = 'entrada_manual') DESC, en.dias DESC, en.agendado_para, en.created_at, en.id
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
               WHEN v_env.gatilho IN ('atraso', 'entrada_manual')
                    AND v_env.etapa_id IS DISTINCT FROM c.etapa_id THEN 'saiu_da_coluna'
               WHEN v_env.gatilho = 'atraso' AND EXISTS (
                      SELECT 1 FROM public.cobranca_etapas e2
                       WHERE e2.id = v_env.etapa_id AND NOT e2.automacao_ativa) THEN 'automacao_desligada'
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
       WHERE c.id = v_env.caso_id;
      IF NOT FOUND THEN
        v_motivo := 'caso_encerrado';
      END IF;

      v_msg := NULL;
      IF v_env.gatilho = 'lembrete_compromisso' THEN
        SELECT p.mensagem INTO v_msg FROM public.cobranca_regua_passos p WHERE p.id = v_env.passo_id AND p.ativo;
      ELSE
        SELECT e.mensagem INTO v_msg FROM public.cobranca_etapas e WHERE e.id = v_env.etapa_id;
      END IF;
      IF v_motivo IS NULL AND v_msg IS NULL THEN
        v_motivo := 'sem_mensagem';
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

-- Conclusão: o evento diz de onde veio (coluna, movimento à mão, lembrete).
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
                         'dias', v_env.dias, 'etapa_id', v_env.etapa_id, 'autor', v_env.criado_por,
                         'texto', left(p_texto, 1000)));
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
    jsonb_build_object('envio_id', p_envio, 'gatilho', v_env.gatilho, 'etapa_id', v_env.etapa_id,
                       'motivo', CASE WHEN p_resultado = 'sem_whatsapp' THEN 'sem_whatsapp' ELSE 'erro_no_envio' END,
                       'erro', left(p_erro, 300)));
  RETURN 'falhou';
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Mover à mão, com "Mover e enviar"
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.cobranca_caso_mover(uuid, uuid, double precision);

-- p_enviar: a pessoa confirmou "Mover e enviar" na prévia. O envio entra na
-- fila da régua (horário, teto, não contatar, número sem WhatsApp valem) — uma
-- mensagem por coluna por dia por caso. Devolve o que aconteceu com o envio.
CREATE FUNCTION public.cobranca_caso_mover(
  p_caso uuid, p_etapa uuid, p_posicao double precision DEFAULT NULL, p_enviar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso   public.cobranca_casos%ROWTYPE;
  v_etapa  public.cobranca_etapas%ROWTYPE;
  v_inad   public.cobranca_inadimplentes%ROWTYPE;
  v_tz     text;
  v_envio  text := NULL;
  v_status text;
  v_motivo text;
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

    IF p_enviar AND v_etapa.mensagem IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.cobranca_regua r
                      WHERE r.organization_id = v_caso.organization_id AND r.ativa)
         OR private.cobranca_regua_instancia(v_caso.organization_id) IS NULL THEN
        v_envio := 'regua_desligada';
      ELSE
        SELECT * INTO v_inad FROM public.cobranca_inadimplentes WHERE id = v_caso.inadimplente_id;
        SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_caso.organization_id;
        v_status := CASE WHEN v_inad.telefone IS NULL OR v_inad.nao_contatar THEN 'pulado' ELSE 'pendente' END;
        v_motivo := CASE WHEN v_inad.telefone IS NULL THEN 'sem_telefone'
                         WHEN v_inad.nao_contatar THEN 'nao_contatar' END;
        INSERT INTO public.cobranca_regua_envios
          (organization_id, caso_id, inadimplente_id, etapa_id, gatilho, dias, referencia, status, motivo, agendado_para)
        VALUES
          (v_caso.organization_id, p_caso, v_caso.inadimplente_id, p_etapa, 'entrada_manual',
           COALESCE(v_etapa.entrada_dias, 0), (now() AT TIME ZONE v_tz)::date, v_status, v_motivo, now())
        ON CONFLICT (caso_id, etapa_id, referencia) WHERE gatilho = 'entrada_manual' DO NOTHING;
        v_envio := CASE WHEN NOT FOUND THEN 'ja_enviado_hoje'
                        WHEN v_status = 'pendente' THEN 'na_fila'
                        ELSE v_motivo END;
      END IF;
    END IF;
    RETURN jsonb_build_object('caso_id', p_caso, 'envio', v_envio);
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
  RETURN jsonb_build_object('caso_id', p_caso, 'envio', NULL);
END
$fn$;

-- O que "Mover e enviar" mandaria, sem gravar nada: o texto da coluna, as
-- variáveis do caso (as mesmas do worker) e o que impediria o envio. A tela
-- renderiza com o renderizador gêmeo da edge: a prévia não mente.
CREATE FUNCTION public.cobranca_caso_previa_envio(p_caso uuid, p_etapa uuid, p_agora timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_etapa public.cobranca_etapas%ROWTYPE;
  v_inad  public.cobranca_inadimplentes%ROWTYPE;
  v_cfg   record;
  v_hoje  date;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'view');
  SELECT * INTO v_etapa FROM public.cobranca_etapas WHERE id = p_etapa AND organization_id = v_caso.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'etapa_nao_encontrada';
  END IF;
  IF v_etapa.mensagem IS NULL OR v_etapa.papel <> 'aberta' THEN
    RETURN jsonb_build_object('mensagem', NULL);
  END IF;

  SELECT * INTO v_inad FROM public.cobranca_inadimplentes WHERE id = v_caso.inadimplente_id;
  SELECT r.organization_id AS configurada, COALESCE(r.ativa, false) AS ativa, r.janela, r.teto_diario, o.timezone
    INTO v_cfg
    FROM public.organizations o
    LEFT JOIN public.cobranca_regua r ON r.organization_id = o.id
   WHERE o.id = v_caso.organization_id;
  v_hoje := (p_agora AT TIME ZONE v_cfg.timezone)::date;

  RETURN jsonb_build_object(
    'mensagem', v_etapa.mensagem,
    'variaveis', private.cobranca_regua_variaveis(p_caso, 'entrada_manual', v_hoje, p_agora),
    'bloqueio', CASE
       WHEN v_caso.encerrado_em IS NOT NULL THEN 'caso_encerrado'
       WHEN NOT v_cfg.ativa OR private.cobranca_regua_instancia(v_caso.organization_id) IS NULL THEN 'regua_desligada'
       WHEN v_inad.nao_contatar THEN 'nao_contatar'
       WHEN v_inad.telefone IS NULL THEN 'sem_telefone'
       WHEN EXISTS (SELECT 1 FROM public.cobranca_regua_envios en
                     WHERE en.caso_id = p_caso AND en.etapa_id = p_etapa AND en.gatilho = 'entrada_manual'
                       AND en.referencia = v_hoje) THEN 'ja_enviado_hoje'
     END,
    'na_janela', v_cfg.configurada IS NOT NULL AND private.cobranca_na_janela(v_cfg.janela, v_cfg.timezone, p_agora),
    'proxima_janela', CASE WHEN v_cfg.configurada IS NOT NULL
                           THEN private.cobranca_proxima_janela(v_cfg.janela, v_cfg.timezone, p_agora) END,
    'teto_atingido', v_cfg.configurada IS NOT NULL AND (
       SELECT count(*) FROM public.cobranca_regua_envios en
        WHERE en.organization_id = v_caso.organization_id AND en.status = 'enviado'
          AND (en.enviado_em AT TIME ZONE v_cfg.timezone)::date = v_hoje) >= v_cfg.teto_diario);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Editar colunas (tela da régua)
-- ─────────────────────────────────────────────────────────────────────────

-- p_etapa NULL = nova coluna de dias (entrada_dias obrigatório). Editar: nome,
-- entrada_dias, mensagem, automacao_ativa. Desfecho não tem automação.
CREATE FUNCTION public.cobranca_coluna_salvar(p_org uuid, p_etapa uuid, p_dados jsonb)
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

-- Só coluna de dias e só vazia: as outras carregam o significado do fluxo.
CREATE FUNCTION public.cobranca_coluna_remover(p_etapa uuid)
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

-- Passos agora são só lembretes de promessa/parcela.
CREATE OR REPLACE FUNCTION public.cobranca_regua_passo_salvar(p_org uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id    uuid;
  v_dias  int;
  v_msg   text := NULLIF(btrim(COALESCE(p_dados ->> 'mensagem', '')), '');
  v_ativo boolean := COALESCE((p_dados ->> 'ativo')::boolean, true);
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_regua_semear(p_org);

  IF COALESCE(p_dados ->> 'gatilho', 'lembrete_compromisso') <> 'lembrete_compromisso' THEN
    RAISE EXCEPTION 'Dias de atraso agora são colunas do fluxo.' USING ERRCODE = 'PT422', DETAIL = 'use_colunas';
  END IF;
  BEGIN
    v_dias := (p_dados ->> 'dias')::int;
  EXCEPTION WHEN OTHERS THEN
    v_dias := NULL;
  END;
  IF v_dias IS NULL OR v_dias NOT BETWEEN 0 AND 7 THEN
    RAISE EXCEPTION 'Lembrete de 0 a 7 dias antes.' USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END IF;
  IF v_msg IS NULL OR length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'Lembrete precisa de mensagem (até 1.000 caracteres).' USING ERRCODE = 'PT422', DETAIL = 'lembrete_invalido';
  END IF;

  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.cobranca_regua_passos (organization_id, gatilho, dias, mensagem, ativo)
      VALUES (p_org, 'lembrete_compromisso', v_dias, v_msg, v_ativo)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.cobranca_regua_passos SET dias = v_dias, mensagem = v_msg, ativo = v_ativo
       WHERE id = p_id AND organization_id = p_org AND gatilho = 'lembrete_compromisso'
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'Lembrete não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'passo_inexistente';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um lembrete nesse dia.' USING ERRCODE = 'PT409', DETAIL = 'passo_duplicado';
  END;
  RETURN v_id;
END
$fn$;

-- Prévia: a mensagem da entrada vem da coluna.
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
               'mover_para', c.mover_para, 'etapa_nome', e.nome,
               'mensagem', COALESCE(p.mensagem, e.mensagem),
               'variaveis', private.cobranca_regua_variaveis(c.caso_id, c.gatilho, c.referencia, p_agora))
             ORDER BY c.gatilho, c.dias DESC, i.nome)
        FROM private.cobranca_regua_candidatos(p_org, p_agora) c
        JOIN public.cobranca_inadimplentes i ON i.id = c.inadimplente_id
        LEFT JOIN public.cobranca_regua_passos p ON p.id = c.passo_id
        LEFT JOIN public.cobranca_etapas e ON e.id = c.etapa_id), '[]'::jsonb));
END
$fn$;

-- Ativar exige ao menos uma mensagem ligada (coluna ou lembrete).
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
    IF NOT EXISTS (SELECT 1 FROM public.cobranca_etapas
                    WHERE organization_id = p_org AND automacao_ativa AND mensagem IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.cobranca_regua_passos
                        WHERE organization_id = p_org AND ativo AND mensagem IS NOT NULL) THEN
      RAISE EXCEPTION 'Nenhuma coluna nem lembrete tem mensagem ligada.'
        USING ERRCODE = 'PT422', DETAIL = 'sem_passos';
    END IF;
  ELSE
    UPDATE public.cobranca_regua_envios SET status = 'cancelado', motivo = 'regua_desligada'
     WHERE organization_id = p_org AND status = 'pendente';
  END IF;

  UPDATE public.cobranca_regua SET ativa = p_ativa, updated_at = now(), updated_by = auth.uid()
   WHERE organization_id = p_org;
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10. Grants
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION private.cobranca_rotulo_de_dias(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_cor_de_dias(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_etapas_reordenar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_colunas_migrar(uuid) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cobranca_caso_mover(uuid, uuid, double precision, boolean)',
    'public.cobranca_caso_previa_envio(uuid, uuid, timestamptz)',
    'public.cobranca_coluna_salvar(uuid, uuid, jsonb)',
    'public.cobranca_coluna_remover(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. Migra quem já tem a área
-- ─────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  v_org uuid;
BEGIN
  FOR v_org IN SELECT DISTINCT organization_id FROM public.cobranca_etapas LOOP
    PERFORM private.cobranca_colunas_migrar(v_org);
  END LOOP;
END
$do$;

COMMIT;
