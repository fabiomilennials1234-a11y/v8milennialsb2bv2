-- 20270919000010_lead_guarda_o_codigo_do_erp.sql
--
-- `leads` passa a guardar o código do cliente no ERP, para que as telas de lead
-- (lista, kanban do funil, ficha, cabeçalho do chat) mostrem "1234 - João da
-- Silva" como a Carteira mostra.
--
-- Por que uma coluna e não um join: o código só existe hoje em
-- `upsell_clients.external_id`, e a ponte é `upsell_clients.lead_id`. Buscar o
-- código por join em cada superfície de lead custaria uma consulta a mais em
-- telas que já paginam milhares de linhas — e várias delas são servidas por RPC
-- com projeção fixa, o que multiplicaria migrations. A coluna espelha um dado
-- que muda quando o cliente muda de cadastro no ERP, ou seja: praticamente
-- nunca.
--
-- 🔴 O `name` do lead continua limpo. A composição "código - nome" é de
-- exibição (`src/shared/format/erp-code.ts`) — `{{nome}}` do disparo e a
-- saudação do Copilot leem `leads.name` e não podem passar a dizer
-- "Olá 1234 - João da Silva".
--
-- Nullable de propósito e sem default: lead sem ERP não tem código, e é
-- justamente o NULL que faz o rótulo degradar para o nome puro.
--
-- Sem backfill aqui, por desenho (guarda F4: migration é só schema). Quem
-- preenche os leads já existentes é `scripts/backfill-lead-erp-code.sql`, passo
-- separado e idempotente. A sincronização do ERP carimba os leads que nascerem
-- daqui pra frente.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS erp_code TEXT;

COMMENT ON COLUMN public.leads.erp_code IS
  'Código do cliente no ERP de origem — espelho de upsell_clients.external_id. Exibição apenas (ver src/shared/format/erp-code.ts); NUNCA compor dentro de leads.name, sob pena de vazar em {{nome}} de disparo e na saudação do Copilot.';
