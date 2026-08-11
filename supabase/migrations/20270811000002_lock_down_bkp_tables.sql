-- 20270811000002_lock_down_bkp_tables.sql
--
-- Fecha as tabelas de backup criadas À MÃO no schema `public` de produção.
--
-- APLICADA EM PRODUÇÃO EM 2026-08-11, com autorização do CTO. Este arquivo traz
-- a mudança ao repositório e alinha o ledger — não é migration "a aplicar".
--
-- ─── O MECANISMO ────────────────────────────────────────────────────────────
--
-- NÃO é "herança de GRANT do schema", como a nota anterior deste repositório
-- dizia. A causa é `ALTER DEFAULT PRIVILEGES`, medido no banco:
--
--   public | postgres       | r | anon=rxtm/postgres
--   public | supabase_admin | r | anon=arwdDxtm/supabase_admin
--
-- Ou seja: TODA tabela criada por `postgres` em `public` NASCE com privilégio
-- para `anon` e `authenticated`, qualquer que seja o comando. Não é o
-- `CREATE TABLE AS` que causa — é criar tabela em `public` como `postgres`.
--
-- ─── O QUE ESTAVA EXPOSTO (medido em 2026-08-11) ────────────────────────────
--
-- Seis tabelas, RLS desligada, zero policies, ~38.312 linhas:
--
--   _bkp_c7e4ba84_secrets      1 linha  — uazapi_token VIVO (credencial de envio)
--   _bkp_c7e4ba84_messages    20.424    — remote_jid (telefone)
--   _bkp_lid_principal        16.869    — phone_number, normalized_phone, lead_id
--   _bkp_c7e4ba84_summary      1.014    — last_message (CONTEÚDO de mensagem)
--   _bkp_c7e4ba84_instance         1    — telefone, provider_config
--   _bkp_c7e4ba84_workflows        3    — definition
--
-- Legíveis por `anon` — a chave pública que vai no bundle do frontend, sem
-- login. E DELETÁVEIS e TRUNCÁVEIS por qualquer usuário autenticado de
-- qualquer organização: a exposição não era só de leitura, era de destruição.
--
-- ─── POR QUE NÃO SÃO APAGADAS ───────────────────────────────────────────────
--
-- São o backup manual da exclusão da instância WhatsApp da Goletric Perdizes
-- (06/08, o delete que estourou statement timeout 8×). Verificado em produção:
-- a instância `c7e4ba84-...` e suas mensagens JÁ NÃO EXISTEM nas tabelas vivas,
-- e `whatsapp_conversation_summary` não tem linha apontando para o UUID morto.
-- Logo estes backups são a ÚNICA cópia daquele histórico. Se a Goletric pedir a
-- conversa de volta, é daqui que sai. O problema é a exposição, não o dado.
--
-- ─── O LAÇO É GENÉRICO DE PROPÓSITO ─────────────────────────────────────────
--
-- AS TRÊS CONVENÇÕES: este banco nomeia backup de três jeitos — `_bkp_*`,
-- `_backup_*` e `backup_*` (esta sem underscore inicial). O predicado cobre as
-- três, e `relkind IN ('r','p','m')` impede que backup feito como matview ou
-- tabela particionada passe reto.
--
-- A primeira versão cobria só `_bkp_%` + relkind 'r'. Medido: deixava
-- `_backup_bertin_20260608_pipe_entries` e `_backup_merge_agendamentos_milennials`
-- COM privilégio para anon e authenticated. As duas têm RLS ligada com zero
-- policy, então a RLS já barrava as linhas e não havia vazamento ativo — mas
-- ficavam com UMA camada onde as outras dez têm duas. Achado pela revisão.
--
-- Cobre as 12 e qualquer backup que nasça depois pelo mesmo caminho. Em
-- banco novo (`supabase db reset`, CI) não há o que casar e o bloco é no-op —
-- estas tabelas nunca existiram em migration nenhuma.
--
-- O gate que impede a PRÓXIMA vez é o INV-5, em fatia separada: nem o INV-3 nem
-- nada da suíte pegava isto, por três motivos medidos — o detector só olha
-- tabela COM `organization_id`, ele testa `relrowsecurity` quando quem expõe é
-- GRANT + RLS off, e sobretudo a suíte roda contra banco montado a partir de
-- `supabase/migrations/`, onde objeto criado à mão em prod nunca existe.

DO $$
DECLARE
  r RECORD;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'm')
       AND c.relname ~ '^_?b(kp|ackup)_'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', r.tbl);

    -- matview não aceita RLS; só tabela (ordinária ou particionada).
    IF (SELECT c2.relkind FROM pg_class c2 WHERE c2.oid = r.tbl) IN ('r', 'p') THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', r.tbl);
    END IF;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'tabelas de backup fechadas (3 convenções): %', v_n;
END $$;
