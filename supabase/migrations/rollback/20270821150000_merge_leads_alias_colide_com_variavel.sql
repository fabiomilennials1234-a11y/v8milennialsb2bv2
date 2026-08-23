-- ===========================================================================
-- ROLLBACK — 20270821150000_merge_leads_alias_colide_com_variavel.sql
-- ===========================================================================
-- ⚠ Este rollback REINTRODUZ um defeito conhecido: com o alias `r`, plpgsql
-- resolve `r.id` para a VARIÁVEL do laço, não para a CTE, e `merge_leads` morre
-- com 42703 ("record r has no field id") em toda chamada. A tela /duplicados
-- volta a não conseguir mesclar nada.
--
-- Só existe porque migration sem rollback pareado não passa na revisão. Se o
-- motivo de reverter for outro (perf, comportamento inesperado do dedupe),
-- prefira uma migration nova que corrija o que apareceu.
--
-- A restauração é o corpo do baseline, palavra por palavra. Copiar de
-- `20260101000000_baseline_prod_schema.sql`, função `merge_leads`, trocando de
-- volta `FROM ranked rk / we.id = rk.id / rk.rn > 1` por `r`.
-- ===========================================================================

-- Sem corpo: reverter é reaplicar o baseline da função. O procedimento está
-- acima, e é deliberado que exija a mão de alguém — reverter para um defeito
-- conhecido não deve ser um `psql -f` distraído.
DO $$
BEGIN
  RAISE EXCEPTION
    'Rollback manual: veja o cabeçalho deste arquivo. Reverter reintroduz o 42703 de merge_leads.';
END
$$;
