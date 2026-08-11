-- 20270811160000_payment_history_receipt_period_method.sql
--
-- SCRUM-289 (parte 2) — as três faltas de `payment_history` que o protótipo da
-- área de billing do admin (#1390) expôs e que dependem SÓ do nosso schema.
--
-- 1. RECIBO/FATURA. O Asaas devolve `invoiceUrl` e `transactionReceiptUrl` em
--    toda cobrança e ninguém persistia nenhum dos dois. O botão "Baixar" da
--    tela não tinha para onde apontar — não por falta de tela, por falta de
--    coluna. São DUAS colunas porque são dois documentos diferentes: a fatura
--    existe desde a emissão (e serve para pagar), o recibo só existe depois da
--    liquidação (e serve para provar que pagou).
--
-- 2. PERÍODO. Sem ele, "Referente a" não é derivável em ciclo semestral ou
--    anual: `paid_at` diz QUANDO pagou, não O QUE cobriu. Uma anuidade paga em
--    janeiro cobre janeiro-a-dezembro, e a tela não tinha como saber.
--
-- 3. FORMA DE PAGAMENTO por linha. Sem ela não dá para dizer se aquela linha
--    foi Pix ou cartão — e a resposta não está em `billing_cycle`, que é outra
--    dimensão.
--
-- ESCOPO: só schema. Preencher as colunas é do lado de quem escreve a linha
-- (ingestão do Asaas), e hoje NÃO EXISTE escritor de `payment_history` no
-- repositório — `grep` em `src/` e `supabase/functions/` não acha nenhum. As
-- linhas de produção vieram por outro caminho. Portanto: colunas NULLABLE, sem
-- backfill, sem default inventado. Linha antiga fica com NULO, que é a verdade
-- — não sabemos a forma de pagamento do que já passou, e fingir que sabemos
-- seria pior que a lacuna.
--
-- RLS: `payment_history` já tem RLS ligada e duas policies
-- (`payment_history_all_service_or_master` e `payment_history_select_own`).
-- Adicionar coluna não mexe em nenhuma das duas. ⚠️ Registrado e NÃO tocado
-- aqui: `payment_history_select_own` usa `get_my_organization_ids()`, ou seja
-- QUALQUER membro da organização lê a vida financeira da empresa. Isso é
-- decisão pendente do CTO na SCRUM-291 — este arquivo não conserta e também
-- não constrói em cima como se estivesse certo.

ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS billing_type text;

COMMENT ON COLUMN public.payment_history.invoice_url IS
  'Asaas `invoiceUrl`: a fatura, existe desde a emissão e serve para pagar. NULO em linha anterior à SCRUM-289.';

COMMENT ON COLUMN public.payment_history.receipt_url IS
  'Asaas `transactionReceiptUrl`: o recibo, só existe depois da liquidação e serve para provar o pagamento. NULO enquanto não liquidado.';

COMMENT ON COLUMN public.payment_history.period_start IS
  'Primeiro dia do período coberto por esta cobrança. Com period_end, é o que torna "Referente a" derivável em ciclo semestral/anual — paid_at diz quando pagou, não o que cobriu.';

COMMENT ON COLUMN public.payment_history.period_end IS
  'Último dia coberto (inclusivo).';

COMMENT ON COLUMN public.payment_history.billing_type IS
  'Forma de pagamento desta linha, no vocabulário do Asaas. Dimensão diferente de billing_cycle. NULO quando desconhecida.';

-- Período é intervalo, e intervalo invertido é dado corrompido que só aparece
-- na tela do cliente. O CHECK aceita NULO nos dois (linha antiga) e aceita
-- período de um dia só (start = end).
ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_period_order_check;

ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_period_order_check
  CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start);

-- Vocabulário FECHADO, com os valores que o Asaas documenta. Fechado porque
-- string livre aqui vira "pix", "PIX", "Pix" e "pix_qr" na mesma coluna, e a
-- tela passa a decidir no `switch` o que o banco devia ter garantido.
-- O custo consciente: valor novo do Asaas derruba a INGESTÃO em vez de gravar
-- lixo. É o lado certo para errar — a linha rejeitada aparece no erro; a linha
-- com valor desconhecido gravado aparece meses depois, num relatório errado.
ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_billing_type_check;

ALTER TABLE public.payment_history
  ADD CONSTRAINT payment_history_billing_type_check
  CHECK (billing_type IS NULL OR billing_type IN (
    'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'DEPOSIT', 'UNDEFINED'
  ));
