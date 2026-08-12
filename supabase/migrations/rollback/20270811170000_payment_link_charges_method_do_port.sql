-- Rollback de 20270811170000_payment_link_charges_method_do_port.sql
--
-- Devolve `boleto` ao CHECK. Não faça isso a menos que o produto passe a vender
-- boleto DE VERDADE — e nesse caso o lugar de começar é o port
-- (`_shared/payments/types.ts`), não esta constraint: o CHECK é a terceira
-- cópia da regra, e reabri-lo sozinho recria exatamente a divergência que a
-- migration original consertou.

ALTER TABLE public.payment_link_charges
  DROP CONSTRAINT IF EXISTS payment_link_charges_method_check;

ALTER TABLE public.payment_link_charges
  ADD CONSTRAINT payment_link_charges_method_check
  CHECK (method IN ('pix', 'boleto', 'credit_card'));
