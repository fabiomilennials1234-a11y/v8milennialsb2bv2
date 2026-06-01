---
type: howto
title: Refresh do HML (homologação a partir de prod)
status: active
created: 2026-06-01
updated: 2026-06-01
tags: [howto, hml, homologacao, database, prod, dev]
related: ["[[aplicar-migration-prod]]", "[[regenerar-types-supabase]]", "[[reset-leads-teste]]"]
owner: gabriel
---

# Como refrescar o HML (homologação)

> **O que é:** o projeto Supabase **Dev** (`bcfadphgsibjzivtbjvc`) é usado como
> ambiente de **homologação (HML)** — um espelho **on-demand** de produção
> (`jsjsmuncfkbsbzqzqhfq`). Você roda um comando, o HML vira uma foto de prod,
> **neutralizada** para nunca falar com cliente real.
>
> Decisão de design completa: PRD #612. Slices: #613–#618.

## Trade-offs aceitos (leia antes)

- **Sem anonimização** — HML tem PII real (telefones, conversas) e **login real**
  de cliente. Quem tem acesso ao HML pode logar como cliente real. Aceito.
- **HML congela entre refreshes** — não é espelho sempre-fresco. Atualiza só
  quando você roda o script.
- **Senha do postgres de prod no `.env`** — acesso total ao banco. Local-only,
  **nunca** no git nem em CI.

## Setup único (uma vez, não a cada refresh)

### 1. Extensions no projeto dev
Já habilitadas (verificado 2026-06-01): `pg_net`, `pg_trgm`, `pgcrypto`,
`vector`, `pg_cron`. Conferir:

```sql
SELECT extname FROM pg_extension
WHERE extname IN ('pg_net','pg_trgm','pgcrypto','vector','pg_cron');
```

### 2. Secrets "safe" das edge functions do HML (keystone)
Aponte a saída do HML para destinos dummy/inalcançáveis. Todo envio WhatsApp
passa pelo adapter → `UAZAPI_BASE_URL`; um valor dummy é a última linha de
defesa mesmo que algo escape da neutralização.

```bash
supabase secrets set \
  UAZAPI_BASE_URL='https://hml-dummy.invalid' \
  CRON_SECRET='<segredo-proprio-do-hml>' \
  --project-ref bcfadphgsibjzivtbjvc
# Meta / email / n8n: vazios ou dummy também.
```

> ⚠️ Isso muda o comportamento do dev: WhatsApp de teste para de sair. Faça só
> quando assumir o dev como HML de verdade.

### 3. Connection strings no `.env` (gitignored)
Supabase → projeto → Settings → Database → Connection string → **Session/direct
(porta 5432)**, com a senha do postgres.

```
PROD_DB_URL=postgres://postgres:[SENHA]@db.jsjsmuncfkbsbzqzqhfq.supabase.co:5432/postgres
HML_DB_URL=postgres://postgres:[SENHA]@db.bcfadphgsibjzivtbjvc.supabase.co:5432/postgres
```

> O host direct é IPv6-only. Em rede IPv4, use a string do **Session Pooler**
> (host `...pooler.supabase.com`, user `postgres.<ref>`).

### 4. Cliente Postgres
`pg_dump` e `psql` v17 instalados (`brew install libpq` no macOS, e exportar o
PATH do libpq).

## Refresh (cada vez que quiser dado fresco)

```bash
./scripts/hml/refresh-hml.sh
```

O script é **fail-closed** e faz, em ordem:

1. Desativa **todos** os cron jobs do HML.
2. `pg_dump` de prod — `auth` (data-only) + `public` (schema+data).
3. Restore no HML — `auth` antes de `public` (ordem de FK).
4. `neutralize_hml.sql` — corta os 5 vetores de saída.
5. `assert_hml_safe.sql` — guard fail-closed; se sobrou vetor vivo, **aborta** e
   o HML fica travado (cron off), nunca "restaurado e vivo".

Storage/mídia **não** é copiado (PII pesada; 404 cosmético em HML).

## O que esperar

- **Não rode `npm run dev` durante o refresh** — o HML fica inconsistente
  enquanto restaura. O frontend local (`.env.development` → `bcfad`) é o
  frontend de HML.
- Mídia antiga vira 404 (esperado).
- Migration nova: teste contra o HML recém-clonado (schema real de prod), depois
  promova pra prod — ver [[aplicar-migration-prod]].

## Verificar o neutralize sem rodar o refresh

`scripts/hml/verify-neutralize-dev.mjs` roda seed → neutralize → assert dentro de
transação com `ROLLBACK` (não persiste nada). Útil pra validar o
`neutralize_hml.sql` contra um schema real:

```bash
PG_CONN="$HML_DB_URL" node scripts/hml/verify-neutralize-dev.mjs
```

## Gotchas

- `neutralize` camada 1 (`UPDATE cron.job`) exige **superuser postgres** — o
  `refresh-hml.sh` tem via connection direta. Role do Supabase MCP não tem.
- Trigger `enforce_whatsapp_instance_limit` bloqueia inserir `whatsapp_instances`
  em org sem quota (relevante para seeds de teste).
- `webhook_deliveries` não tem coluna `status` — neutralize drena a fila inteira.
- `organizations.whatsapp_provider_override` só aceita `uazapi`/`evolution`/NULL;
  a credencial é cortada via wipe de `whatsapp_instance_secrets` + env dummy.
- **Prod nunca é destino.** O script recusa se `HML_DB_URL` apontar pra prod.
