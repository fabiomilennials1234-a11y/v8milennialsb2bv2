# CLAUDE.md — `supabase/migrations/`

322+ migrations. Source of truth do schema. **Imutáveis após apply.**

> Procedimento de apply: ver
> [`Obsidian/.../05 — How-to/aplicar-migration-prod.md`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/05%20—%20How-to/aplicar-migration-prod.md).

## Ambiente de validação — branch do Supabase

**Criar com `./scripts/supabase-branch.sh criar <nome>`. Nunca `supabase branches create` puro.**

Medido e reproduzido em duas branches independentes (2026-08-20): o provisionamento do Supabase roda a
própria migração, **falha**, e deixa **3 linhas fantasma** em `supabase_migrations.schema_migrations` —
migrations marcadas como aplicadas que não criaram objeto nenhum. É isso que produz o status
`MIGRATIONS_FAILED` que a branch `main` carrega desde 2026-03-11.

Um `db push` depois disso lê o ledger, conclui que o baseline já rodou, começa na 4ª migration e morre
com `relation "public.sale_events" does not exist`. **Retry não resolve** — o ledger continua mentindo.

O baseline e a cadeia estão **corretos**: com o ledger zerado, as 129 migrations aplicam de ponta a ponta
(293 tabelas). O script apaga as linhas fantasma antes do push.

Branch de preview é projeto separado e **custa por hora**. Derrubar ao terminar:
`./scripts/supabase-branch.sh derrubar <ref>`.

## Regras invioláveis

1. **Nunca editar migration que já rodou.** Criar nova de revert se precisa.
2. **RLS obrigatória em tabelas com `organization_id`.** Migration que cria
   tabela sem RLS → review reprova.
3. **`organization_id` em toda tabela com dados de cliente.** Não negociável.
4. **`ENABLE ROW LEVEL SECURITY` + policies tenant_isolation_*** no create.
5. **`WITH CHECK` em UPDATE/INSERT policies.** Sem isso → escalada de privilégio.
6. **Apply em prod só com autorização CTO explícita** na sessão.

## Lint de métricas (ADR-0017) — bloqueante no CI

`scripts/check-metric-antipatterns.sh` reprova migration NOVA com os anti-padrões
que causaram as 24 inconsistências da auditoria 2026-07-02:

1. **`type = 'system'` como filtro** — cega custom pipelines. Parametrize por `pipeline_id`.
2. **`COALESCE` encadeando 2+ chaves de atribuição** (`sale_responsible_id`, `closer_id`,
   `sdr_id`, ...) — gera `SUM(membro) ≠ total`. Use 1 chave canônica por papel; snapshot no evento.
3. **`updated_at` como âncora temporal** — qualquer touch move a venda de mês.
   Use a data gravada no evento (`sold_at`/`occurred_at`).
4. **`SUM` de receita fora de `sale_events`** — receita só do caderno, líquida de estornos.

Backlog congelado em `scripts/metric-antipatterns-baseline.txt` (ratchet — só diminui).
Exceção deliberada (ex.: migração de dados one-off): sufixo `-- metric-lint-allow: <motivo>`
na linha. Contexto completo: `docs/adr/0017-event-sourced-sales-and-stage-metrics.md`.

## Naming

```
YYYYMMDDHHMMSS_<slug-kebab>.sql
```

Examples:
```
20261012000000_whatsapp_webhook_dlq.sql
20261012000001_schedule_whatsapp_dlq_replay.sql
20261018000000_portfolio_rpcs.sql
```

Slug deve indicar **o quê** muda, não como.

## Template — tabela nova multi-tenant

```sql
-- 20YYMMDDHHMMSS_<slug>.sql

CREATE TABLE public.<table> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- campos específicos
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX idx_<table>_organization_id ON public.<table>(organization_id);

ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON public.<table>
  FOR SELECT USING (organization_id = auth.org_id());

CREATE POLICY "tenant_isolation_all" ON public.<table>
  FOR ALL
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
```

## Template — schedule cron job

```sql
-- 20YYMMDDHHMMSS_schedule_<jobname>.sql

SELECT cron.schedule(
  '<jobname>',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/<fn-name>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Ver [`03 — Reference/Cron Jobs`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/03%20—%20Reference/Cron%20Jobs.md).

## Gotchas

- **`ADD COLUMN NOT NULL` sem default** falha em tabela com dados. Use
  2-phase: add nullable → backfill → set not null.
- **`CREATE INDEX`** em tabela grande lockeia writes. Use `CONCURRENTLY`.
- **`auth.org_id()` retorna NULL pra service_role.** Filtrar manual em cron.
- **Triggers** podem alterar dados existentes silenciosamente. Documentar.
- **DROP COLUMN é irreversível** sem backup. Aprovação CTO explícita.
- **Functions `SECURITY DEFINER` bypassam RLS.** Validar role/org dentro.

## Listar migrations aplicadas

```bash
supabase migration list --project-ref jsjsmuncfkbsbzqzqhfq   # prod
```

⚠️ **Compare o nome do arquivo com a versão gravada no ledger.** Aplicar em prod
grava a versão do momento, que pode não bater com o prefixo do arquivo — e como o
repo usa prefixos `2027` fictícios, a versão real (`2026…`) ordena ABAIXO delas.
Divergiu, é drift: registre no PR e **não reaplique achando que falta**.

## Apply

```bash
# Prod — SÓ COM AUTORIZAÇÃO CTO
supabase db push --linked --project-ref jsjsmuncfkbsbzqzqhfq
```

Dev foi **aposentado** em 2026-07-22. O alvo de validação é branch efêmera a partir
de prod — hoje **bloqueada** até o baseline das migrations. Ver `CLAUDE.md` raiz
§ Ambientes. Sem ambiente, mudança de risco vai pra prod com rollback capturado e
testado ANTES da escrita, e baseline medido no alvo.

## Regen types após apply

Ver [`05 — How-to/regenerar-types-supabase`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/05%20—%20How-to/regenerar-types-supabase.md).

```bash
supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
```

## Migration de revert

```bash
supabase migration new revert_<slug>
# Editar arquivo gerado com DROP/ALTER reverso
supabase db push --linked --project-ref <ref>
```

## Testes RLS — obrigatório

Tabela nova → criar `tests/integration/rls-<tabela>.test.ts`:
- User org A lê org A → OK
- User org A lê org B → 0 rows
- User org A insere com `organization_id = B` → fail
- Master cross-org → OK (se aplicável)

## Histórico recente notável

- `20261012*` — WhatsApp stability batch (DLQ, watchdog, health, received_via)
- `20261018000000_portfolio_rpcs.sql` — RPCs carteira
- Migration consolidation 2026-05-12 — overload cleanup

## Áreas frágeis

- Migrations envolvendo `auth.users`, `whatsapp_instance_secrets` (RLS deny-all),
  `master_audit_log` exigem review extra.
- Migrations com triggers que alteram dados — documentar invariantes preservadas.
