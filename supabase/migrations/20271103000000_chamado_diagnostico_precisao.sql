-- Precisão do diagnóstico de Chamado (template v2 — docs/operations/chamado-fix.md).
--
-- O desfecho da execução (`execution_outcome`) diz se o Chamado foi resolvido,
-- não se o DIAGNÓSTICO acertou. O primeiro Chamado medido (39ff2cd1) foi
-- resolvido com a causa certa, mas precisou de um commit fora do plano (o
-- diagnóstico não abriu o print) e o cliente desmentiu a resposta sugerida.
-- Três colunas tornam isso mensurável por Chamado:
--
--   root_cause_confirmed  a execução confirmou a causa diagnosticada?
--   extra_commits         commits além do fix planejado (0 = plano completo)
--   reply_contradicted    o cliente desmentiu a resposta sugerida?
--
-- Gravadas pela sessão que executou o prompt (torque-mcp
-- `support.record_execution`) ou à mão no painel. Só existem com a execução
-- registrada: o mesmo invariante de `execution_outcome`.
--
-- Os domínios espelham `CAUSE_CONFIRMATIONS` em
-- supabase/functions/torque-mcp/tools/support.ts e em
-- src/modules/identity/master/lib/ticket-diagnosis.ts. Mudou um, muda os três.
BEGIN;

ALTER TABLE public.support_ticket_diagnoses
  ADD COLUMN root_cause_confirmed text
    CHECK (root_cause_confirmed IN ('sim', 'nao', 'parcial')),
  ADD COLUMN extra_commits smallint
    CHECK (extra_commits BETWEEN 0 AND 50),
  ADD COLUMN reply_contradicted boolean,
  ADD CONSTRAINT support_ticket_diagnoses_precision_needs_execution CHECK (
    executed_at IS NOT NULL
    OR (root_cause_confirmed IS NULL AND extra_commits IS NULL AND reply_contradicted IS NULL)
  );

COMMENT ON COLUMN public.support_ticket_diagnoses.root_cause_confirmed IS
  'A execução confirmou a causa diagnosticada? sim | nao | parcial.';
COMMENT ON COLUMN public.support_ticket_diagnoses.extra_commits IS
  'Commits além do fix planejado. 0 = o plano do diagnóstico estava completo.';
COMMENT ON COLUMN public.support_ticket_diagnoses.reply_contradicted IS
  'O cliente desmentiu a resposta sugerida pelo diagnóstico?';

COMMIT;
