-- ============================================================
-- pipe_confirmacao: adiciona coluna meet_link
-- Armazena o link do Google Meet gerado ao criar o evento
-- ============================================================

alter table public.pipe_confirmacao
  add column if not exists meet_link text;

comment on column public.pipe_confirmacao.meet_link
  is 'Link do Google Meet gerado automaticamente ao criar o evento no Google Calendar';
