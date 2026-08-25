-- 20270901000000_erp_ultima_compra_e_marcas.sql
--
-- A data da última compra do cliente no ERP, e as duas chaves de recorte que o
-- fornecedor do Toth destravou em 21-24/08/2026.
--
-- ## Por que existe
--
-- 🔑 **`diasCompras` não é ignorado pelo ERP — ele só funciona acompanhado de
-- `marcas`.** Medido contra o servidor real em 25/08:
--
--   | chamada                              | linhas |
--   |--------------------------------------|--------|
--   | sem filtro                           | 12.632 |
--   | `marcas=1,2,3,4,5,6`                 |  6.493 |
--   | `marcas=1,2,3,4,5,6&diasCompras=60`  |    550 |
--   | `diasCompras=60` **sem** `marcas`    | 12.633 |
--
-- A conclusão de 21/08 ("o ERP ignora `diasCompras`") descrevia corretamente o
-- que foi medido — a janela tinha sido testada sozinha — e generalizava errado.
-- Por isso `clientes_marcas` existe: sem ela, a janela de cliente ativo que a
-- tela oferece é decorativa, e a carteira recebe a base inteira.
--
-- O fornecedor também passou a devolver, em 24/08,
-- **`dataEmissaoUltimoPedidoFaturado`** (`aaaa-mm-dd`) em `GET /clientes` — 40%
-- da base tem, 78% dentro do recorte de marcas. As duas coisas não são a mesma:
-- `diasCompras` filtra por **pedido**, e o campo diz quando saiu o último pedido
-- **faturado**. É por isso que 131 dos 550 da janela de 60 dias vêm sem data:
-- pediram e ainda não faturaram.
--
-- A data é o que faz a carteira funcionar antes de existir endpoint de pedidos:
-- `calculate-portfolio-health` deriva dias sem pedido, ciclo de recompra e saúde
-- a partir de `last_order_at`, e aceita a data semeada quando não há linha de
-- pedido (é o mesmo caminho do import por CSV).
--
-- ## Só schema
--
-- Guarda F4: nenhum backfill de dado de cliente aqui. Quem preenche
-- `erp_last_order_at` é a próxima sincronização.

-- ─────────────────────────────────────────────────────────────────────────────
-- Cliente da carteira: a data que o ERP conhece
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS erp_last_order_at DATE;

COMMENT ON COLUMN public.upsell_clients.erp_last_order_at IS
  'Data do último pedido FATURADO do cliente segundo o ERP (Toth: dataEmissaoUltimoPedidoFaturado). Espelho do ERP, escrito só pela sincronização — não confundir com last_order_at, que é a métrica da carteira e pode vir de pedido registrado no CRM.';

-- "Quem não compra há N dias" é a leitura que a janela de cliente ativo faz, e
-- ela chega sempre com organization_id.
CREATE INDEX IF NOT EXISTS idx_upsell_clients_org_erp_last_order
  ON public.upsell_clients (organization_id, erp_last_order_at DESC)
  WHERE erp_last_order_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Conexão do Toth: marcas, e o recorte estrito de quem já comprou
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS clientes_marcas TEXT
    CHECK (clientes_marcas IS NULL OR clientes_marcas ~ '^[0-9]+(,[0-9]+)*$'),
  ADD COLUMN IF NOT EXISTS clientes_somente_com_compra BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.toth_connections.clientes_marcas IS
  'Códigos de marca repassados ao ERP no parâmetro `marcas` (ex.: "1,2,3,4,5,6"). É a chave que ATIVA o filtro `diasCompras`: sem ela o ERP devolve a base inteira, com ela a janela de dias passa a valer. A Café Jurerê tem 6 marcas e a última nasceu em 2020 — a lista é estável. NULL = não mandar o parâmetro.';
COMMENT ON COLUMN public.toth_connections.clientes_somente_com_compra IS
  'TRUE deixa de fora quem não tem dataEmissaoUltimoPedidoFaturado — ou seja, quem nunca faturou nada. Default FALSE de propósito: dentro da janela do ERP existem clientes que pediram e ainda não faturaram (131 dos 550 na medição de 25/08), e esses são carteira legítima.';
