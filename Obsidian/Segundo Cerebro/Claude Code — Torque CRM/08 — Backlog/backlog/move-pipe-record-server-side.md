---
type: backlog
title: move_pipe_record server-side
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# move_pipe_record server-side

## Problema

A permissão `move_pipe_record` é checada apenas **client-side** dentro de `useUpdatePipeConfirmacao` (e seus equivalentes em outros pipes). Caller autenticado que pule o hook — componente novo, agente IA, script automatizado, service_role em algum scenário — pode mudar `pipe_confirmacao.status` direto via `supabase.from(...).update(...)` sem passar pelo gate.

RLS atual em `pipe_confirmacao` valida apenas:
- Tenant (`organization_id` do usuário).
- Visibilidade do card (responsible/sdr/closer/admin).

**Não valida** `move_pipe_record` em column-level. UPDATE de `status` por usuário sem permissão passa pela RLS sem objeção.

## Solução proposta

Duas opções (escolher a de menor impacto operacional):

### Opção 1 — Trigger Postgres `BEFORE UPDATE OF status`

```sql
CREATE OR REPLACE FUNCTION enforce_move_pipe_record()
RETURNS TRIGGER AS $$
DECLARE
  has_perm boolean;
BEGIN
  -- Bypass para service_role
  IF current_setting('role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Skip se status não mudou (idempotente com a lógica do hook)
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT check_action_allowed('move_pipe_record', NEW.id::text) INTO has_perm;
  IF NOT COALESCE(has_perm, false) THEN
    RAISE EXCEPTION 'permission denied: move_pipe_record' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_enforce_move_pipe_record
BEFORE UPDATE OF status ON pipe_confirmacao
FOR EACH ROW EXECUTE FUNCTION enforce_move_pipe_record();
```

Replicar para `pipe_whatsapp`, `pipe_propostas` e `custom_pipe_entries`.

### Opção 2 — RPC `SECURITY DEFINER` + REVOKE UPDATE da coluna `status`

```sql
CREATE FUNCTION move_pipe_stage(
  p_table text,
  p_id uuid,
  p_new_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$ /* check_action_allowed + UPDATE interno */ $$;

REVOKE UPDATE (status) ON pipe_confirmacao FROM authenticated;
```

Refactor todos os call sites de hooks de pipe (3 padrão + N customizados) para chamar a RPC em vez de UPDATE direto.

## Critérios de aceite

- Membro sem `move_pipe_record` recebe erro Postgres ao tentar UPDATE de `status` direto via supabase-js (sem passar pelo hook).
- Hook continua funcionando com mesma UX (gate client-side + barreira server-side double-check).
- service_role bypass mantido (cron jobs, workflows server-side).
- Trigger ou RPC cobre `pipe_whatsapp`, `pipe_confirmacao`, `pipe_propostas` e `custom_pipe_entries`.
- Testes integration validam bloqueio + bypass.

## Notas

- Aproveitar para auditar a função `check_action_allowed` — se não está em SECURITY DEFINER, precisa ficar.
- Avaliar custo do trigger sob carga (UPDATE de pipe é hot path em horário comercial).
- Escolher entre opção 1 (trigger) ou opção 2 (RPC + REVOKE) com base em medição de overhead.

## Origem

Veto Security S4 + item 7 do gate Security em [[ADR-2026-04-30-meeting-date-sync]] — fix client-side pragmático aprovado **com a condição** de gerar este follow-up HIGH para fechar o gap server-side.
