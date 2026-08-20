-- 20270820100000_toth_janela_cliente_ativo.sql
--
-- Janela que define "cliente ativo" para a carga da carteira.
--
-- O ERP da Café Jurerê tem 12.605 clientes, quase todos histórico. Importar
-- todos polui a carteira em vez de ajudar: o vendedor abre a tela e encontra
-- doze mil nomes, a maioria sem relevância comercial. `diasCompras` é o
-- parâmetro que o próprio fornecedor expõe para recortar quem comprou no
-- período, e é o que transforma "todo mundo que já comprou" em carteira.
--
-- Fica na conexão, e não no corpo da requisição, porque é decisão de negócio da
-- organização: precisa valer igual no botão da tela e no cron que rodar depois.
-- NULL = sem recorte (traz a base inteira).
--
-- ⚠️ Já aplicada em prod em 2026-08-20 via MCP (autorização do CTO). O nome da
-- versão no ledger é `toth_janela_cliente_ativo`, não este prefixo — mesmo drift
-- registrado para a migration de fundação.
ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS clientes_dias_compras INTEGER
    CHECK (clientes_dias_compras IS NULL OR clientes_dias_compras > 0);

COMMENT ON COLUMN public.toth_connections.clientes_dias_compras IS
  'Janela em dias para considerar um cliente ativo na sincronização de carteira. Vira o parâmetro diasCompras do ERP. NULL traz a base inteira.';
