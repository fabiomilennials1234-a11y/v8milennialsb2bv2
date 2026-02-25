-- ============================================================
-- Trigger: sistema → Google Calendar
--
-- Quando compromisso_date é definido/alterado em um lead
-- que tem um responsável com Google Calendar conectado,
-- dispara a criação/atualização do evento via Edge Function.
--
-- O trigger usa pg_net (disponível no Supabase) para chamadas
-- HTTP assíncronas sem bloquear a transação do usuário.
-- ============================================================

-- Extensão necessária para HTTP requests assíncronos no Postgres
create extension if not exists pg_net;

-- ──────────────────────────────────────────────────────────────
-- Função do trigger
-- ──────────────────────────────────────────────────────────────
create or replace function public.trigger_google_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supabase_url    text;
  v_service_key     text;
  v_assigned_to     uuid;
  v_pipe_conf_id    uuid;
  v_meet_link       text;
  v_old_date        timestamptz;
  v_new_date        timestamptz;
begin
  -- Pega a data antiga e nova
  v_old_date := OLD.compromisso_date;
  v_new_date := NEW.compromisso_date;

  -- Só processa se compromisso_date mudou e não é nulo
  if v_new_date is null or v_new_date = v_old_date then
    return NEW;
  end if;

  -- Precisa de assigned_to para saber em qual calendário criar
  v_assigned_to := NEW.assigned_to;
  if v_assigned_to is null then
    return NEW;
  end if;

  -- Verifica se o responsável tem Google Calendar conectado
  perform 1
  from google_calendar_tokens
  where user_id = v_assigned_to
    and is_active = true
  limit 1;

  if not found then
    return NEW;
  end if;

  -- Busca o pipe_confirmacao vinculado ao lead (se existir)
  select id into v_pipe_conf_id
  from pipe_confirmacao
  where lead_id = NEW.id
  order by created_at desc
  limit 1;

  -- Credenciais hardcoded (ALTER DATABASE não tem permissão no Supabase managed)
  v_supabase_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
  v_service_key  := current_setting('app.service_role_key', true);

  -- Dispara chamada HTTP assíncrona para a Edge Function
  perform net.http_post(
    url     => v_supabase_url || '/functions/v1/google-calendar-events',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    => jsonb_build_object(
      'title',                NEW.name || ' - Reunião',
      'description',          'Reunião com lead: ' || coalesce(NEW.name, '') ||
                              case when NEW.phone is not null
                                   then chr(10) || 'Telefone: ' || NEW.phone
                                   else '' end,
      'start_at',             to_char(v_new_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'end_at',               to_char(v_new_date + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone',             'America/Sao_Paulo',
      'lead_id',              NEW.id::text,
      'pipe_confirmacao_id',  coalesce(v_pipe_conf_id::text, null),
      'calendar_owner_id',    v_assigned_to::text,
      '_system_trigger',      true
    )
  );

  return NEW;
exception
  when others then
    -- Não bloqueia a transação em caso de erro na chamada HTTP
    raise warning '[google_calendar_sync] Erro ao disparar sync: %', sqlerrm;
    return NEW;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Trigger na tabela leads
-- ──────────────────────────────────────────────────────────────
drop trigger if exists trg_leads_google_calendar_sync on public.leads;

create trigger trg_leads_google_calendar_sync
  after update of compromisso_date
  on public.leads
  for each row
  execute function public.trigger_google_calendar_sync();

-- Também dispara na inserção de leads com compromisso_date já preenchido
create trigger trg_leads_google_calendar_sync_insert
  after insert
  on public.leads
  for each row
  when (NEW.compromisso_date is not null)
  execute function public.trigger_google_calendar_sync();
