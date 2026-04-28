-- Flip default de copilot_agents.attend_unknown_contacts de false → true.
-- Razão: comportamento atual em produção (agent-message ignora a flag) é
-- "atende todos os números". Adicionando audience gate em agent-message
-- com default=false geraria regressão massiva (~30 orgs param de responder
-- contatos sem lead pre-existente).
--
-- Backfill: agentes existentes com false (ou null) viram true. Quem quiser
-- "só leads conhecidos" liga manualmente o switch novo no playground.

ALTER TABLE public.copilot_agents
  ALTER COLUMN attend_unknown_contacts SET DEFAULT true;

UPDATE public.copilot_agents
SET attend_unknown_contacts = true
WHERE attend_unknown_contacts IS DISTINCT FROM true;

COMMENT ON COLUMN public.copilot_agents.attend_unknown_contacts IS
  'Audience filter: true = IA atende qualquer phone (cria shadow/real lead). '
  'false = só atende phones que já são lead na org. Default true preserva '
  'comportamento histórico. Aplicado em agent-message + sz-chat-webhook.';
