-- Rollback de 20270918000030_o_cabecalho_do_funil_le_o_desfecho.sql
--
-- ⚠️ Só role isto se a parte 2 (20270918000040) NÃO estiver aplicada.
--
-- Esta migration é a que ensina o cabeçalho do funil, o gráfico de jornada e a
-- coorte a perguntar o desfecho ao negócio. Derrubá-la com as etapas já sem
-- papel deixa os três sem fonte nenhuma: o cabeçalho volta a somar zero
-- vendidos em 107 orgs, que é precisamente o acidente que a ordem das duas
-- partes existe para evitar.
--
-- A guarda abaixo recusa nesse caso.
--
-- Recuperar as versões anteriores de `get_funnel_flow`,
-- `_metric_leaf_coorte_etapa` e `seed_default_sales_funnel` exige o corpo
-- vigente antes desta migration — este arquivo derruba apenas o que nasceu
-- aqui e restaura `system_stage_role`, que é curto e autocontido.

DO $$
DECLARE v_sem_papel integer;
BEGIN
  SELECT count(*) INTO v_sem_papel FROM public.pipeline_stages
   WHERE pipeline_type IN ('propostas','confirmacao')
     AND stage_key IN ('vendido','perdido')
     AND stage_role = 'open';
  IF v_sem_papel > 0 THEN
    RAISE EXCEPTION 'a parte 2 parece aplicada (% etapa(s) de sistema sem papel) — reverter esta migration deixaria o cabecalho do funil somando zero. Rode antes o rollback da 20270918000040.', v_sem_papel;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_funil_desfecho_counts(uuid, uuid, timestamptz, timestamptz);
