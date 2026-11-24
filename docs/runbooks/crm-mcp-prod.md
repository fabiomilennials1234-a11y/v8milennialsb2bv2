# crm-mcp em produção

MCP de cliente: cada usuário liga a própria IA ao CRM com um token pessoal. Decisões em
`docs/adr/0012-crm-mcp-customer-facing-pat.md` (leia a emenda de 2026-11-23). Tudo abaixo já
rodou numa preview com o mesmo formato de chaves de auth de prod; o que muda em prod está
marcado.

Projeto: `jsjsmuncfkbsbzqzqhfq`. Cada passo para se falhar. **Nada aqui roda sem
autorização explícita do CTO para produção.**

## 0. Antes

- PR mesclado em `main`. `git fetch` e confira que `20280124013100` e `20280124013200`
  continuam livres no ledger de prod. A corrida pelo número acontece entre escolher e
  aplicar:
  ```sql
  SELECT version, name FROM supabase_migrations.schema_migrations
   WHERE version IN ('20280124013100', '20280124013200');   -- esperado: 0 linhas
  ```
- `node scripts/crm-mcp-chave.mjs status jsjsmuncfkbsbzqzqhfq`. Em 2026-11-23 eram ES256
  `in_use` e HS256 **`standby`**.

## 1. Migrations (ordem importa)

> v2: `20280124013300_crm_mcp_escrita.sql` vem depois das duas abaixo (escopos, plano de uso
> único e auditoria). A escrita só existe em org com a flag `crm_mcp_write` — ligue por org,
> depois do `crm_mcp`.

1. `20280124013100_crm_mcp_tokens.sql`, depois `20280124013200_crm_mcp_lifecycle.sql`, pela
   Management API, cada uma registrada no ledger. **Confira a linha depois**: o INSERT no
   ledger falha em silêncio quando há colisão.
2. Verificação (Management API, leitura):
   ```sql
   SELECT pg_has_role('authenticator', 'crm_mcp_resolver', 'MEMBER')                       AS postgrest_assume,
          NOT has_function_privilege('anon', 'public.crm_mcp_authenticate(text)', 'EXECUTE') AS anon_fora,
          NOT has_function_privilege('authenticated', 'public.crm_mcp_authenticate(text)', 'EXECUTE') AS auth_fora,
          (SELECT count(*) FROM cron.job WHERE jobname = 'crm-mcp-housekeeping')            AS cron;
   -- esperado: t, t, t, 1
   ```

## 2. Chave de assinatura (mudança de auth do projeto)

```bash
node scripts/crm-mcp-chave.mjs provisionar jsjsmuncfkbsbzqzqhfq --liberar-standby --confirmo-producao
```

- `--liberar-standby` move o HS256 legado de `standby` para `previously_used`. Ele
  **continua verificando**: a chave anon e a service_role legadas seguem valendo (na preview a
  chave anon legada funciona com o HS256 em `previously_used`). Só deixa de ser candidato a
  rotação. Sem a flag, o script aborta, porque o projeto só tem um slot `standby` e o segundo
  dá 422.
- O script gera a ES256 em memória, importa, move para `previously_used`, grava
  `CRM_MCP_JWT_SIGNING_KEY`/`CRM_MCP_JWT_KID` e prova que o PostgREST aceita (200).
- Logo depois, confira que o app segue de pé: login no CRM e uma tela com dados.

⚠️ Essa chave forja qualquer papel, inclusive service_role. Ela existe só nos secrets do
projeto. Suspeita de vazamento: `node scripts/crm-mcp-chave.mjs revogar jsjsmuncfkbsbzqzqhfq <kid> --confirmo-producao`.
O efeito é imediato e foi medido na preview: 401 logo após revogar. Depois rode
`provisionar` de novo.

## 3. Deploy das funções

```bash
supabase functions deploy crm-mcp    --project-ref jsjsmuncfkbsbzqzqhfq --import-map supabase/functions/deno.json
supabase functions deploy create-pat --project-ref jsjsmuncfkbsbzqzqhfq --import-map supabase/functions/deno.json
```

Fumaça:
```bash
curl -s -i -X POST https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/crm-mcp -d '{}'
# esperado: 401 + WWW-Authenticate. 503 = falha de boot; o corpo diz o estágio
# (scrub/config/signing_key) e o nome da variável, nunca o valor.
```

## 4. Piloto

```sql
UPDATE organizations SET feature_flags = feature_flags || '{"crm_mcp": true}'::jsonb WHERE id = '<org piloto>';
```

A seção **Configurações › API & Webhooks › IA conectada (MCP)** aparece para a org. Crie um
token pela tela, conecte um cliente (o snippet do Claude Code é o mais rápido) e peça
"liste meus 5 leads mais recentes".

## 5. Desligar / voltar atrás

| Situação | Ação | Efeito |
|---|---|---|
| Uma org | flag `crm_mcp` = false | tokens da org recusados na próxima chamada (403 `org_disabled`) |
| Todos, já | `revogar <kid>` | todo JWT do crm-mcp para; tokens continuam no banco |
| Remover | `rollback/20280124013200…` e depois `rollback/20280124013100…` | apaga tokens, tabelas e o papel |

## Observação

- Uso por token: `personal_access_tokens.last_used_at` (carimbo de no máximo 1×/min).
- Recusas de token conhecido (revogado, expirado, org bloqueada, limite) ficam em
  `crm_mcp_auth_denials`. Token **revogado** que continua chegando significa vazamento:
  avise o dono.
- Cada `tools/call` gera uma linha JSON no log da função com `pat_id`, `org_id`, `tool`,
  `outcome` e `ms`.
- Limites: 120/min por token, 600/min e 20 000/dia por org. Estouro devolve 429 com
  `Retry-After`.
