---
type: howto
title: Aplicar Migration em Produção
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [howto, migration, database, prod]
related: ["[[deploy-edge-function]]", "[[regenerar-types-supabase]]"]
owner: gabriel
---

# Como aplicar migration em produção

> **DEFAULT = DEV.** Apply em prod **só** com autorização explícita do CTO
> na sessão. Migration em prod é irreversível por padrão.

## Pré-flight

### 1. Onde a migration foi validada?

O projeto dev foi **aposentado** em 2026-07-22, então a regra antiga de "24h em dev
com tráfego real" não existe mais. O alvo é branch efêmera a partir de prod — hoje
**bloqueada** até o baseline das migrations (ver `CLAUDE.md` raiz § Ambientes).

Enquanto não houver ambiente, aplicar em prod exige, sem exceção:

1. **Rollback capturado em arquivo e testado executando** — antes de qualquer escrita
2. **Baseline medido no próprio prod antes de aplicar** — para provar o estado inicial
3. Verificação imediata após a escrita, com o rollback engatilhado
4. **Declarar o desvio no PR**, dizendo o que substituiu o QA

```bash
supabase migration list --project-ref jsjsmuncfkbsbzqzqhfq
```

⚠️ Compare a versão gravada no ledger com o nome do arquivo. Divergiu, é drift —
registre e **não reaplique achando que falta**.

### 2. Migration é reversível?

- ALTER ADD COLUMN — reversível (DROP COLUMN)
- ALTER ADD COLUMN NOT NULL DEFAULT — reversível mas custoso
- CREATE TABLE — reversível (DROP TABLE) mas perde dados
- DROP COLUMN — **irreversível** sem backup
- DROP TABLE — **irreversível**
- DATA MIGRATION — geralmente irreversível

Se irreversível, **backup explícito antes** + autorização CTO em texto:
"autorizo apply em prod da migration `<arquivo>` sabendo que é irreversível".

### 3. Migration toca dados sensíveis?

Sensível = `auth.users`, `whatsapp_instance_secrets`, qualquer coluna com PII,
RLS policies, RPCs com `SECURITY DEFINER`. Review obrigatória.

### 4. RLS coverage

Se cria tabela: RLS habilitada + policies tenant_isolation_*. Sem isso,
review reprova.

## Passos — Apply

### 1. Sincronizar migrations remotas

```bash
supabase migration list --project-ref jsjsmuncfkbsbzqzqhfq
```

Confirma quais migrations já foram aplicadas em prod.

### 2. Dry-run (preview)

```bash
supabase db diff --linked --project-ref jsjsmuncfkbsbzqzqhfq \
  --schema public --use-migra
```

### 3. Apply

```bash
supabase db push --linked --project-ref jsjsmuncfkbsbzqzqhfq
```

Output esperado:
```
Applying migration 20YYMMDDHHMMSS_<slug>.sql...
Migration applied successfully.
```

### 4. Verificar

```bash
supabase migration list --project-ref jsjsmuncfkbsbzqzqhfq | tail
```

Última migration deve aparecer.

### 5. Regen types

Ver [[regenerar-types-supabase]].

### 6. Smoke test

- Query nova tabela via Supabase Studio
- Testar endpoint dependente via curl ou app
- Sentry monitor por 30min

### 7. Atualizar changelog

`07 — Changelog/YYYY-MM-DD-migration-<slug>.md` documentando apply em prod.

## Rollback

Migration aplicada → criar **migration de revert** (nunca editar a que rodou):

```bash
# Cria nova migration que desfaz
supabase migration new revert_<slug>
# Editar arquivo gerado com DROP/ALTER reverso
supabase db push --linked --project-ref jsjsmuncfkbsbzqzqhfq
```

Para revert urgente de incidente:
1. Comunicar #incidents
2. CTO autoriza revert
3. Criar migration revert + apply

## Gotchas

- **Nunca editar migration que já rodou.** Cria divergência history.
- **`supabase db reset`** apaga dados em dev. NUNCA em prod.
- **Triggers que modificam dados** podem alterar dados existentes silenciosamente.
- **`ADD COLUMN NOT NULL` sem default** falha em tabela com dados. Use default
  ou 2-phase migration (add nullable → backfill → set not null).
- **Long-running migrations** (CREATE INDEX em tabela grande) podem lockar.
  Use `CREATE INDEX CONCURRENTLY`.
- **322+ migrations** acumuladas. Histórico longo, performance OK até agora.

## Backup pré-apply (recomendado pra prod sensível)

```bash
# Via Supabase Dashboard: Database → Backups → Create
# OU via pg_dump local:
pg_dump "$DB_URL" > backup-$(date +%F).sql
```

Backup automático Supabase: diário, retém 7 dias (verificar plano).

## Aprovação CTO — registro

Toda apply em prod precisa ser registrada:
- Em `07 — Changelog/YYYY-MM-DD-*.md`
- Com timestamp UTC, hash da migration, autorizador

Exemplo:
```markdown
## Deploy
- DEV apply: 2026-05-12 14:00 UTC
- PROD apply: 2026-05-15 11:30 UTC (autorizado por Gabriel na sessão)
```
