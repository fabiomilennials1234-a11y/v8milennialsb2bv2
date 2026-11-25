-- 20280127000000_cobranca_mensagem_por_titulo.sql
--
-- Cobrança · a mensagem da régua lista os títulos em aberto, um a um.
-- ROLLBACK pareado: rollback/20280127000000_cobranca_mensagem_por_titulo.sql
--
-- Pedido de cliente (25/11): a mensagem mostrava {vencimento} (o MAIS ANTIGO)
-- e {valor} (a SOMA). Devedor com dois títulos lia uma data só e o total — e
-- o cliente quer "Dados dos documentos" com o vencimento e o valor de cada um.
--
--  · As variáveis ganham `lista_titulos`: os títulos com saldo, do vencimento
--    mais antigo para o mais novo, [{vencimento, valor (= saldo), numero}].
--    O texto é montado na edge (_shared/cobranca-regua-mensagem.ts) e na
--    prévia da tela (gêmeo): a linha com {titulo_vencimento}, {titulo_valor}
--    ou {titulo_numero} se repete para cada item.
--  · No máximo 20 itens: a mensagem não vira um extrato. {titulos} segue com
--    a contagem TOTAL, e o texto fecha com "E mais N títulos em aberto.".
--  · Mesmos títulos que somam {valor} e contam {titulos} (saldo > 0).
--
-- Só troca o corpo de private.cobranca_regua_variaveis (mesma assinatura:
-- CREATE OR REPLACE mantém dono e ACL). Corpo anterior = o de
-- 20280118010000 (md5 do prosrc em prod 25/11: 9e5265b10e61d661bf2b7c4bf06fccdf).
--
-- Ordem de deploy: esta migration → edge cobranca-regua → front. A chave nova
-- é ignorada pela edge antiga; a edge antiga NÃO entende {titulo_*} (a linha
-- sairia "Vencimento:" sem a data), por isso o front que oferece as variáveis
-- vai por último.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION private.cobranca_regua_variaveis(p_caso uuid, p_gatilho text, p_referencia date, p_agora timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  WITH base AS (
    SELECT i.nome, o.name AS empresa, o.timezone, r.como_pagar, r.janela, r.prazo_dias_uteis,
           (p_agora AT TIME ZONE o.timezone)::date AS hoje,
           s.saldo, s.venc, s.titulos, l.lista
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
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('vencimento', x.vencimento, 'valor', x.saldo, 'numero', x.numero)
                         ORDER BY x.vencimento, x.numero NULLS LAST, x.id) AS lista
          FROM (SELECT ts.id, ts.vencimento, ts.saldo, ts.numero
                  FROM public.cobranca_titulos_saldo ts
                 WHERE ts.inadimplente_id = c.inadimplente_id AND ts.saldo > 0
                 ORDER BY ts.vencimento, ts.numero NULLS LAST, ts.id
                 LIMIT 20) x
      ) l ON true
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
    'lista_titulos',      COALESCE(b.lista, '[]'::jsonb),
    'como_pagar',         COALESCE(b.como_pagar, ''),
    'prazo_data',         private.cobranca_prazo(b.janela, b.timezone, p_agora, b.prazo_dias_uteis) ->> 'data',
    'prazo_horario',      private.cobranca_prazo(b.janela, b.timezone, p_agora, b.prazo_dias_uteis) ->> 'horario',
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

COMMIT;
