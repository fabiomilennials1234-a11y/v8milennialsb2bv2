create role anon; create role authenticated;
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  direction text not null default 'incoming',
  created_at timestamptz not null default now(),
  message_type text, raw_payload jsonb, status text, phone_number text, "timestamp" timestamptz default now());
create index idx_whatsapp_messages_direction on public.whatsapp_messages (direction, created_at desc);
-- armadilha: se o backfill disparar trigger de UPDATE de status/telefone, aborta
create function public.fail_on_update() returns trigger language plpgsql as $$ begin raise exception 'status trigger fired'; end $$;
create trigger t_status after update of status, phone_number on public.whatsapp_messages for each row execute function public.fail_on_update();
-- linhas ANTES da migration (alvo do script de backfill)
insert into public.whatsapp_messages(message_type, raw_payload, created_at, direction) values
 ('document','{"content":{"fileName":"Pedido JURERE - 03.10.26.pdf","title":"Pedido JURERE - 03.10.26.pdf"}}', now() - interval '2 days', 'incoming'),
 ('document','{"content":{"title":"  Contrato.docx "}}', now() - interval '5 days', 'outgoing'),
 ('document','{"document":{"filename":"NF.xml"}}', now() - interval '1 hour', 'incoming'),
 ('document','{"content":{"fileName":""}}', now() - interval '3 days', 'incoming'),
 ('document',null, now() - interval '3 days', 'incoming'),
 ('document','{"content":{"fileName":"velho.pdf"}}', now() - interval '20 days', 'incoming'),
 ('image','{"content":{"fileName":"x.jpg"}}', now() - interval '1 day', 'incoming');
