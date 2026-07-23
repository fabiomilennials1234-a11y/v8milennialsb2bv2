-- 20270211000000_org_auto_create_lead_on_inbound.sql
--
-- Toggle POR ORGANIZAÇÃO: "Criar lead automaticamente ao receber mensagem
-- no WhatsApp".
--
-- Semântica:
--   ON  → inbound de telefone DESCONHECIDO cria o lead sozinho (funil WhatsApp,
--         etapa "novo", sem dono), MESMO quando não há IA ativa ou quando o
--         audience gate (attend_unknown_contacts=false) barraria a resposta.
--         Nenhuma resposta é gerada nesses casos — só o lead é criado.
--   OFF → comportamento idêntico ao de hoje: os gates de agente-ativo e de
--         audiência retornam skipped SEM criar lead.
--
-- Flag ADITIVA e retrocompatível: NÃO substitui `attend_unknown_contacts`
-- (que continua governando SE a IA responde a desconhecidos). Esta coluna só
-- governa SE o lead é materializado quando a IA não vai responder.
--
-- DEFAULT false já garante "todas as orgs desligadas" — sem trigger de init.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_create_lead_on_inbound boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.auto_create_lead_on_inbound IS
  'Se true, mensagens inbound de WhatsApp de telefones desconhecidos criam lead '
  'automaticamente (funil WhatsApp / etapa novo / sem dono), mesmo sem IA ativa '
  'ou quando attend_unknown_contacts=false barra a resposta. Default false = '
  'comportamento legado (não cria lead sozinho). Lida por agent-message '
  '(service_role, bypassa RLS); escrita por admin/owner/master via UI.';
