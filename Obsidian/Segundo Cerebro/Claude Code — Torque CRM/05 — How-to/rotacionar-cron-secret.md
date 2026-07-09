---
type: howto
title: Rotacionar CRON_SECRET
created: 2026-07-09
tags: [howto, seguranca, cron, edge-functions, secrets]
related: ["[[Dossiê DB — Saúde e Roadmap]]", "[[Cron Jobs]]", "[[Env Vars]]"]
---

# How-to — Rotacionar `CRON_SECRET`

> **Onda 0 / Slice 0.3** do [`.specs/features/db-optimization/SPEC.md`]. Op **manual do CTO** — não roda por migration/código. Motivo: o segredo vazou em transcript do incidente de retenção de mídia (2026-07-09) e segue válido.

## O que é o `CRON_SECRET`

Segredo compartilhado que autentica as chamadas **pg_cron → pg_net → edge function**. As edge fns com `verify_jwt = false` comparam o header `x-cron-secret` (ou `Authorization`) contra `Deno.env.get("CRON_SECRET")`. Se não bater → 401.

**Vive em DOIS lugares que precisam ficar idênticos:**

| Onde | Quem lê | Como atualizar |
|---|---|---|
| Secret de edge function `CRON_SECRET` | ~37 edge fns via `Deno.env` (+ `_shared/auth.ts`, `_shared/edge-framework.ts`) | `supabase secrets set` |
| Linha `cron_config.cron_secret` | Os invokers pg_cron (`invoke_*`) montam o header `x-cron-secret` a partir dela | `UPDATE public.cron_config` |

⚠️ **Se os dois divergirem, TODOS os crons quebram** (edge fn recebe header errado → 401). Atualize os dois na mesma janela.

## Passos (prod)

> Exige autorização CTO explícita. Fora de pico de preferência. `<ref>` prod = `jsjsmuncfkbsbzqzqhfq`.

### 1. Gerar segredo novo

```bash
# 32 bytes hex — forte e sem caracteres problemáticos em header HTTP
openssl rand -hex 32
```

Guarde o valor (não commite em lugar nenhum).

### 2. Setar o secret das edge functions

```bash
supabase secrets set CRON_SECRET='<novo-valor>' --project-ref jsjsmuncfkbsbzqzqhfq
```

Propaga pra todas as edge fns automaticamente (sem redeploy). Confirme:

```bash
supabase secrets list --project-ref jsjsmuncfkbsbzqzqhfq   # CRON_SECRET aparece com digest novo
```

### 3. Atualizar a linha do cron_config (mesmo valor)

Via SQL (Management API / dashboard):

```sql
UPDATE public.cron_config SET value = '<novo-valor>' WHERE key = 'cron_secret';
-- confirmar 1 linha afetada
SELECT key, left(value, 6) || '…' AS masked FROM public.cron_config WHERE key = 'cron_secret';
```

> `cron_config` é RLS deny-all (só `service_role`/master) — anon não lê. O `UPDATE` acima roda como admin.

### 4. Verificar (janela de ~5-10 min após)

Nenhum cron pode virar `failed` por auth. Todos os spine jobs rodam a cada 1 min:

```sql
SELECT j.jobname, d.status, d.start_time, left(d.return_message, 80) AS msg
FROM cron.job_run_details d
JOIN cron.job j USING (jobid)
WHERE d.start_time > now() - interval '10 minutes'
ORDER BY d.start_time DESC
LIMIT 30;
```

**Esperado:** todos `succeeded`. Se algum `failed` com 401 → o secret das edge fns e o `cron_config` divergiram; re-checar passos 2 e 3.

## Rollback

Re-setar o valor antigo nos dois lugares (passos 2 + 3). Reversível enquanto ninguém dependeu do novo.

## Notas

- Não há downtime se 2 e 3 forem próximos no tempo — a janela de risco é só o intervalo entre eles (≤ 1 ciclo de cron).
- Depende do fix da [Onda 0 / Slice 0.1](../../../../.specs/features/db-optimization/SPEC.md): com `invoke_whatsapp_media_retention()` ainda executável por anon, rotacionar não fecha o vetor sozinho — aplicar 0.1 primeiro.
- O `whatsapp-webhook` usa `UAZAPI_WEBHOOK_SECRET` (secret path), **não** o `CRON_SECRET` — não é afetado por esta rotação.
