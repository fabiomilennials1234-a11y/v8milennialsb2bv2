-- rollback/20270903000020_etapa_exige_valor.sql
--
-- Remove a coluna `requires_sale_value` das duas tabelas de etapa.
--
-- ⚠ Rodar isto com o front da fatia 3 já em produção faz
-- `stageRequiresSaleValue` cair no ramo legado (`stage_role = 'won'` /
-- `is_final_positive`), que é o comportamento anterior à feature. Nenhuma tela
-- quebra: o campo simplesmente some do payload e o guard volta a exigir valor
-- só ao ganhar.
--
-- O que SE PERDE é a configuração: qualquer etapa que um admin tenha marcado
-- como "exige valor" fora das de ganho volta a não exigir, e a marcação não
-- volta se a coluna for recriada. Se a intenção for só desligar a exigência
-- sem descartar a configuração, prefira:
--
--   UPDATE public.pipeline_stages       SET requires_sale_value = false;
--   UPDATE public.custom_pipeline_stages SET requires_sale_value = false;

ALTER TABLE public.pipeline_stages        DROP COLUMN IF EXISTS requires_sale_value;
ALTER TABLE public.custom_pipeline_stages DROP COLUMN IF EXISTS requires_sale_value;
