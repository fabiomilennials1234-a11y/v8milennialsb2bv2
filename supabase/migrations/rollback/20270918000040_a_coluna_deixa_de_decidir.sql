-- Rollback de 20270918000040_a_coluna_deixa_de_decidir.sql
--
-- Devolve o papel de dinheiro às etapas de sistema. Com ele volta o gatilho:
-- arrastar o card para a coluna registra a venda de novo, e tirar de lá
-- reabre o negócio.
--
-- ⚠️ NÃO é simétrico, e não dá para ser.
--
-- 1. Só as etapas de SISTEMA voltam. O UPDATE original não guardou quais das
--    375 tinham papel — 249 perdas e 126 ganhos, muitas em funis custom com
--    chave própria. Reconstruir a lista exigiria adivinhar por nome, que é
--    exatamente o erro que o arco B veio corrigir (76 etapas classificadas
--    errado por nome). Antes recuperar pouco e certo do que muito e errado.
--
--    Para restaurar funil custom: o papel de cada etapa está no histórico do
--    `stage_role_reviewed_at` / na fila de revisão do master.
--
-- 2. Os negócios fechados no meio-tempo pelo botão NÃO são revertidos — nem
--    devem ser. Eles são a razão desta fatia existir.
--
-- 3. `system_stage_role` volta junto, senão a etapa nova nasce 'open' e a
--    incoerência reaparece na primeira criação.

CREATE OR REPLACE FUNCTION public.system_stage_role(p_pipeline_type text, p_stage_key text)
 RETURNS stage_role
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT (
    CASE p_pipeline_type
      WHEN 'whatsapp' THEN
        CASE p_stage_key
          WHEN 'agendado' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          ELSE 'open'
        END
      WHEN 'confirmacao' THEN
        CASE p_stage_key
          WHEN 'reuniao_marcada' THEN 'meeting_booked'
          WHEN 'confirmar_d5' THEN 'meeting_booked'
          WHEN 'confirmar_d3' THEN 'meeting_booked'
          WHEN 'confirmar_d2' THEN 'meeting_booked'
          WHEN 'confirmar_d1' THEN 'meeting_booked'
          WHEN 'confirmacao_no_dia' THEN 'meeting_booked'
          WHEN 'compareceu' THEN 'meeting_held'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      WHEN 'propostas' THEN
        CASE p_stage_key
          WHEN 'vendido' THEN 'won'
          WHEN 'perdido' THEN 'lost'
          ELSE 'open'
        END
      ELSE 'open'
    END
  )::public.stage_role
$function$;

UPDATE public.pipeline_stages s
   SET stage_role = public.system_stage_role(s.pipeline_type, s.stage_key)
 WHERE s.pipeline_type IN ('propostas', 'confirmacao')
   AND s.stage_key IN ('vendido', 'perdido')
   AND s.stage_role = 'open';

DO $$
DECLARE v_voltaram integer;
BEGIN
  SELECT count(*) INTO v_voltaram FROM public.pipeline_stages
   WHERE stage_role IN ('won','lost');
  RAISE NOTICE '% etapa(s) de sistema com papel restaurado. Funil custom NAO volta por aqui — ver cabeçalho.', v_voltaram;
END $$;
