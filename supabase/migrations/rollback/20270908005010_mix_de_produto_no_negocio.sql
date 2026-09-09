-- Rollback do C2 (20270908005010).
--
-- Apaga só os itens que a migration criou — a procedência em `notes` é o que
-- torna isto possível. Item criado por gente na tela do negócio não tem o
-- prefixo e não é tocado.
--
-- ⚠️ ORDEM IMPORTA. `trg_deal_items_sync_value` reescreve `deals.value` a cada
-- DELETE, então apagar com ele ligado zeraria o valor dos 36 negócios criados
-- pela migration e mexeria na receita — exatamente o que a migration se
-- esforçou para NÃO fazer. O trigger é desligado durante a limpeza.
--
-- Os 36 negócios criados (`source = 'entrada_materializada'`) NÃO são apagados:
-- podem ter recebido atividade depois. Ficam identificáveis por essa
-- procedência, para uma decisão à parte.
BEGIN;

SELECT count(*) AS itens_a_remover
FROM public.deal_items WHERE notes LIKE 'migrado:proposta:%';

ALTER TABLE public.deal_items DISABLE TRIGGER trg_deal_items_sync_value;
DELETE FROM public.deal_items WHERE notes LIKE 'migrado:proposta:%';
ALTER TABLE public.deal_items ENABLE TRIGGER trg_deal_items_sync_value;

COMMIT;
