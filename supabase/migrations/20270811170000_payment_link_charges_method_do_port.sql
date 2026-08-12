-- 20270811170000_payment_link_charges_method_do_port.sql
--
-- CORREÇÃO da 20270811140000 (SCRUM-286): `payment_link_charges.method`
-- aceitava `boleto`, método que este produto NÃO VENDE.
--
-- O VOCABULÁRIO TEM DONO, E NÃO É ESTA TABELA
-- -------------------------------------------
-- `PaymentMethod` em `supabase/functions/_shared/payments/types.ts` é
-- `"pix" | "credit_card"`. A policy em `payments/policy.ts` mapeia só esses
-- dois. E `billing_quote_price` recusa qualquer outro. O CHECK da tabela era a
-- TERCEIRA cópia da mesma regra, e foi onde ela divergiu — que é exatamente o
-- que se espera de uma terceira cópia.
--
-- O efeito prático do defeito: a tabela aceitaria registrar cobrança de um
-- método que ninguém sabe precificar nem cobrar. Pior, o teste da fatia
-- PROVAVA a idempotência por par usando justamente esse método fantasma — a
-- prova estava verde e falava de um mundo que não existe.
--
-- Achado ao conferir uma pergunta do Malho sobre vocabulário de CICLO. O
-- defeito estava no vocabulário de MÉTODO, ao lado.
--
-- POR QUE MIGRATION NOVA E NÃO EDIÇÃO DA 140000
-- --------------------------------------------
-- A 140000 já está na `main`, e não há como saber daqui se já foi aplicada em
-- produção — o apply é botão do CTO. Migration aplicada é imutável, então
-- editá-la só seria seguro sob uma certeza que não tenho. Esta funciona nos
-- dois mundos: se a 140000 ainda não rodou, as duas aplicam em sequência e o
-- estado final é o mesmo.
--
-- SEM RISCO DE DADO: `payment_link_charges` nasceu na mesma leva e está vazia.
-- Se um dia não estiver, o DROP + ADD abaixo falha ALTO na linha que violar —
-- que é o comportamento certo, e não um `NOT VALID` que esconderia cobrança
-- órfã de um método inexistente.

ALTER TABLE public.payment_link_charges
  DROP CONSTRAINT IF EXISTS payment_link_charges_method_check;

ALTER TABLE public.payment_link_charges
  ADD CONSTRAINT payment_link_charges_method_check
  CHECK (method IN ('pix', 'credit_card'));

COMMENT ON COLUMN public.payment_link_charges.method IS
  'Vocabulário do PORT (_shared/payments/types.ts: PaymentMethod = pix | credit_card). Não acrescente valor aqui sem acrescentar no port, na policy e no motor de preço — este CHECK é cópia, e cópia que anda sozinha diverge.';
