---
status: accepted
date: 2026-05-22
deciders: CTO
tags: [pipelines, leads, db-trigger, multi-tenant]
---

# ADR-2026-05-22 — Auto-assign lead default pipe via CONSTRAINT TRIGGER DEFERRED

## Contexto

Leads criados sem `place_in_pipe` (UI manual, importações antigas, edge cases) ficavam órfãos — sem entry em `pipeline_entries` nem em `custom_pipe_entries`. Resultado: invisíveis no Kanban do funil WhatsApp, sem entrar em workflows que dependem do estágio `novo`, sem aparecer em listas de "novos leads".

Caso real disparador: lead "GIOVANNE MENEGOTTO" (org Bella Itália) criado via UI manual em 2026-05 — entrou no banco mas nunca apareceu no funil WhatsApp porque o caller não inseriu `pipeline_entries`.

Soluções avaliadas:

1. **Fix em cada caller** (UI manual, lead-webhook, imports, edge functions...). Frágil: novo caller → novo bug. Rejeitado.
2. **Trigger BEFORE INSERT em leads + WHERE NOT EXISTS** — não funciona, lead acabou de ser criado; ainda não dá pra saber se um caller vai inserir pipeline_entries depois.
3. **Trigger AFTER INSERT (imediato)** — dispararia antes do `lead-webhook` inserir manualmente em `pipeline_entries`, causando race/duplicação.
4. **CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED** — roda no COMMIT, depois de todos os INSERTs explícitos da mesma tx. Único momento em que o estado final da tx é observável. **Escolhido.**

## Decisão

Migration `supabase/migrations/20260522120000_auto_assign_lead_default_pipe.sql`:

- Função `public.fn_auto_assign_lead_default_pipe()`:
  - `SECURITY DEFINER` (bypassa RLS em `pipeline_entries`/`pipelines`/`pipeline_stages`/`custom_pipe_entries`).
  - `SET search_path = public, pg_temp` (defesa contra search_path hijack, regra Supabase).
  - Lógica:
    1. EXISTS pipeline_entries(lead_id=NEW.id) → RETURN
    2. EXISTS custom_pipe_entries(lead_id=NEW.id) → RETURN
    3. SELECT pipelines WHERE org=NEW.org AND type='system' AND slug='whatsapp' AND is_active → se NULL, RETURN
    4. EXISTS pipeline_stages(org=NEW.org, pipeline_type='whatsapp', stage_key='novo', is_active=true) → se NÃO, RETURN
    5. INSERT pipeline_entries(stage_key='novo', entered_at=NOW(), stage_changed_at=NOW())

- Trigger `trg_auto_assign_lead_default_pipe`:
  - `CREATE CONSTRAINT TRIGGER ... AFTER INSERT ON public.leads ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`.
  - Multi-tenancy: usa `NEW.organization_id` exclusivamente.

## Por que DEFERRED em vez de IMMEDIATE

O `lead-webhook` (e qualquer caller que insere o lead + `pipeline_entries` em sequência) opera assim hoje:

```ts
// supabase-js usa HTTP separadas — cada chamada = tx isolada
await supabase.from('leads').insert(...);          // tx1 commit
await upsertPipeEntry(...);                         // tx2 commit
```

Mesmo nessa topologia, o trigger ainda é **idempotente**:

- No COMMIT de tx1, pipeline_entries está vazio → trigger insere whatsapp/novo.
- Em tx2, `upsertPipeEntry` faz SELECT + UPDATE (atualiza para stage solicitado se diferente) ou INSERT se ainda não existir. Como já existe (pela trigger), faz UPDATE — sem duplicação.

Para callers que **inserem na mesma tx** (Postgres direto, scripts pgTAP, migrations de backfill futuras), o DEFERRED resolve a race ao executar a trigger somente quando a tx vai commitar — momento em que o `EXISTS` já vê os inserts explícitos.

## Não-backfill

A migration **não** popula leads órfãos existentes. Decisão CTO: rebackfill seria semanticamente perigoso (leads desativados, perdidos, antigos podem aparecer no Kanban "novo" sem contexto). Só novos leads.

## Skip silencioso

Quando a org não tem pipeline whatsapp `system` ativo **ou** não tem stage `novo` ativo, o trigger retorna sem erro. Isso preserva:

- Orgs em onboarding (que ainda não rodaram o seed de pipelines).
- Orgs custom que removeram explicitamente o pipeline whatsapp do sistema.
- Operações administrativas que recriam pipelines temporariamente.

## Multi-tenancy / segurança

- `NEW.organization_id` nunca cruza orgs.
- `SECURITY DEFINER` é o único caminho para escrever em `pipeline_entries` sem JWT, pois service_role já bypassa, mas chamadas via REST authed dependem do contexto. A função pode rodar sob qualquer role.
- `search_path = public, pg_temp` impede shadowing de tabelas via search_path hijack.

## Consequências

### Positivo

- Zero caller precisa lembrar de inserir `pipeline_entries`.
- Compatível com `lead-webhook` e `place_in_pipe` sem mudança no caller (DEFERRED + EXISTS check).
- Idempotente — re-aplicar a migration via `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS` é safe.
- Cobertura imediata para edge cases (UI manual, imports antigos).

### Negativo / dívida

- Mais um trigger em `leads` (já há vários). Time-de-COMMIT está mais carregado.
- Se algum caller futuro **quer** lead órfão (caso de uso exótico: lead-stub, lead-archive), terá que inserir uma row "sentinel" em pipeline_entries também — não há flag para suprimir.
- Trigger SECURITY DEFINER → atenção: qualquer mudança futura precisa preservar `search_path` + tenant guard.

## Alternativas descartadas

- **Backfill global** — semanticamente perigoso (ver acima).
- **Trigger IMMEDIATE** — race com lead-webhook (insere lead, depois pipeline_entries). DEFERRED resolve sem code change no caller.
- **Default em `pipeline_entries`** — não existe DDL pra "criar row em outra tabela ao default".
- **Job background** — adiciona latência (lead não aparece no Kanban até job rodar). Pior UX.

## Implementação

| Item | Path |
|---|---|
| Migration | `supabase/migrations/20260522120000_auto_assign_lead_default_pipe.sql` |
| Função | `public.fn_auto_assign_lead_default_pipe()` |
| Trigger | `trg_auto_assign_lead_default_pipe` em `public.leads` (CONSTRAINT, DEFERRABLE INITIALLY DEFERRED) |
| Tests | `tests/integration/auto-assign-lead-default-pipe.test.ts` |
| Feature doc | [Pipelines Auto-assign](../06%20—%20Features/Vendas/pipelines-auto-assign.md) |

## Apply log

- 2026-05-22 — Aplicado em dev (`bcfadphgsibjzivtbjvc`) via Management API.
- Prod — pendente autorização explícita do CTO.

## Referências

- [Multi-tenancy](../02%20—%20Arquitetura/Multi-tenancy.md)
- [Lead Card](../06%20—%20Features/Vendas/Lead%20Card.md)
- PostgreSQL docs — [CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html) (CONSTRAINT TRIGGER, DEFERRABLE)
