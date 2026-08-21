-- Rollback de 20270810150000_stop_capturing_group_messages.sql
--
-- Restaura o comportamento anterior: captura de mensagem de grupo ligada por
-- padrão em todas as orgs.
--
-- ATENÇÃO: isto religa apenas a captura de TEXTO de grupo. O download de mídia
-- de grupo é barrado em código (whatsapp-webhook/index.ts, persistMessage) e
-- não volta com este rollback — de propósito: era ele que valia 40 GB.

alter table public.organizations
  alter column capture_groups set default true;

update public.organizations
   set capture_groups = true
 where capture_groups is distinct from true;

comment on column public.organizations.capture_groups is
  'Capturar mensagens de grupo do WhatsApp (texto).';
