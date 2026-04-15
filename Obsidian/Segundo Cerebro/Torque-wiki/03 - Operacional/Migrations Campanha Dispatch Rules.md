---
tags:
  - torque-crm
  - supabase
  - operacional
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# Migrations: Regras de envio por etapa (campanha_dispatch_rules)

Este guia resolve o erro **"Could not find the table 'public.campanha_dispatch_rules' in the schema cache"**.

## Task 1: Aplicar ou verificar migrations

### 1.1 Verificar se as tabelas existem

- **Dashboard:** Database → Table Editor → procurar por `campanha_dispatch_rules`, `campanha_dispatch_rule_steps`, `scheduled_campaign_messages`.
- **SQL Editor:** Execute o script [scripts/verify_campanha_dispatch_tables.sql](scripts/verify_campanha_dispatch_tables.sql).
  - Deve retornar 3 linhas na primeira query (as três tabelas) e 1 linha na segunda (coluna `whatsapp_instance_id` em `campanhas`).

### 1.2 Se alguma tabela ou coluna estiver ausente, aplicar as migrations

**Opção A (recomendada)** - Supabase CLI, na raiz do repositório:

```bash
supabase link --project-ref twoghutcvlfgemadaeez   # se ainda não linkado
supabase db push
```

**Opção B** - Dashboard: Database → SQL Editor. Execute na ordem:

1. Conteúdo de `migrations/20260301000000_campanhas_whatsapp_instance_and_dispatch_rules.sql`
2. Conteúdo de `migrations/20260301010000_campanha_leads_dispatch_rules_trigger.sql`

### 1.3 Confirmar

Rode novamente [scripts/verify_campanha_dispatch_tables.sql](scripts/verify_campanha_dispatch_tables.sql). As três tabelas e a coluna devem existir.

---

## Task 2: Recarregar schema cache (se o erro persistir)

Após aplicar as migrations, o PostgREST (API do Supabase) costuma recarregar o schema automaticamente. Se o erro "schema cache" continuar:

- **Supabase Hosted:** No SQL Editor (como owner), execute:
  ```sql
  NOTIFY pgrst, 'reload schema';
  ```
  Ou em **Project Settings → API** verifique se há opção de reinício/reload.

- **Supabase local:**
  ```bash
  supabase stop
  supabase start
  ```

**Teste:** Requisição GET para `/rest/v1/campanha_dispatch_rules?select=id&limit=1` (com `apikey` e `Authorization` válidos) deve retornar 200 (ou array vazio), não 404.

---

## Task 3: Tipos TypeScript

Os tipos para `campanha_dispatch_rules`, `campanha_dispatch_rule_steps`, `scheduled_campaign_messages` e a coluna `whatsapp_instance_id` em `campanhas` já foram adicionados em `src/integrations/supabase/types.ts`.

Para regenerar todos os tipos a partir do projeto (após aplicar as migrations e com `supabase login`):

```bash
npx supabase gen types typescript --project-id twoghutcvlfgemadaeez > src/integrations/supabase/types.ts
```

---

## Task 4: RLS e permissoes

- **SELECT:** Qualquer usuário autenticado da organização pode listar regras.
- **INSERT/UPDATE/DELETE:** Exigem `is_user_admin()` (apenas administradores). O usuário "Chefe de Equipe" precisa ter role **admin** na organização para criar regras; caso contrário a UI exibe mensagem de permissão.


## Links relacionados

- [[MOC - Operacional]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Campanhas]]

- [[WhatsApp Evolution]]

- [[Supabase Setup]]
- [[00 - INDEX]]
