-- Religa a trava de valor na venda para a Bolivar.
--
-- ── Por que ───────────────────────────────────────────────────────────────
-- A Bolivar entrou em `rollout_exige_valor_venda` em 2026-09-02 com o motivo
-- "nao usa valor de venda" (1 venda em 6 meses, 100% sem valor). Isso deixou de
-- ser verdade: desde 2026-09-14 foram 29 negócios ganhos, e 10 (34%) ficaram
-- sem valor. O time passou a preencher valor, e a venda sem ele foi o que
-- travou a correção de 2026-11-19 (ver corrigir_venda_ganha_aceita_venda_sem_valor).
--
-- ── O que muda ────────────────────────────────────────────────────────────
-- `fn_exige_valor_no_negocio` (20270916000010) recusa marcar o negócio como
-- ganho sem valor, nos três caminhos (botão, arrastar, automação), para toda org
-- que NÃO está em `rollout_exige_valor_venda` com `religado_em IS NULL`.
-- Religar a Bolivar = marcar `religado_em`. Zero é resposta válida (cortesia,
-- troca); o que passa a ser recusado é a AUSÊNCIA de valor.
--
-- ── O que NÃO muda ────────────────────────────────────────────────────────
-- · A trava por etapa (`fn_exige_valor_na_venda`) só age em `stage_role = 'won'`
--   e a Bolivar não tem nenhuma etapa assim (as 28 são 'open'). Não é a alavanca
--   desta org e fica como está.
-- · Negócios já ganhos sem valor continuam como estão. A trava vale só na
--   TRANSIÇÃO para ganho; editar um negócio ganho não é bloqueado.
-- · A recuperação do valor a partir de `pipeline_entries.metadata.sale_value`
--   roda antes da recusa, como já rodava.
--
-- Reaplicar é no-op (`religado_em IS NULL`). Em banco sem a Bolivar, nenhuma
-- linha casa. Rollback: rollback/20280123002000_religa_trava_de_valor_bolivar.sql

BEGIN;

UPDATE public.rollout_exige_valor_venda
   SET religado_em = now()
 WHERE organization_id = 'e8508dc0-8eeb-47c2-9317-ee460daf8591'
   AND religado_em IS NULL;

COMMIT;
