-- ============================================================
-- runtime_logs: correlação por sessão de navegação e por requisição,
--               e remoção do CHECK de `module`.
--
-- (1) session_id / request_id
--
-- Contexto (ADR-0017): sem Session Replay, a forma de reconstruir "o que o
-- backend fez enquanto o usuário sofria o bug" é agrupar os logs pela sessão
-- de navegação. O frontend cunha um session_id por aba e o envia em
-- `x-torque-session-id` em toda chamada; cada requisição HTTP também carrega
-- seu próprio `x-torque-request-id`.
--
-- Nomeado request_id, NÃO trace_id: `trace_id` já existe no domínio do
-- Copilot v2 (`copilot_v2_trace_steps`) e significa um turno do agente.
-- Dois trace_id com semânticas diferentes seria armadilha para humano e LLM.
--
-- (2) DROP do CHECK de `module`
--
-- O CHECK permitia 10 valores; o código escreve 24. `logRuntime` engole a
-- falha do insert por design (telemetria não pode derrubar edge function),
-- então 14 módulos — agent, analytics, auth, calendar, channel, job_monitor,
-- lead, media, meeting, pipe_distribution, scheduled_user_messages, sz_chat,
-- tts, whatsapp — acreditam estar logando e nunca gravaram uma linha.
--
-- A migration 20270111 já havia consertado dois casos (general, carteira)
-- depois de o dado sumir. Este é o padrão: um constraint de runtime, num
-- caminho cujo erro é silenciado, destrói exatamente o dado que deveria
-- proteger. Expandir a lista só adia a quarta migration da mesma família.
--
-- A proteção contra typo passa a ser o union type `RuntimeLogModule` em
-- `_shared/logger.ts`: pega o erro no build, antes de a linha existir.
-- ============================================================

ALTER TABLE public.runtime_logs
  ADD COLUMN IF NOT EXISTS session_id UUID,
  ADD COLUMN IF NOT EXISTS request_id UUID;

COMMENT ON COLUMN public.runtime_logs.session_id IS
  'Sessão de navegação do frontend (x-torque-session-id). Agrupa os logs de um Chamado.';
COMMENT ON COLUMN public.runtime_logs.request_id IS
  'Uma chamada HTTP (x-torque-request-id). Não confundir com o trace_id do Copilot v2.';

-- A consulta que o suporte roda ao abrir um Chamado:
--   SELECT * FROM runtime_logs WHERE session_id = $1 ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_runtime_logs_session_created
  ON public.runtime_logs (session_id, created_at)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_logs_request
  ON public.runtime_logs (request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.runtime_logs
  DROP CONSTRAINT IF EXISTS runtime_logs_module_check;

COMMENT ON COLUMN public.runtime_logs.module IS
  'Módulo emissor. Vocabulário garantido em compile time pelo union type RuntimeLogModule (_shared/logger.ts) — deliberadamente sem CHECK, ver migration 20270115.';
