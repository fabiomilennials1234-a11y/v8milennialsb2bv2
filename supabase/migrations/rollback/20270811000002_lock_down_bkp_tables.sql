-- ROLLBACK de 20270811000002_lock_down_bkp_tables.sql
--
-- ATENÇÃO — REVERTER ISTO REABRE DADO DE CLIENTE PARA A INTERNET.
--
-- A migration original fechou 12 tabelas de backup no schema `public` que
-- estavam legíveis por `anon` (a chave pública que vai no bundle do frontend) e
-- deletáveis/trucáveis por qualquer usuário autenticado de qualquer organização.
-- Entre elas, `_bkp_c7e4ba84_secrets`, com um `uazapi_token` vivo, e
-- `_bkp_c7e4ba84_summary`, com conteúdo de mensagem.
--
-- Este arquivo existe porque a convenção do repositório é que toda migration
-- tenha par em `rollback/` — não porque reverter seja uma operação desejável.
-- NÃO EXISTE cenário legítimo conhecido para rodar isto.
--
-- O que ele NÃO faz, de propósito: não devolve o GRANT para `anon` nem para
-- `authenticated`. Um rollback que reabre o vazamento seria uma arma apontada
-- para o próprio pé. Ele apenas desliga a RLS, que é a metade reversível da
-- operação, e só para as tabelas que não tinham RLS antes.
--
-- As cinco tabelas fechadas ANTES desta migration (as 3 da faxina de 27/07 em
-- `20270730000002`, mais `_backup_bertin_20260608_pipe_entries` e
-- `_backup_merge_agendamentos_milennials`, fechadas em
-- `archive/20270205000000_fix_rls_disabled_errors.sql`) já tinham RLS ligada e
-- NÃO devem ser tocadas — por isso a lista aqui é explícita, e não um laço sobre
-- o padrão de nome.
--
-- Se o objetivo for restaurar o histórico da Goletric Perdizes a partir destes
-- backups, NÃO É PRECISO REVERTER NADA: `service_role` e `postgres` continuam
-- com SELECT e ambos ignoram RLS (`BYPASSRLS` no primeiro, propriedade da tabela
-- no segundo, já que não foi usado FORCE ROW LEVEL SECURITY). O caminho de
-- recuperação está intacto.

ALTER TABLE public._bkp_c7e4ba84_instance  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_c7e4ba84_messages  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_c7e4ba84_secrets   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_c7e4ba84_summary   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_c7e4ba84_workflows DISABLE ROW LEVEL SECURITY;
ALTER TABLE public._bkp_lid_principal      DISABLE ROW LEVEL SECURITY;
