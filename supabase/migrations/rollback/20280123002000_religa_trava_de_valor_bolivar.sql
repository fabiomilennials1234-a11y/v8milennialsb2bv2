-- Rollback de 20280123002000: a Bolivar volta a poder ganhar negócio sem valor.
UPDATE public.rollout_exige_valor_venda
   SET religado_em = NULL
 WHERE organization_id = 'e8508dc0-8eeb-47c2-9317-ee460daf8591'
   AND religado_em IS NOT NULL;
