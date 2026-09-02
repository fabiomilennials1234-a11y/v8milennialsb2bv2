-- "Não compareceu" deixa de contar como PERDA.
--
-- ── O defeito, medido em PROD em 2026-09-01 ───────────────────────────────
-- `system_stage_role` classifica a etapa `nao_compareceu` do funil `whatsapp`
-- como `lost`. A mesma função, no funil `confirmacao`, deixa `no_show` e
-- `nao_compareceu` caírem no ELSE e virarem `open`. Ou seja: a função discorda
-- DELA MESMA sobre o que é uma falta.
--
-- `open` é o papel certo, e a descrição do enum diz por quê:
--   open = "Etapa intermediária — não gera métrica de reunião nem de venda"
--   lost = "Encerra a oportunidade sem venda — conta como perda"
-- Quem não compareceu não encerrou nada: o lead segue vivo e precisa de nova
-- data. É por isso que as 106 orgs com o funil `confirmacao` já tratam falta
-- como `open` — só o `whatsapp` destoava.
--
-- ── O que isso estava produzindo ──────────────────────────────────────────
-- DUAS orgs, e nas duas o efeito passa de métrica:
--
--   Milennials  whatsapp >> nao_compareceu  "↩️ Remarcar"  role=lost  140 cards
--   Liris       whatsapp >> no_show         "No-show"      role=lost    1 card
--
-- E uma TERCEIRA linha que só o predicado do UPDATE pega, porque o papel dela
-- já estava certo e só a flag estava errada:
--
--   Labarr Choc. whatsapp >> no_show        "No Show"      role=open    flag
--
-- Em Labarr o `lostStageKey` já não era o no_show — "Esfriou" (posição 4) vem
-- antes e ganhava o `find`. Tirar a flag de lá não muda destino nenhum hoje;
-- muda o dia em que alguém reordenar ou desativar o "Esfriou".
--
-- 1. MÉTRICA — 140 leads da Milennials contavam como perdidos por terem
--    faltado a uma reunião. A etapa que a org de fato usa para perda
--    ("🚨 Perdido / Desqualificado", posição 14) está com `stage_role = open`
--    e não conta nada. A conta estava exatamente invertida.
--
-- 2. BOTÃO MORTO — as duas linhas também têm `is_final_negative = true`, e
--    `PipeWhatsapp.tsx` deriva o destino do "Marcar perdido" com
--    `stages.find(s => s.is_final_negative)` sobre a lista ordenada por
--    `position`. Em ambas as orgs a etapa de FALTA vem antes da etapa de
--    PERDA (12 antes de 14; 9 antes de 912), então ela ganhava o `find`.
--    Resultado: o botão "Perdido" do card em `nao_compareceu` movia o card
--    para `nao_compareceu` — para onde ele já estava. Gravava o motivo da
--    perda e não saía do lugar.
--
-- ── Por que a função vem ANTES do UPDATE, e não depois ────────────────────
-- 🚨 O trigger `trg_pipeline_stages_system_stage_role` roda
-- `pipeline_stages_assign_system_stage_role` em cada escrita:
--
--     IF NEW.stage_role = 'open' THEN
--       NEW.stage_role := public.system_stage_role(NEW.pipeline_type, NEW.stage_key);
--     END IF;
--
-- Um `UPDATE ... SET stage_role = 'open'` com a função velha no lugar é
-- REESCRITO de volta para `lost` dentro da própria transação, sem erro e sem
-- aviso. O UPDATE pareceria ter funcionado e o valor voltaria ao errado. A
-- ordem aqui não é estilo: é a diferença entre a correção pegar e não pegar.
--
-- ── Alcance ───────────────────────────────────────────────────────────────
-- TRÊS linhas de `pipeline_stages`, em três orgs. Nenhuma linha de
-- `pipeline_entries`, `meeting_events` ou `deals` é tocada: o papel da etapa é
-- lido na hora de contar, então a métrica se corrige sozinha na próxima
-- leitura. Efeito esperado e desejado: "perdidos" do funil Oportunidades da
-- Milennials cai em 140 — que nunca foram perdas.
--
-- Reaplicar é no-op.

-- ── 1. A função. Precisa vir primeiro (ver acima). ────────────────────────
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
          -- `nao_compareceu` era 'lost' aqui. Falta não é perda — ver o
          -- cabeçalho. Cai no ELSE, igual ao funil `confirmacao`.
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

COMMENT ON FUNCTION public.system_stage_role(text, text) IS
  'Papel canônico da etapa de sistema. Falta a reunião (nao_compareceu / no_show) é `open` em TODOS os funis: o lead segue vivo e precisa de nova data. Só `perdido` e `vendido` encerram.';

-- ── 2. As duas linhas que já estavam gravadas erradas ─────────────────────
-- Recortado por `stage_key` + `pipeline_type`, e NÃO por org: se uma terceira
-- org aparecer com a mesma marcação, ela também está errada pelo mesmo motivo.
-- `is_final_negative` sai junto — é ele que faz a etapa ganhar o `find` do
-- destino de "Marcar perdido".
UPDATE public.pipeline_stages
   SET stage_role = 'open',
       is_final_negative = false,
       updated_at = now()
 WHERE pipeline_type = 'whatsapp'
   AND stage_key IN ('nao_compareceu', 'no_show')
   AND (stage_role = 'lost' OR is_final_negative);

-- ── 3. Guarda ─────────────────────────────────────────────────────────────
-- Se o trigger reescrever o UPDATE (regressão da ordem acima), isto levanta e
-- desfaz a migration inteira em vez de deixar um verde mentiroso.
DO $$
DECLARE
  v_restantes integer;
BEGIN
  SELECT count(*) INTO v_restantes
  FROM public.pipeline_stages
  WHERE pipeline_type = 'whatsapp'
    AND stage_key IN ('nao_compareceu', 'no_show')
    AND (stage_role = 'lost' OR is_final_negative);

  IF v_restantes > 0 THEN
    RAISE EXCEPTION
      'system_stage_role nao pegou: % etapa(s) de falta ainda marcadas como perda', v_restantes;
  END IF;
END $$;
