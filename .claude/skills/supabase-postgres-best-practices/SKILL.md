---
name: supabase-postgres-best-practices
description: PostgreSQL best practices for Supabase — RLS policies, migrations, indexing, query optimization, pg_cron, and multi-tenancy patterns. Used by agent-dba.
---

# Supabase PostgreSQL Best Practices — Torque CRM

Guia de best practices para modelagem, RLS, migrations, performance e automacao no PostgreSQL via Supabase. Usado pelo agent-dba como referencia de qualidade.

## Multi-tenancy via RLS

### Pattern padrao de policy

```sql
-- SELECT: usuario so ve dados da sua org
CREATE POLICY "org_isolation_select" ON tabela
  FOR SELECT USING (
    organization_id = (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- INSERT: usuario so insere na sua org
CREATE POLICY "org_isolation_insert" ON tabela
  FOR INSERT WITH CHECK (
    organization_id = (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- UPDATE: mesma logica
CREATE POLICY "org_isolation_update" ON tabela
  FOR UPDATE USING (
    organization_id = (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- DELETE: restrito a admins
CREATE POLICY "org_isolation_delete" ON tabela
  FOR DELETE USING (
    organization_id = (
      SELECT organization_id FROM team_members
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'master')
      LIMIT 1
    )
  );
```

### Performance de RLS

- SEMPRE indexar `organization_id` em toda tabela com RLS
- Usar `LIMIT 1` na subquery do `team_members`
- Considerar `security_invoker = true` em views
- Monitorar query plans — RLS adiciona subquery a cada operacao

### Service Role Bypass

Edge functions com `service_role` key bypasses RLS. Quando usar:

- Cron jobs (nao tem usuario autenticado)
- Webhooks externos (nao tem JWT)
- Operacoes cross-org (master admin)

**Regra critica**: Ao usar service_role, SEMPRE filtrar `organization_id` manualmente no codigo.

## Migrations

### Nomenclatura

```
YYYYMMDDHHMMSS_descricao_curta.sql
```

Exemplo: `20260413120000_add_lead_score_column.sql`

### Estrutura obrigatoria

```sql
-- Migration: descricao
-- Motivo: por que essa mudanca e necessaria

-- UP
ALTER TABLE leads ADD COLUMN qualification_score integer DEFAULT 0;
CREATE INDEX idx_leads_qualification_score ON leads(qualification_score) WHERE qualification_score > 0;

-- DOWN (comentado, pra referencia de rollback)
-- ALTER TABLE leads DROP COLUMN qualification_score;
-- DROP INDEX idx_leads_qualification_score;
```

### Zero Downtime

| Operacao | Safe? | Alternativa |
|----------|-------|-------------|
| ADD COLUMN (nullable) | Sim | - |
| ADD COLUMN (NOT NULL + default) | Sim (PG 11+) | - |
| DROP COLUMN | Perigoso | 1) Remover do codigo, 2) DROP na proxima migration |
| ALTER COLUMN TYPE | Perigoso | Criar coluna nova → migrar dados → renomear |
| CREATE INDEX | Bloqueante | `CREATE INDEX CONCURRENTLY` |
| ADD CONSTRAINT | Bloqueante | `NOT VALID` + `VALIDATE CONSTRAINT` separado |

### Data vs Schema Migrations

Separar SEMPRE:
- **Schema migration**: altera estrutura (DDL)
- **Data migration**: altera dados (DML)

Nunca misturar DDL e DML na mesma migration. Data migrations podem falhar e precisam de rollback independente.

## Indexing Strategy

### Quando criar index

- Coluna usada em WHERE com alta seletividade
- Coluna usada em JOIN
- Coluna usada em ORDER BY com LIMIT
- Foreign keys (Postgres NAO cria automaticamente)

### Quando NAO criar index

- Tabela pequena (< 1000 rows)
- Coluna com baixa cardinalidade (boolean, status com 3 valores)
- Tabela com muito mais escrita que leitura

### Tipos de index

```sql
-- B-tree (padrao, a maioria dos casos)
CREATE INDEX idx_leads_org ON leads(organization_id);

-- Partial (quando maioria dos dados nao importa)
CREATE INDEX idx_leads_active ON leads(organization_id)
  WHERE status != 'archived';

-- GIN (para jsonb, arrays, full-text)
CREATE INDEX idx_leads_metadata ON leads USING GIN(metadata);

-- Composite (queries com multiplas colunas no WHERE)
CREATE INDEX idx_leads_org_created ON leads(organization_id, created_at DESC);

-- Covering (include colunas que evitam heap lookup)
CREATE INDEX idx_leads_org_name ON leads(organization_id) INCLUDE (name, phone);
```

### EXPLAIN ANALYZE Obrigatorio

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM leads
WHERE organization_id = 'uuid'
AND created_at > now() - interval '30 days'
ORDER BY created_at DESC
LIMIT 50;
```

Red flags no plan:
- `Seq Scan` em tabela grande (falta index)
- `Nested Loop` com muitas rows (considerar hash join)
- `Sort` sem index (adicionar index com ORDER BY)
- `Rows Removed by Filter` muito alto (index parcial pode ajudar)

## pg_cron Patterns

### Criar job

```sql
SELECT cron.schedule(
  'process-webhook-deliveries',           -- nome unico
  '* * * * *',                            -- a cada minuto
  $$
  SELECT net.http_post(
    url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/process-webhook-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Monitorar jobs

```sql
-- Jobs agendados
SELECT * FROM cron.job ORDER BY jobname;

-- Execucoes recentes
SELECT * FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;

-- Jobs falhando
SELECT jobname, status, return_message, start_time
FROM cron.job_run_details
WHERE status = 'failed'
ORDER BY start_time DESC
LIMIT 10;
```

### Health check

- Verificar `cron.job_run_details` por falhas recorrentes
- Alertar se job nao executa ha > 5 minutos
- Monitorar tempo de execucao (jobs devem completar < 30s)

## Data Types

| Caso | Tipo correto | NAO usar |
|------|-------------|----------|
| Identificadores | `uuid` (gen_random_uuid()) | `serial`, `bigint` |
| Timestamps | `timestamptz` | `timestamp` (sem tz) |
| Dinheiro | `numeric(12,2)` | `float`, `money` |
| Status/enum | `text` + CHECK constraint | `enum` type (dificil de migrar) |
| JSON estruturado | Colunas tipadas | `jsonb` (exceto metadata flexivel) |
| Telefone | `text` | `varchar(20)` (formatos variam) |
| Email | `text` + CHECK (regex) | `varchar` |
| Booleano | `boolean` | `integer` (0/1) |

## Regras de Ouro

- NUNCA desligar RLS. Corrigir a policy, nao o enforcement
- NUNCA migration sem possibilidade de rollback
- NUNCA `SELECT *` em tabelas grandes — especificar colunas
- NUNCA index sem medir o impacto com EXPLAIN ANALYZE
- NUNCA `text` pra tudo — tipos existem pra proteger dados
- NUNCA `CASCADE` em DROP sem avaliar dependencias
- SEMPRE `organization_id` em toda tabela de negocio
- SEMPRE `created_at timestamptz DEFAULT now()` em toda tabela
- SEMPRE `updated_at` com trigger pra auto-update
- SEMPRE FK constraints — integridade referencial e inegociavel
- SEMPRE testar migrations no ambiente dev antes de produzir
- SEMPRE `CREATE INDEX CONCURRENTLY` em producao
