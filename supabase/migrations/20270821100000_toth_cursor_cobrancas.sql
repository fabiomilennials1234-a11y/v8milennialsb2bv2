-- 20270821100000_toth_cursor_cobrancas.sql
--
-- Cursor de retomada da sincronização de cobranças do Toth.
--
-- `/cobrancas` é consultado por CNPJ, um lote de clientes por vez, com teto por
-- execução (`MAX_CLIENTS_PER_RUN`). Sem cursor, toda execução varria os MESMOS
-- primeiros clientes: na Café Jurerê, 600 de 12.609 ficaram cobertos e os
-- cliques seguintes reprocessavam os mesmos 600. O `truncated: true` no retorno
-- avisava do corte, mas não havia como avançar.
--
-- Guarda o id do último `upsell_clients` processado. A execução seguinte começa
-- depois dele; ao completar a volta, o cursor volta a NULL e o ciclo recomeça —
-- o que também serve de atualização periódica, já que título muda de status com
-- o tempo.
--
-- ⚠️ Já aplicada em prod em 2026-08-21 via MCP (autorização do CTO). A versão
-- gravada no ledger é `toth_cursor_cobrancas`, não este prefixo — mesmo drift
-- registrado para as outras migrations do Toth.
ALTER TABLE public.toth_connections
  ADD COLUMN IF NOT EXISTS cobrancas_cursor UUID;

COMMENT ON COLUMN public.toth_connections.cobrancas_cursor IS
  'Id do último upsell_client processado na sincronização de cobranças. NULL = começar do início.';
