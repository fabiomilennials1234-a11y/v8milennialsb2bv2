---
type: feature
domain: vendas
status: superseded
created: 2026-05-22
updated: 2026-05-22
owner: backend
related:
  - "[[ADR-2026-05-22-auto-assign-lead-default-pipe]]"
tags: [pipelines, leads, db-trigger]
---

# Pipelines — Auto-assign default (whatsapp/novo)

> [!warning] SUPERADO (SCRUM-641, 2026-09-03)
> O trigger descrito aqui **não existe em prod** (medido: nenhum trigger de
> `leads` insere em `pipeline_entries`). O fallback vigente é outro: porta de
> entrada sem destino declarado semeia no **funil padrão da org**
> (`organizations.default_pipeline_id`, SCRUM-624/D4), e org nova nasce com o
> "Funil de Vendas" como padrão (`trg_seed_default_funnel`, 20270918000000).
> Os slugs `whatsapp`/`novo` abaixo são história, não referência.

## O que é

Garantia de banco de que **todo lead criado** termina com pelo menos uma entrada
em `pipeline_entries`. Se nenhum caller (lead-webhook, UI manual, importação,
script) tiver inserido em `pipeline_entries` ou `custom_pipe_entries` até o
COMMIT da transação, um trigger automaticamente cria a entry em
`pipelines(slug='whatsapp', type='system') / stage_key='novo'`.

Objetivo: matar a classe inteira de bug "lead órfão" — lead invisível no Kanban
do funil padrão, fora de workflows que dependem do estágio inicial.

## Como funciona

### Trigger DEFERRED

- Arquivo: `supabase/migrations/20260522120000_auto_assign_lead_default_pipe.sql`
- Trigger `trg_auto_assign_lead_default_pipe` em `public.leads`:
  - `CREATE CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`.
  - Roda **no COMMIT** da transação, não imediatamente.
  - Isso permite que callers que inserem `pipeline_entries` na mesma tx (ex:
    futuros scripts pgTAP/admin) não disparem duplicação — o `EXISTS` enxerga
    os inserts já feitos.

### Função `fn_auto_assign_lead_default_pipe()`

- `SECURITY DEFINER` — necessário para bypassar RLS em `pipeline_entries`/
  `pipelines`/`pipeline_stages`/`custom_pipe_entries`.
- `SET search_path = public, pg_temp` — defesa contra search_path hijack
  (regra Supabase para todo SECURITY DEFINER).

### Lógica

```
1. EXISTS pipeline_entries(lead_id=NEW.id)? → RETURN NULL
2. EXISTS custom_pipe_entries(lead_id=NEW.id)? → RETURN NULL
3. pipelines(org=NEW.org, type='system', slug='whatsapp', is_active=true) — NULL? → RETURN NULL
4. pipeline_stages(org=NEW.org, pipeline_type='whatsapp', stage_key='novo', is_active=true) — não existe? → RETURN NULL
5. INSERT pipeline_entries (org, pipeline_id, lead_id, stage_key='novo', entered_at=NOW(), stage_changed_at=NOW())
```

## Regras de negócio

- **Não faz backfill.** Leads existentes órfãos antes da migration permanecem
  como estão. Decisão CTO — rebackfill global poderia trazer leads
  desativados/perdidos de volta ao Kanban "novo".
- **Skip silencioso** quando a org não tem o pipeline whatsapp `system` ativo
  OU não tem stage `novo` ativo. Sem erro, sem log de warning. Razão:
  permite orgs em onboarding (ainda sem seed de pipelines) e orgs custom que
  removeram o pipeline whatsapp do sistema.
- **Multi-tenancy:** usa `NEW.organization_id` exclusivamente. Nunca cruza orgs.

## Edge cases

| Cenário | Comportamento |
|---|---|
| Lead INSERT direto (UI manual) | Trigger cria whatsapp/novo no COMMIT. |
| Lead-webhook sem `place_in_pipe` | Caller chama `upsertPipeEntry(whatsapp/novo)` em tx separada. Trigger já populou no COMMIT do lead INSERT; `upsertPipeEntry` faz UPDATE (no-op). |
| Lead-webhook com `place_in_pipe={pipe:'whatsapp', stage:'abordado'}` | Trigger insere whatsapp/novo na tx do lead INSERT; depois `upsertPipeEntry` faz UPDATE de stage_key para 'abordado'. Resultado final: stage='abordado'. |
| Lead INSERT + INSERT pipeline_entries(abordado) na MESMA tx | DEFERRED → trigger vê EXISTS → no-op. Única entry = abordado. |
| Lead INSERT + INSERT custom_pipe_entries na MESMA tx | Trigger vê EXISTS custom_pipe_entries → no-op. Sem entry em pipeline_entries. |
| Org sem pipeline whatsapp system | Lead criado, sem entry. Sem erro. |
| Org com pipeline whatsapp mas sem stage 'novo' ativo | Lead criado, sem entry. Sem erro. |

## Áreas frágeis

- Trigger SECURITY DEFINER → toda alteração futura na função precisa preservar
  `search_path = public, pg_temp` e o guard de tenant (`NEW.organization_id`).
- Se um caller futuro **precisar** de lead sem nenhum pipe (caso exótico:
  lead-archive, lead-stub), terá que inserir uma row "sentinel" em
  `pipeline_entries` antes do COMMIT. Não há flag para suprimir.
- A migration usa `DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION` →
  re-aplicar é safe, mas ainda **imutável após apply em prod**. Mudanças
  futuras = migration nova.

## Histórico

- **2026-05-22** — Migration criada, aplicada em dev (`bcfadphgsibjzivtbjvc`).
  ADR [[ADR-2026-05-22-auto-assign-lead-default-pipe]]. Prod pendente.
