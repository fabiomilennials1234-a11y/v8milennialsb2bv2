-- Fixture mínima da prova do gatilho "lead respondeu".
-- Uma org, um lead, dois funis (um com o lead, outro sem), evidência de tempo.
insert into public.organizations (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'QA Lead Respondeu', 'qa-lead-respondeu')
on conflict (id) do nothing;

insert into public.leads (id, organization_id, name)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Lead da Prova')
on conflict (id) do nothing;

insert into public.pipelines (id, organization_id, name, slug)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Funil com o lead', 'funil-com-o-lead'),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Funil sem o lead', 'funil-sem-o-lead')
on conflict (id) do nothing;

insert into public.pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position)
values
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'etapa-certa', 'Etapa certa', 0),
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'etapa-errada', 'Etapa errada', 0)
on conflict (id) do nothing;

insert into public.pipeline_entries (organization_id, pipeline_id, stage_id, stage_key, lead_id)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', 'etapa-certa', '22222222-2222-4222-8222-222222222222');

insert into public.workflows (id, organization_id, name, trigger_type, trigger_config, is_active)
values ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'Prova lead respondeu', 'lead_replied', '{}'::jsonb, true)
on conflict (id) do nothing;

-- Evidência de tempo: última saída 2h atrás, entrada anterior 100h atrás.
insert into public.whatsapp_messages (organization_id, lead_id, message_id, remote_jid, phone_number, direction, timestamp)
values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'm-out-1', '55@s.whatsapp.net', '55', 'outgoing', now() - interval '2 hours'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'm-in-1',  '55@s.whatsapp.net', '55', 'incoming', now()),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'm-in-0',  '55@s.whatsapp.net', '55', 'incoming', now() - interval '100 hours');
