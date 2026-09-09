-- 20270901000010_erp_pedidos_itens.sql
--
-- Os itens do pedido vindo do ERP, e a situação crua do pedido.
--
-- ## Por que existe
--
-- O fornecedor do Toth entregou o retorno de `/pedidos` em 25/08/2026 — com
-- **itens dentro de cada pedido**:
--
--   { "numeropedido": "19400", "dataemissao": "...", "numeroinscricao": "...",
--     "valortotalliquido": 884.4, "statuspedido": "NORMAL",
--     "itens": [ { "codigoproduto": "3686", "descricaoproduto": "DRIP COFFEE…",
--                  "qtdpedido": 6, "valorunitario": 19.9 }, … ] }
--
-- `upsell_orders` guarda UM produto por pedido (`product_name`), o que serve
-- para venda de projeto e não para distribuidora de café: o pedido 19400 tem
-- quatro SKUs e a pergunta comercial é justamente **quais** — quem comprava o
-- grão 250g e parou, quem nunca provou a linha Gerações, o que entra num
-- combo. Sem tabela de item, essa informação chega pela API e é descartada.
--
-- ⚠️ Não é uso especulativo de tabela: quem escreve aqui é `toth-sync-pedidos`,
-- na mesma passada em que grava o pedido. A superfície de leitura (mix de
-- produtos na ficha do cliente) vem depois — e é por isso que o item é gravado
-- desde a primeira sincronização: a página do ERP não volta, e o que não for
-- capturado agora exigiria varrer o histórico inteiro de novo.
--
-- ## `erp_status` em `upsell_orders`
--
-- 🔴 É o campo que decide o que conta como receita. O Toth devolve `NORMAL`
-- (emitido, não faturado) junto com `FATURADO`, e a Carteira soma pedido
-- aprovado. `approvalForErpStatus` mapeia FATURADO → `approved` e o resto →
-- `pending`; a coluna guarda o valor **cru**, para que quem auditar o número
-- veja o que o ERP disse, não a nossa tradução.

-- ─────────────────────────────────────────────────────────────────────────────
-- Situação do pedido no ERP
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS erp_status TEXT;

COMMENT ON COLUMN public.upsell_orders.erp_status IS
  'Situação do pedido no ERP, CRUA (Toth: NORMAL, FATURADO). Não traduzir: approval_status já carrega a tradução, e é a comparação entre os dois que explica por que uma venda conta ou não.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cursor da sincronização de pedidos
-- ─────────────────────────────────────────────────────────────────────────────

-- `/pedidos` é o PRIMEIRO endpoint paginado do Toth (`{data, page, hasNext}`).
-- O cursor é número de página e precisa atravessar execuções: o teto por
-- execução existe para não martelar o servidor do cliente, e sem cursor cada
-- rodada recomeçaria da página 1 e a volta nunca fecharia.
ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS pedidos_cursor INTEGER,
  ADD COLUMN IF NOT EXISTS last_pedidos_sync_at TIMESTAMPTZ;

COMMENT ON COLUMN public.toth_connections.pedidos_cursor IS
  'Página em que a próxima sincronização de pedidos retoma. NULL ou 1 recomeça do início — o que é desejado ao fim de cada volta, porque pedido muda de situação (NORMAL vira FATURADO).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Itens do pedido
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.erp_order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id            uuid NOT NULL REFERENCES public.upsell_orders(id) ON DELETE CASCADE,
  external_source     text NOT NULL,
  -- Posição na resposta do ERP. Dá identidade a duas linhas do mesmo produto no
  -- mesmo pedido — que acontece quando o preço difere entre elas.
  line_no             integer NOT NULL,
  product_external_id text,
  description         text NOT NULL DEFAULT '',
  quantity            numeric(14,4) NOT NULL DEFAULT 0,
  unit_value          numeric(14,4) NOT NULL DEFAULT 0,
  total_value         numeric(14,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_order_items_line_unique UNIQUE (order_id, line_no)
);

COMMENT ON TABLE public.erp_order_items IS
  'Linhas de pedido trazidas de um ERP (Toth: /pedidos → itens[]). Escrita por substituição — a sincronização apaga e regrava os itens do pedido, porque item removido na edição não pode sobreviver a um upsert por chave.';
COMMENT ON COLUMN public.erp_order_items.product_external_id IS
  'Código do produto NO ERP. Chave para casar com o catálogo (Toth: POST /estoque devolve 748 produtos com idProduto) quando houver sincronização de produtos.';
COMMENT ON COLUMN public.erp_order_items.total_value IS
  'Total da linha. Vem do ERP quando ele manda; senão é quantidade × unitário arredondado a 2 casas — 6 × 19.9 em ponto flutuante dá 119.39999999999999.';

-- "Quem comprou este produto" e "os itens deste pedido" são as duas leituras.
CREATE INDEX IF NOT EXISTS idx_erp_order_items_order
  ON public.erp_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_erp_order_items_org_product
  ON public.erp_order_items (organization_id, product_external_id)
  WHERE product_external_id IS NOT NULL;

CREATE TRIGGER trg_erp_order_items_updated_at
  BEFORE UPDATE ON public.erp_order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — espelha titulos_receber, que é a outra tabela de dado vindo de ERP
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.erp_order_items ENABLE ROW LEVEL SECURITY;

-- Leitura por membro da organização. `get_my_organization_ids()` é SECURITY
-- DEFINER e bypassa RLS de propósito: subquery inline em `team_members` dentro
-- de policy causa recursão infinita quando o Realtime avalia `apply_rls()`.
CREATE POLICY "erp_order_items_member_select" ON public.erp_order_items
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Master lê em qualquer org. Espelha master_select_all_titulos_receber: o escopo
-- por organização continua sendo feito pela query da aplicação.
CREATE POLICY "master_select_all_erp_order_items" ON public.erp_order_items
  FOR SELECT TO authenticated
  USING ((SELECT public.is_master_user()));

-- Escrita é só da sincronização (service_role). Não há policy de INSERT/UPDATE
-- para `authenticated`: item de pedido do ERP não é editável no CRM — editá-lo
-- criaria divergência silenciosa com o financeiro do cliente.

GRANT SELECT ON TABLE public.erp_order_items TO authenticated;
GRANT ALL    ON TABLE public.erp_order_items TO service_role;
