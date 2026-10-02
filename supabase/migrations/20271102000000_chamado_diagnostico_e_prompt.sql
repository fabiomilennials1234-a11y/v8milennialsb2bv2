-- Diagnóstico de Chamado + prompt de resolução (processo de fix em 4 etapas).
--
-- 1. O cliente abre um Chamado no CRM (support_tickets).
-- 2. O dev usa o Claude Code para ler o Chamado e diagnosticar o sistema.
-- 3. O Claude Code registra aqui o diagnóstico simplificado e o prompt de
--    resolução (via torque-mcp `support.record_diagnosis`, ou à mão na UI).
-- 4. O dev operacional responde o cliente e executa o prompt.
--
-- Por que tabela separada, e não colunas em `support_tickets`: o autor e o admin
-- da org LEEM a linha do Chamado (policy `support_tickets_select`). O prompt
-- carrega root cause, caminhos de arquivo e detalhes internos do sistema — não
-- pode vazar ao cliente por um `select=*`. Aqui a RLS é só-master, sem exceção.
--
-- 1:1 com o Chamado (ticket_id é a PK): um Chamado tem UM diagnóstico vigente.
-- Re-diagnosticar sobrescreve; a trilha de quem gravou o quê fica em
-- `master_audit_logs` (torque-mcp audita antes de aplicar).
BEGIN;

CREATE TABLE public.support_ticket_diagnoses (
  ticket_id          uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('fix', 'feature', 'configuracao', 'duvida')),
  complexity         text NOT NULL CHECK (complexity IN ('trivial', 'baixa', 'media', 'alta', 'critica')),
  summary            text NOT NULL CHECK (length(btrim(summary)) BETWEEN 10 AND 2000),
  root_cause         text CHECK (root_cause IS NULL OR length(root_cause) <= 4000),
  customer_reply     text CHECK (customer_reply IS NULL OR length(customer_reply) <= 4000),
  -- Aliases do Claude Code (`/model opus`), não IDs versionados: o alias
  -- sobrevive à troca de versão do modelo; o ID congelaria o prompt no passado.
  recommended_model  text NOT NULL CHECK (recommended_model IN ('haiku', 'sonnet', 'opus', 'fable')),
  recommended_effort text NOT NULL CHECK (recommended_effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  resolution_prompt  text NOT NULL CHECK (length(btrim(resolution_prompt)) BETWEEN 50 AND 60000),
  -- [{ "label": "...", "verify": "comando ou query que prova" }]
  keystones          jsonb NOT NULL CHECK (
                       jsonb_typeof(keystones) = 'array'
                       AND jsonb_array_length(keystones) BETWEEN 1 AND 15
                     ),
  estimated_cost_usd numeric(8,2) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  -- Versão do template do prompt: permite comparar acurácia/custo entre versões.
  template_version   smallint NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('claude_code', 'manual')),
  diagnosed_by       uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Fecho do ciclo: o que de fato aconteceu ao executar o prompt. É o dado que
  -- calibra o roteamento modelo/effort e a estimativa de custo.
  executed_at        timestamptz,
  execution_outcome  text CHECK (execution_outcome IN ('resolvido', 'parcial', 'falhou')),
  actual_cost_usd    numeric(8,2) CHECK (actual_cost_usd IS NULL OR actual_cost_usd >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_diagnoses_execution_coherent CHECK (
    (executed_at IS NULL) = (execution_outcome IS NULL)
    AND (actual_cost_usd IS NULL OR executed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.support_ticket_diagnoses IS
  'Diagnóstico simplificado + prompt de resolução de um Chamado. Só master lê/escreve: '
  'contém root cause e detalhes internos. Ver docs/operations/chamado-fix.md.';

CREATE TRIGGER trg_support_ticket_diagnoses_updated_at
  BEFORE UPDATE ON public.support_ticket_diagnoses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.support_ticket_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_ticket_diagnoses_master_select ON public.support_ticket_diagnoses
  FOR SELECT TO authenticated USING (public.is_master_user());
CREATE POLICY support_ticket_diagnoses_master_insert ON public.support_ticket_diagnoses
  FOR INSERT TO authenticated WITH CHECK (public.is_master_user());
CREATE POLICY support_ticket_diagnoses_master_update ON public.support_ticket_diagnoses
  FOR UPDATE TO authenticated USING (public.is_master_user()) WITH CHECK (public.is_master_user());
CREATE POLICY support_ticket_diagnoses_master_delete ON public.support_ticket_diagnoses
  FOR DELETE TO authenticated USING (public.is_master_user());

-- Default privileges do Supabase dão SELECT a anon em tabela nova; a RLS já
-- barraria, mas o grant não deve nem existir.
REVOKE ALL ON public.support_ticket_diagnoses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_ticket_diagnoses TO authenticated;
GRANT ALL ON public.support_ticket_diagnoses TO service_role;

COMMIT;
