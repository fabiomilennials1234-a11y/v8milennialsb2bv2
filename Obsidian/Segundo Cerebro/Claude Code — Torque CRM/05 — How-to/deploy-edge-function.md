---
type: howto
title: Deploy Edge Function
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [howto, deploy, edge-functions, supabase]
related: ["[[Edge Functions]]", "[[aplicar-migration-prod]]"]
owner: gabriel
---

# Como deployar uma edge function

> **Default = dev.** Deploy em prod requer autorização explícita do CTO na sessão.
> Pré-requisitos: `supabase` CLI instalado + autenticado (`supabase login`).

## Quando usar

- Após editar `supabase/functions/<nome>/index.ts`
- Após adicionar nova edge function

## Passos — Deploy em DEV

### 1. Verificar mudanças

```bash
git status supabase/functions/<nome>/
```

### 2. Testar local (opcional mas recomendado)

```bash
supabase functions serve <nome> --env-file .env.local --no-verify-jwt
```

Em outro terminal:
```bash
curl -X POST http://127.0.0.1:54321/functions/v1/<nome> \
  -H "Content-Type: application/json" \
  -d '{"...": "..."}'
```

### 3. Deploy DEV — ⚠️ não existe mais

O projeto dev foi **aposentado** em 2026-07-22 (estava 404 migrations atrás). Não
há mais um alvo de deploy intermediário: edge function vai direto pra prod, e prod
é botão do CTO.

⚠️ **Cuidado com o drift de bundle.** O deploy manual empacota `_shared` do working
tree — deployar de uma branch atrasada **reverte** o que está na `main` em prod.
Confirme que está em `origin/main` atualizada antes de deployar.

### 4. Verificar logs

```bash
supabase functions logs <nome> --project-ref jsjsmuncfkbsbzqzqhfq
```

## Passos — Deploy em PROD

> **Só com autorização CTO explícita na sessão.**

```bash
supabase functions deploy <nome> --project-ref jsjsmuncfkbsbzqzqhfq
```

Após deploy, smoke test:
```bash
curl -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/<nome> \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"...": "..."}'
```

## Config JWT

Edge functions têm `verify_jwt` configurado em `supabase/config.toml`:

```toml
[functions.<nome>]
verify_jwt = false  # ou true
```

**⚠ NUNCA** usar `--no-verify-jwt` na CLI — flag obsoleta. Use config.toml.
**⚠ CUIDADO**: `--no-verify-jwt=false` HABILITA JWT (double negative).

## Secrets

Edge fn lê secrets via `Deno.env.get('NOME')`. Set no dashboard:

```
Supabase Dashboard → Project → Edge Functions → Secrets → Add
```

Não commitar `.env` com secrets de prod.

## Rollback

```bash
# Deploy versão anterior (após git revert do código)
git revert <hash>
supabase functions deploy <nome> --project-ref <ref>
```

## Edge cases

- **Função nova**: criar pasta `supabase/functions/<nome>/index.ts` primeiro,
  depois deploy.
- **Imports `_shared`**: relativos funcionam, mas verificar
  `supabase/functions/_shared/` está presente no projeto remoto (deploy é
  per-function, _shared vai junto automaticamente).
- **Timeout**: edge fn tem 60s timeout. Operações longas → background task
  ou cron.

## Rollback de emergência

Se função quebrou prod e CTO não disponível:
1. Pausar cron job que invoca (se aplicável): `SELECT cron.alter_job(...)`
2. Comunicar incidente em #incidents
3. Aguardar CTO autorizar revert

## Referências

- Doc Supabase: https://supabase.com/docs/guides/functions
- [[Edge Functions]] — lista de funções existentes
- [[Env Vars]] — variáveis necessárias
