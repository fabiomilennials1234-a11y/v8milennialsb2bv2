-- rollback/20270904000010_desfecho_pela_ui.sql
--
-- Remove a porta do humano. Os botões do card param de funcionar (a chamada
-- responde "function does not exist"), e a tela precisa voltar a mover o card
-- para a etapa terminal.
--
-- ⚠ Desfechos JÁ decididos pela tela permanecem: estão em `deals.outcome`, e os
-- eventos que eles geraram estão no caderno, que é append-only. Este arquivo
-- fecha a porta, não desfaz o que passou por ela.
--
-- Para ver o que entrou por aqui antes de decidir:
--
--   SELECT o.name, d.id, d.title, d.outcome, d.outcome_at
--     FROM deals d JOIN organizations o ON o.id = d.organization_id
--    WHERE d.outcome_source = 'ui';

DROP FUNCTION IF EXISTS public.definir_desfecho_da_entrada(uuid, text, text);
