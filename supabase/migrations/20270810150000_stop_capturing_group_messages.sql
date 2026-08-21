-- Para de capturar mensagens de grupo por padrão.
--
-- Contexto (medido em prod, 2026-08-10):
--   - bucket `media` chegou a 100 GB; 99,8% é `whatsapp-media/`
--   - 40 GB desses são mídia de GRUPO (149.341 arquivos)
--   - 978.452 mensagens de grupo geraram 0 (zero) leads
--   - grupo já é descartado de lead/copilot/pipeline no webhook (persist-only)
--   - `capture_groups` nasceu com default `true` e as 99 orgs estavam todas em
--     `true`: o opt-out existia e nunca foi usado por ninguém
--
-- Ou seja: capturávamos ~1M de mensagens e 40 GB de mídia que nenhuma parte do
-- produto lê. Este migration inverte o default e alinha as orgs existentes.
--
-- Reversível: `capture_groups` continua sendo por org. Uma org que queira o
-- histórico de grupo de volta é um UPDATE de uma linha. Mesmo religada, ela NÃO
-- volta a baixar mídia de grupo — esse gate é de código, não de dado
-- (whatsapp-webhook/index.ts, persistMessage).
--
-- Rollback: supabase/migrations/rollback/20270810150000_stop_capturing_group_messages.sql

alter table public.organizations
  alter column capture_groups set default false;

update public.organizations
   set capture_groups = false
 where capture_groups is distinct from false;

comment on column public.organizations.capture_groups is
  'Capturar mensagens de grupo do WhatsApp (texto). Default false desde 2026-08-10 - grupo nao gera lead e inflava storage. Midia de grupo nunca e baixada, independente deste flag.';
