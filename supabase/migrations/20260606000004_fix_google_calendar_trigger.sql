-- ============================================================
-- Fix: trigger_google_calendar_sync
--
-- Bug 1 corrigido: campo `assigned_to` não existe em `leads`.
--   Agora usa COALESCE(closer_id, sdr_id).
--
-- Nota: o sync automático via trigger é um mecanismo secundário.
-- O fluxo primário é via AddMeetingModal → Edge Function direta.
-- ============================================================

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
  v_old_date        timestamptz;
  v_new_date        timestamptz;
begin
  v_old_date := OLD.compromisso_date;
  v_new_date := NEW.compromisso_date;

  -- Só processa se compromisso_date mudou e não é nulo
  if v_new_date is null or v_new_date = v_old_date then
    return NEW;
  end if;

  -- Usa closer_id com fallback para sdr_id (campo assigned_to não existe em leads)
  v_assigned_to := coalesce(NEW.closer_id, NEW.sdr_id);
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

  v_supabase_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
  v_service_key  := current_setting('app.service_role_key', true);

  -- Só dispara se a service_key estiver configurada
  if v_service_key is null or v_service_key = '' then
    raise warning '[google_calendar_sync] app.service_role_key não configurado, pulando sync automático';
    return NEW;
  end if;

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
    raise warning '[google_calendar_sync] Erro ao disparar sync: %', sqlerrm;
    return NEW;
end;
$$;
