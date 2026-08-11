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
-- Toda tabela criada em `public` NASCE com SELECT para `anon`.
--
-- ================== NÃO MEXA NESSES DEFAULTS ==================
--
-- Ler o parágrafo acima como "então revogue o default" é o erro que este bloco
-- existe para impedir. Esses defaults são LOAD-BEARING: o PostgREST atende
-- `anon` e `authenticated` justamente porque essas roles têm GRANT de tabela, e
-- quem faz o portão é a RLS. Revogar o default global não conserta vazamento
-- nenhum — derruba o produto inteiro, toda leitura de toda tela.
--
-- Por isso o invariante NÃO é "tabela não deve ter GRANT para anon". É:
--
--   TODA TABELA EM `public` TEM QUE TER RLS LIGADA.
--
-- O GRANT é o estado normal e permanente; a RLS é o controle. INV-5 não é
-- remendo por falta de coisa melhor — é o ponto de imposição CORRETO, o único
-- lugar onde dá para exigir segurança sem quebrar o acesso de que o produto
-- depende. Quem vier "melhorar" isto mexendo em `ALTER DEFAULT PRIVILEGES`
-- daqui a seis meses vai derrubar o PostgREST e não vai entender por quê.
--
-- O detector aceita `REVOKE` como conserto (ver CONSERTO 2 no teste) porque
-- para uma tabela AVULSA — um backup manual que ninguém deveria ler — revogar é
-- legítimo e mais simples que inventar policy. O que não se faz é revogar no
-- DEFAULT, que atinge todas as tabelas futuras de uma vez.
-- ==============================================================
--
-- O mesmo default vale para FUNÇÃO (`f | anon=X/postgres`), e é por isso que os
-- `REVOKE` abaixo são explícitos por role: `REVOKE FROM PUBLIC` sozinho NÃO
-- remove um privilégio concedido diretamente a `anon` pelo default privilege.
-- Aqui revogar é certo e sem efeito colateral: função de auditoria não faz
-- parte da superfície que o PostgREST serve ao cliente.
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
-- Não revoga nada, não apaga nada, não mexe em tabela de dado. Aqui só nasce o
-- detector.
--
-- O QUE ESPERAR DA PRIMEIRA VARREDURA EM PRODUÇÃO: SILÊNCIO.
--
-- O saneamento já foi feito, antes desta migration e por caminho separado.
-- Produção tem hoje 12 tabelas de backup, TODAS com RLS ligada, ZERO privilégio
-- para `anon` e `authenticated`, e `service_role` alcançando. Então a primeira
-- passada do cron não deve escrever nada em `runtime_logs` — e silêncio é
-- resultado VÁLIDO, não sinal de alarme quebrado.
--
-- Se a primeira passada escrever alguma coisa, é achado de verdade: tabela que
-- ninguém tinha olhado, e não resíduo das que motivaram a fatia.
--
-- (O saneamento foi mais largo que o achado original: além das seis `_bkp_%`,
-- apareceram `_backup_bertin_20260608_pipe_entries` e
-- `_backup_merge_agendamentos_milennials` — este banco usa TRÊS convenções de
-- nome, `_bkp_*`, `_backup_*` e `backup_*`. Nada disso vira predicado aqui de
-- propósito: INV-5 não olha NOME. Um detector que casasse nome só acharia
-- backup batizado na convenção que alguém lembrou de seguir; o predicado é
-- estrutural — RLS desligada com GRANT vivo — e por isso pega a tabela que
-- ninguém pensou em chamar de backup.)

-- ---------------------------------------------------------------------------
-- 1. O detector
--
-- `SECURITY INVOKER` de propósito: ler `pg_class` e `has_table_privilege` não
-- exige privilégio nenhum, então não há razão para a função carregar poder. O
-- `pg_cron` a executa como o dono do job, e o `service_role` como ele mesmo.
--
-- `search_path` com `pg_catalog` ANTES de `public`, e aqui a ordem importa mais
-- que em outras funções da casa (o baseline costuma pôr `public` primeiro,
-- inclusive em SECURITY DEFINER). Esta função roda todo dia pelo cron, como o
-- dono do job — `postgres`, superusuário. Com `public` na frente, um objeto
-- criado em `public` que sombreasse `has_table_privilege` seria executado com
-- esse poder. Inverter custa zero: todas as referências aqui são qualificadas.
--
-- `relkind = 'r'` — só tabela ordinária, e esta linha é uma LIMITAÇÃO CONHECIDA,
-- não um descuido. VIEW não tem RLS própria (herda a das tabelas de base), mas
-- os outros dois casos são reais:
--
--   'p' (particionada)      — o pai não guarda linha, mas SELECT no pai lê as
--       partições. Pai sem RLS com GRANT vivo é vazamento de verdade, e este
--       predicado NÃO o vê.
--   'm' (matview)           — pior: matview NÃO ACEITA RLS. Não há `ENABLE ROW
--       LEVEL SECURITY` para ela. Se uma matview exposta aparecer, o único
--       conserto é `REVOKE` — então incluí-la aqui exigiria que o teste parasse
--       de tratar "ligar RLS" como conserto universal.
--   'f' (tabela estrangeira) — mesma forma da matview, e a mais alcançável das
--       três neste stack: a extensão Wrappers do Supabase cria foreign table, e
--       nada obriga que ela nasça fora de `public`.
--
-- Medido em 11/08: `public` tem 279 relações no schema deste repositório e 289
-- em produção — TODAS 'r' nos dois. Zero particionadas, zero matviews. Ampliar
-- agora seria escrever predicado para caso que não existe, e mudar o
-- significado de "conserto" no teste sem ter exemplo para exercitar.
--
-- E o escopo NÃO fica dependendo de alguém ler este comentário: o teste tem uma
-- asserção de PRECONDIÇÃO que exige que `public` não contenha relação fora do
-- escopo. Ela é escrita por NEGAÇÃO — enumera o que está DENTRO — para que
-- `relkind` que ainda não existe caia nela sem ninguém precisar editá-la. Uma
-- lista de exclusão só protege contra o que alguém lembrou de listar, e foi
-- assim que 'f' quase passou. Comentário envelhece; asserção não.
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
SET search_path TO 'pg_catalog', 'public'
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
-- pareça um número menor de violações. Quem precisar da lista inteira chama o
-- detector direto — `service_role` tem EXECUTE.
--
-- SOBRE O INSERT EM `runtime_logs`, e por que `SECURITY INVOKER` basta:
--   - `service_role` tem `GRANT ALL ON TABLE public.runtime_logs` (baseline:45705);
--   - `runtime_logs` tem RLS, e a policy `service_role_all_runtime_logs` é FOR
--     ALL com `USING (current_setting('role', true) = 'service_role')` e SEM
--     `WITH CHECK` — nesse caso o Postgres usa a USING COMO WITH CHECK no
--     INSERT. Pelo PostgREST o GUC casa, porque ele faz `SET LOCAL ROLE`.
--
-- ARMADILHA A REGISTRAR: numa conexão DIRETA como `service_role` (psql, pooler)
-- sem `SET ROLE`, `current_setting('role')` é `none`, a policy dá falso, e o
-- INSERT só passa porque `service_role` tem BYPASSRLS no Supabase. Se um dia
-- esse atributo sair da role, este caminho morre CALADO — o cron continua
-- rodando e o alarme para de registrar. Quem investigar isso no futuro começa
-- por aqui, e não por uma caça ao tesouro.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inv_scan_public_tables_readable_by_anon()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
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
