-- ===========================================================================
-- ROLLBACK — 20270821160000_metric_stage_snapshot_degrada_e_rotula.sql
-- ===========================================================================
-- ⚠ Reverter REINTRODUZ duas regressões conhecidas, medidas por
-- `supabase/tests/tv_s2_stage_label_scope_test.sql` (9 asserções de 13):
--
--   * `etapa` sem funil escolhido volta a devolver SÉRIE misturando etapas de
--     funis diferentes, sem sinalizar degradação — a tela passa a dizer
--     "por Etapa / N" sobre um número que não existe em lugar nenhum;
--   * o rótulo volta a ser a chave crua: "novo" e "compareceu" na parede, em
--     vez de "Novo Lead" e "Compareceu".
--
-- Se o motivo de reverter for outro (perf, comportamento inesperado da
-- degradação), prefira uma migration nova que corrija o que apareceu.
--
-- Para reverter mesmo assim: reaplicar o corpo de
-- `20270813100000_metric_negocio_semantica.sql`, seção 3.
-- ===========================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'Rollback manual: veja o cabeçalho. Reverter reintroduz o rótulo cru e a série que mistura funis.';
END
$$;
