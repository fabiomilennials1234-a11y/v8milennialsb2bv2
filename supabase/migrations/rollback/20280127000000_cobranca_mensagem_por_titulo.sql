-- ROLLBACK de 20280127000000_cobranca_mensagem_por_titulo.sql
--
-- Volta private.cobranca_regua_variaveis ao corpo de 20280118010000 (sem
-- `lista_titulos`; md5 do prosrc = 9e5265b10e61d661bf2b7c4bf06fccdf).
-- Rode DEPOIS de voltar o front e a edge: mensagem com {titulo_*} sem a lista
-- perde as linhas dos títulos.

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
