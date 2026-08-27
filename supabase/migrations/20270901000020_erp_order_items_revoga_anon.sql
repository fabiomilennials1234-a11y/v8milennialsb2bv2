-- 20270901000020_erp_order_items_revoga_anon.sql
--
-- Fecha `anon` e a escrita de `authenticated` em `erp_order_items`.
--
-- ## O que aconteceu
--
-- A `20270901000010` criou a tabela concedendo exatamente dois grants:
--
--   GRANT SELECT ON TABLE public.erp_order_items TO authenticated;
--   GRANT ALL    ON TABLE public.erp_order_items TO service_role;
--
-- Medido em prod logo após o apply, o que o banco entregou foi outra coisa:
--
--   anon           → REFERENCES, SELECT, TRIGGER
--   authenticated  → DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- 🔴 **`ALTER DEFAULT PRIVILEGES` do projeto concede em TODA tabela nova do
-- schema `public`**, e o grant do banco chega junto com o `CREATE TABLE` — não
-- é o SQL da migration que decide. É a mesma armadilha que a rubric de segurança
-- documenta para FUNÇÃO (`EXECUTE` que chega por PUBLIC e por default privilege),
-- e ela vale igual para TABELA. Escrever o `GRANT` certo não basta: é preciso
-- **revogar o que não foi pedido, e conferir**.
--
-- ## Havia brecha aberta?
--
-- Não em regime normal, e isto é defesa em profundidade, não incidente:
--
--   • a RLS está ligada e as duas policies são `FOR SELECT TO authenticated`.
--     Sem policy de escrita, `INSERT`/`UPDATE`/`DELETE` de `authenticated` é
--     negado pela RLS mesmo com o grant;
--   • `anon` não tem policy nenhuma, então o `SELECT` dele voltaria vazio.
--
-- O que o grant faz é deixar a porta destrancada atrás da RLS: no dia em que
-- alguém acrescentar uma policy `FOR ALL` para dar escrita a um caso legítimo,
-- ela passa a valer para todo mundo que já tem o grant — e ninguém vai
-- reexaminar um `GRANT` de meses atrás ao escrever a policy.
--
-- Item de pedido do ERP **não é editável no CRM** por decisão: editá-lo criaria
-- divergência silenciosa com o financeiro do cliente. Quem escreve é a
-- sincronização, com `service_role`.

REVOKE ALL ON TABLE public.erp_order_items FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.erp_order_items FROM authenticated;

-- Confirmação para quem for auditar (o resultado esperado, medido em prod):
--
--   authenticated → SELECT
--   service_role  → ALL
--   anon          → (ausente)
--
--   SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'erp_order_items'
--    GROUP BY grantee;
