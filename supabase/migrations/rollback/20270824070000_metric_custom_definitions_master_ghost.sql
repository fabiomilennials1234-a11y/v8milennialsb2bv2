-- ROLLBACK de 20270824070000_metric_custom_definitions_master_ghost.sql
--
-- Devolve `metric_custom_definitions` ao isolamento de tenant puro: só admin de
-- equipe ativo escreve, e só membro da org lê.
--
-- CONSEQUÊNCIA CONHECIDA de rodar isto: master volta a não conseguir criar nem
-- LISTAR métrica personalizada, e o botão de compor volta a aparecer para ele
-- (o guarda do front usa o team member VIRTUAL, que diz role='admin'). O erro
-- "new row violates row-level security policy" reaparece.

DROP POLICY IF EXISTS master_ghost_all_metric_custom_definitions
  ON public.metric_custom_definitions;
