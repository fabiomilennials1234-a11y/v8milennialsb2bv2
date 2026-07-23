-- Reasoning Chain — copilot pensa em voz alta antes de responder
--
-- Adiciona infraestrutura pra:
-- 1. Configurar reasoning_mode por agente (always | actions_only | off)
-- 2. Logar reasoning em runtime_logs (auditoria + debug)
-- 3. Persistir reasoning_chain em agent_decision_logs (correlação com action)
--
-- Default agentes existentes: 'always' (decisão CTO 2026-04-26).
-- Custo estimado: +30-50% tokens em mensagens com reasoning.
-- Latência estimada: +1-3s por mensagem.
-- Mitigação: monitorar 24h pós-deploy, rollback edge function se métricas piorarem.

-- ─────────────────────────────────────────────────────────────────────────────
-- copilot_agents.reasoning_mode (Opção C — config por agente)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS reasoning_mode text NOT NULL DEFAULT 'always'
    CHECK (reasoning_mode IN ('always', 'actions_only', 'off'));

COMMENT ON COLUMN public.copilot_agents.reasoning_mode IS
  'Reasoning chain config: always (toda resposta), actions_only (só quando usar tool), off (legado). Default always.';

-- Backfill explícito pra agentes existentes (CHECK + DEFAULT já cobre, mas
-- INSERT explícito garante audit_log captura mudança em todos rows).
UPDATE public.copilot_agents
SET reasoning_mode = 'always'
WHERE reasoning_mode IS NULL OR reasoning_mode <> 'always';

-- ─────────────────────────────────────────────────────────────────────────────
-- runtime_logs.reasoning (auditoria + observability)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.runtime_logs
  ADD COLUMN IF NOT EXISTS reasoning text;

CREATE INDEX IF NOT EXISTS idx_runtime_logs_reasoning_recent
  ON public.runtime_logs (created_at DESC)
  WHERE reasoning IS NOT NULL;

COMMENT ON COLUMN public.runtime_logs.reasoning IS
  'Reasoning chain extraído de <thinking> antes do LLM responder. NULL se reasoning_mode=off ou agente não usou.';

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_decision_logs.reasoning_chain (correlação reasoning ↔ action)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_decision_logs
  ADD COLUMN IF NOT EXISTS reasoning_chain text;

COMMENT ON COLUMN public.agent_decision_logs.reasoning_chain IS
  'Reasoning chain do turno que gerou esta decisão. Permite correlacionar pensamento ↔ ação tomada.';
