-- 20280120020000_cobranca_entrada_no_vencimento.sql
--
-- Cobrança · "no dia do vencimento": a coluna entra com 0 dias de atraso.
-- ROLLBACK pareado: rollback/20280120020000_cobranca_entrada_no_vencimento.sql
--
-- Pedido: ao cadastrar um inadimplente, ele cai sozinho na coluna do atraso dele
-- e a mensagem sai sozinha. Com 1+ dias isso já era assim (o cron coloca na
-- maior coluna vencida). Faltava o título que vence HOJE: a coluna de dias
-- exigia 1..365 e, para o caso que nasce na coluna de entrada, a régua só
-- andava "para a frente".
--
--  · entrada_dias aceita 0..365 (0 = no dia do vencimento);
--  · a régua também atende o caso que está NA coluna de 0 dias e que ninguém
--    moveu (nenhum evento etapa_alterada): grava a entrada (uma vez, mesma
--    chave de idempotência) e a mensagem sai pela fila normal (janela, teto,
--    não contatar). "Só mover" à mão ou voltar o card não reenvia;
--  · a coluna de entrada só aceita 0 dias (ligar/desligar o envio no vencimento).

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.cobranca_etapas DROP CONSTRAINT cobranca_etapas_entrada_dias_check;
ALTER TABLE public.cobranca_etapas
  ADD CONSTRAINT cobranca_etapas_entrada_dias_check CHECK (entrada_dias BETWEEN 0 AND 365);

CREATE OR REPLACE FUNCTION private.cobranca_rotulo_de_dias(p_dias integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_dias = 0 THEN 'No dia do vencimento'
              WHEN p_dias = 1 THEN '1 dia de atraso'
              ELSE p_dias || ' dias de atraso' END;
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
    SELECT c.id AS caso_id, c.inadimplente_id, c.etapa_id, e.posicao AS etapa_posicao, e.papel, e.pausa_regua,
           i.telefone, i.nao_contatar, s.venc, COALESCE(s.saldo, 0) AS saldo, COALESCE(s.n_titulos, 0) AS n_titulos,
           EXISTS (SELECT 1 FROM public.cobranca_compromissos co
                    WHERE co.caso_id = c.id AND co.status = 'ativo') AS tem_compromisso,
           EXISTS (SELECT 1 FROM public.cobranca_eventos ev
                    WHERE ev.caso_id = c.id AND ev.tipo = 'etapa_alterada') AS ja_movido,
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
        SELECT min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS venc, sum(ts.saldo) AS saldo,
               count(*) FILTER (WHERE ts.saldo > 0) AS n_titulos
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
           AND (e.trilha = 'unico' OR ca.n_titulos >= 2)
         ORDER BY (e.trilha = CASE WHEN ca.n_titulos >= 2 THEN 'multiplos' ELSE 'unico' END) DESC,
                  e.entrada_dias DESC
         LIMIT 1
      ) t
     WHERE ca.papel = 'aberta' AND NOT ca.pausa_regua AND NOT ca.tem_compromisso
       AND ca.saldo > 0 AND ca.venc IS NOT NULL
       -- Só para a frente. Exceção: o caso que ainda está na coluna de entrada dele e
       -- ninguém moveu (cadastro novo) recebe a mensagem da própria coluna — é o
       -- "no dia do vencimento" (0 dias). "Só mover" à mão conta como movido.
       AND (t.posicao > ca.etapa_posicao OR (t.id = ca.etapa_id AND NOT ca.ja_movido))
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
  v_manual boolean := COALESCE((p_dados ->> 'manual')::boolean, false);
  v_trilha text := NULLIF(btrim(COALESCE(p_dados ->> 'trilha', '')), '');
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  PERFORM private.cobranca_semear_etapas(p_org);

  BEGIN
    v_dias := NULLIF(p_dados ->> 'entrada_dias', '')::integer;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Dias de atraso inválidos.' USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END;
  IF v_dias IS NOT NULL AND v_dias NOT BETWEEN 0 AND 365 THEN
    RAISE EXCEPTION 'Dias de atraso de 0 a 365.' USING ERRCODE = 'PT422', DETAIL = 'dias_invalidos';
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 2000 THEN
    RAISE EXCEPTION 'A mensagem passa de 2.000 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'mensagem_longa';
  END IF;
  IF v_trilha IS NOT NULL AND v_trilha NOT IN ('unico', 'multiplos') THEN
    RAISE EXCEPTION 'Tipo de caso inválido.' USING ERRCODE = 'PT422', DETAIL = 'trilha_invalida';
  END IF;
  IF v_manual AND (v_dias IS NOT NULL OR v_trilha = 'multiplos') THEN
    RAISE EXCEPTION 'Coluna manual não tem dias de atraso.' USING ERRCODE = 'PT422', DETAIL = 'manual_sem_dias';
  END IF;
  IF v_trilha = 'multiplos' AND v_dias IS NULL AND (p_etapa IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.cobranca_etapas WHERE id = p_etapa AND entrada_dias IS NOT NULL)) THEN
    RAISE EXCEPTION '2 ou mais títulos só vale em coluna com dias de atraso.' USING ERRCODE = 'PT422', DETAIL = 'trilha_sem_dias';
  END IF;
  IF v_nome IS NOT NULL AND length(v_nome) > 60 THEN
    RAISE EXCEPTION 'Nome até 60 caracteres.' USING ERRCODE = 'PT422', DETAIL = 'nome_longo';
  END IF;

  BEGIN
    IF p_etapa IS NULL AND v_manual THEN
      IF v_nome IS NULL THEN
        RAISE EXCEPTION 'Coluna manual precisa de um nome.' USING ERRCODE = 'PT422', DETAIL = 'nome_obrigatorio';
      END IF;
      -- Fora do ritmo da régua: só envia quando alguém move o card e confirma.
      INSERT INTO public.cobranca_etapas
        (organization_id, nome, posicao, papel, cor, pausa_regua, mensagem, personalizada)
      VALUES
        (p_org, v_nome,
         40000 + (SELECT count(*) FROM public.cobranca_etapas WHERE organization_id = p_org),
         'aberta', '#94a3b8', true, v_msg, true)
      RETURNING id INTO v_id;
    ELSIF p_etapa IS NULL THEN
      IF v_dias IS NULL THEN
        RAISE EXCEPTION 'Coluna nova precisa dos dias de atraso em que o caso entra.'
          USING ERRCODE = 'PT422', DETAIL = 'dias_obrigatorios';
      END IF;
      INSERT INTO public.cobranca_etapas
        (organization_id, nome, posicao, papel, cor, pausa_regua, entrada_dias, mensagem, automacao_ativa, trilha)
      VALUES
        (p_org, COALESCE(v_nome, private.cobranca_rotulo_de_dias(v_dias)), 30000 + v_dias, 'aberta',
         private.cobranca_cor_de_dias(v_dias), false, v_dias, v_msg,
         COALESCE((p_dados ->> 'automacao_ativa')::boolean, true), COALESCE(v_trilha, 'unico'))
      RETURNING id INTO v_id;
    ELSE
      SELECT * INTO v_atual FROM public.cobranca_etapas WHERE id = p_etapa AND organization_id = p_org;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Coluna não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'coluna_inexistente';
      END IF;
      -- Coluna de entrada (sem dias, sem pausa): só pode entrar com 0 dias (no vencimento).
      IF v_atual.entrada_dias IS NULL AND NOT v_atual.pausa_regua AND v_atual.papel = 'aberta'
         AND v_dias IS NOT NULL AND v_dias <> 0 THEN
        RAISE EXCEPTION 'A coluna de entrada só pode enviar no dia do vencimento (0 dias).'
          USING ERRCODE = 'PT422', DETAIL = 'entrada_so_no_vencimento';
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
             automacao_ativa = COALESCE((p_dados ->> 'automacao_ativa')::boolean, automacao_ativa),
             trilha = COALESCE(v_trilha, trilha)
       WHERE id = p_etapa
      RETURNING id INTO v_id;
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Valores fora do permitido para esta coluna.' USING ERRCODE = 'PT422', DETAIL = 'coluna_invalida';
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma coluna com esse nome ou com esses dias de atraso.'
      USING ERRCODE = 'PT409', DETAIL = 'coluna_duplicada';
  END;

  PERFORM private.cobranca_etapas_reordenar(p_org);
  RETURN v_id;
END
$fn$;

COMMIT;
