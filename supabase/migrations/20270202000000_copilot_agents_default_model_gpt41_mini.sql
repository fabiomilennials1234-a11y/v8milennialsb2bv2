-- Novos copilots nascem em openai/gpt-4.1-mini.
--
-- Default anterior: 'google/gemini-3-flash-preview' — modelo preview instável,
-- causa-raiz da classe de leak em que o modelo emite tool-call como TEXTO
-- (<prefill>, <tool_call>) em vez de tool_call nativo, e falha em invocar tools
-- disponíveis (ex: send_document com docs ready). Incidentes de produção em
-- 2026-07-11 e 2026-05-21.
--
-- gpt-4.1-mini: tool-calling nativo disciplinado, não-reasoning (baixa latência
-- pra WhatsApp), custo equivalente ao gemini-flash na escala atual.
--
-- Aplicado em prod via MCP (migration copilot_agents_default_model_gpt41_mini).
-- As linhas existentes foram migradas em UPDATE separado no mesmo dia.
-- Rollback: alter column llm_model set default 'google/gemini-3-flash-preview';

alter table public.copilot_agents
  alter column llm_model set default 'openai/gpt-4.1-mini';
