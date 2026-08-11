-- 20270811120000_inv5_public_tables_readable_by_anon.sql
--
-- INV-5 — nenhuma tabela de `public` pode ser legível por `anon`/`authenticated`
-- sem RLS. Detector + varredura agendada contra o banco vivo.
-- ROLLBACK pareado: rollback/20270811120000_inv5_public_tables_readable_by_anon.sql
--
-- O DEFEITO
-- ---------
-- Seis tabelas `_bkp_%` nasceram à mão em produção (`CREATE TABLE AS` no editor
-- de SQL, em duas intervenções distintas) e ficaram legíveis por `anon` — a
-- chave publicável que vai no bundle do front. Uma guardava `uazapi_token`,
-- credencial viva de envio de WhatsApp; as outras guardavam telefone,
-- `lead_id` e conteúdo de mensagem. Foi a TERCEIRA vez que esta mesma classe
-- de defeito apareceu neste banco.
--
-- A CAUSA — e ela não é a que estava escrita no repositório
-- --------------------------------------------------------
-- Não é "herda o GRANT do schema public". Schema GRANT não desce para tabela.
-- É `ALTER DEFAULT PRIVILEGES`, que o próprio Supabase instala:
--
--   public | postgres       | r | anon=rxtm/postgres
--   public | supabase_admin | r | anon=arwdDxtm/supabase_admin
--
-- Toda tabela criada em `public` NASCE com SELECT para `anon`. Não existe passo
-- errado a evitar: o default é inseguro, e disciplina humana não fecha isso —
-- só detecção fecha.
--
-- O mesmo vale para FUNÇÃO (`f | anon=X/postgres`), e é por isso que os
-- `REVOKE` abaixo são explícitos por role: `REVOKE FROM PUBLIC` sozinho NÃO
-- remove um privilégio concedido diretamente a `anon` pelo default privilege.
--
-- POR QUE O INV-3 NÃO PEGOU
-- -------------------------
--   (a) `_rls_inv_org_tables_without_rls()` só olha tabela COM coluna
--       `organization_id`; três das seis não têm, inclusive as duas maiores.
--   (b) INV-3 testa só `relrowsecurity`. Quem expõe é GRANT **e** RLS
--       desligada — é conjunção, e o predicado abaixo testa a conjunção.
--   (c) A suíte pgTAP roda contra um banco montado de `supabase/migrations/*`.
--       Objeto criado à mão em produção nunca existe lá. É por isso que esta
--       migration entrega DUAS coisas: o detector (que o teste exercita) e a
--       varredura agendada, que roda o MESMO detector contra o banco vivo. Só
--       o teste seria teatro para este achado — ele nunca veria as seis.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- ----------------------------
-- Não revoga nada, não apaga nada, não mexe em tabela de dado. O destino das
-- seis `_bkp_%` é decisão do CTO e caminho separado; aqui só nasce o detector.
-- Consequência: no dia 1 em produção a primeira varredura provavelmente ACHA
-- violação — e isso é o comportamento certo, não um defeito da migration.

-- ---------------------------------------------------------------------------
-- 1. O detector
--
-- `SECURITY INVOKER` de propósito: ler `pg_class` e `has_table_privilege` não
-- exige privilégio nenhum, então não há razão para a função carregar poder. O
-- `pg_cron` a executa como o dono do job, e o `service_role` como ele mesmo.
--
-- `relkind = 'r'` — só tabela ordinária. VIEW não tem RLS própria (herda a das
-- tabelas de base) e tabela particionada ('p') não guarda linha. Se um dia uma
-- partição exposta aparecer, é ampliação deliberada do predicado, com teste
-- junto, não um `IN ('r','p')` silencioso.
--
-- Uma linha por (tabela, grantee): saber que `anon` lê é diferente de saber que
-- só `authenticated` lê — a primeira é vazamento para a internet, a segunda é
-- travessia entre organizações. O alarme não deve colapsar as duas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_public_tables_readable_by_anon()
RETURNS TABLE (
  schemaname name,
  tablename  name,
  grantee    text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
  SELECT
    n.nspname AS schemaname,
    c.relname AS tablename,
    g.grantee
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated')) AS g(grantee)
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
    AND has_table_privilege(g.grantee, c.oid, 'SELECT')
  ORDER BY c.relname, g.grantee
$fn$;

COMMENT ON FUNCTION public.inv_public_tables_readable_by_anon() IS
  'INV-5: tabelas de public legíveis por anon/authenticated SEM RLS. Conjunção: GRANT de SELECT E relrowsecurity=false. Desligar qualquer um dos dois limpa a violação. Exercitado por supabase/tests/inv5_public_tables_readable_by_anon_test.sql e varrido 1x/dia por inv_scan_public_tables_readable_by_anon().';

REVOKE ALL ON FUNCTION public.inv_public_tables_readable_by_anon() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_public_tables_readable_by_anon() FROM anon;
REVOKE ALL ON FUNCTION public.inv_public_tables_readable_by_anon() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.inv_public_tables_readable_by_anon() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. A varredura — o que o cron chama
--
-- Escreve em `runtime_logs` SÓ quando acha violação. Silêncio é o estado
-- normal: um alarme que fala todo dia deixa de ser lido, e aí a próxima
-- intervenção manual passa igual às três anteriores.
--
-- UMA linha por passada, não uma por tabela: o incidente é "a superfície
-- exposta mudou", não "esta tabela". O detalhe vai no payload, com as tabelas
-- nomeadas — alarme que não diz QUAL tabela obriga quem lê a refazer a
-- varredura à mão.
--
-- O array vai limitado a 50 tabelas para o payload não crescer sem teto; o
-- `total` continua sendo a contagem REAL, para que truncar a lista nunca
-- pareça um número menor de violações.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_scan_public_tables_readable_by_anon()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE
  v_violacoes jsonb;
  v_total     int;
BEGIN
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('tabela', t.tablename, 'grantees', t.grantees)
                       ORDER BY t.tablename)
             FILTER (WHERE t.rn <= 50), '[]'::jsonb),
    count(*)::int
    INTO v_violacoes, v_total
  FROM (
    SELECT
      v.tablename,
      jsonb_agg(v.grantee ORDER BY v.grantee) AS grantees,
      row_number() OVER (ORDER BY v.tablename) AS rn
    FROM public.inv_public_tables_readable_by_anon() v
    GROUP BY v.tablename
  ) t;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'total', 0);
  END IF;

  INSERT INTO public.runtime_logs
    (organization_id, module, action, status, entity_type, payload_snapshot)
  VALUES
    (NULL,                                    -- a superfície exposta do banco
                                              -- não pertence a tenant nenhum
     'seguranca',
     'inv5_tabela_publica_legivel_por_anon',
     'error',                                 -- é vazamento de dado, não
                                              -- informação de rotina
     'tabela',
     jsonb_build_object(
       'total', v_total,
       'violacoes', v_violacoes,
       'truncado', v_total > 50,
       'invariante', 'INV-5',
       'remediacao', 'ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY; ou REVOKE SELECT ON public.<t> FROM anon, authenticated;'
     ));

  RETURN jsonb_build_object('ok', false, 'total', v_total, 'violacoes', v_violacoes);
END
$fn$;

COMMENT ON FUNCTION public.inv_scan_public_tables_readable_by_anon() IS
  'INV-5 contra o banco VIVO: roda o detector e escreve UMA linha em runtime_logs (module=seguranca, status=error) quando acha violação. Silêncio = limpo. Agendado em cron.job como inv5-public-tables-readable-by-anon.';

REVOKE ALL ON FUNCTION public.inv_scan_public_tables_readable_by_anon() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inv_scan_public_tables_readable_by_anon() FROM anon;
REVOKE ALL ON FUNCTION public.inv_scan_public_tables_readable_by_anon() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.inv_scan_public_tables_readable_by_anon() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. A agenda
--
-- 1x/dia. A janela de exposição que importa aqui se mede em dias, não em
-- minutos: as seis tabelas ficaram expostas por semanas sem ninguém saber. Um
-- cron de minuto em minuto custaria varredura de catálogo o dia inteiro para
-- encurtar uma janela que já é ordens de grandeza menor que o problema.
--
-- 04:17 — de madrugada, e num minuto quebrado de propósito, para não competir
-- com os jobs que rodam na virada da hora.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  -- Idempotente: `unschedule` antes de `schedule`, para o arquivo sobreviver a
  -- `db reset`, que reaplica as migrations num banco onde o job pode já existir.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inv5-public-tables-readable-by-anon') THEN
    PERFORM cron.unschedule('inv5-public-tables-readable-by-anon');
  END IF;

  PERFORM cron.schedule(
    'inv5-public-tables-readable-by-anon',
    '17 4 * * *',
    $scan$SELECT public.inv_scan_public_tables_readable_by_anon()$scan$
  );
END
$cron$;
