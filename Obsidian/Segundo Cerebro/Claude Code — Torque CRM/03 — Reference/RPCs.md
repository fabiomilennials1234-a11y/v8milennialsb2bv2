---
type: reference
title: RPCs (Postgres Functions)
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [reference, rpc, postgres]
related: ["[[Schema]]", "[[RLS Policies]]"]
owner: gabriel
---

# RPCs — Reference

> Funções SQL chamadas via `supabase.rpc('<nome>', { ... })` do frontend ou
> edge function. Stub — preencher iterativamente.

## Convenção

```sql
CREATE OR REPLACE FUNCTION public.<nome>(
  arg1 type,
  arg2 type
) RETURNS <type>
LANGUAGE plpgsql
SECURITY DEFINER  -- ou INVOKER, conforme caso
AS $$
DECLARE
  ...
BEGIN
  -- checagem de auth/role
  -- lógica
END;
$$;

GRANT EXECUTE ON FUNCTION public.<nome>(...) TO authenticated;
```

## Categorias

### Multi-tenancy helpers
- `auth.org_id()` — extrai org do JWT
- `auth.is_master()` — checa role master

### WhatsApp secrets (service_role only)
- `get_uazapi_credentials(p_instance_id)` — retorna token
- `set_uazapi_credentials(p_instance_id, p_token)` — set/update

### Pipelines
- `move_pipe_record(...)` — TODO criar como alternativa server-side ao
  client gate ([[move-pipe-record-server-side]] pendente)

### Copilot
- (a listar — funções de busca semântica via pgvector, etc.)

### Health
- `health_check_database()` — verificação geral

## Listar todas

```sql
SELECT routine_schema, routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

## Gotchas

- **`SECURITY DEFINER` bypassa RLS.** Validar role/org dentro da função.
- **Overloads**: múltiplas funções com mesmo nome + assinaturas diferentes.
  Pode confundir caller. [[rpc-consolidation]] feita 2026-05-12 pra reduzir.
- **N8n body params** sempre strings — arrays viram JSON body ou normalizar.
