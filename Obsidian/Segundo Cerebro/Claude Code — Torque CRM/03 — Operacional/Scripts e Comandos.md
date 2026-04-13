---
tags:
  - claude-code
  - operacional
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Scripts e Comandos

## Resumo

Todos os comandos uteis para desenvolvimento, testes, deploy e debugging do Torque CRM. Inclui npm scripts, supabase CLI, e comandos de infra.

## npm scripts (package.json)

| Comando | Descricao |
|---------|-----------|
| `npm run dev` | Dev server Vite em `localhost:8080` |
| `npm run build` | Build de producao (esbuild, sem console/debugger) |
| `npm run build:dev` | Build modo desenvolvimento |
| `npm run lint` | ESLint |
| `npm run preview` | Preview do build local |
| `npm run test` | Vitest (watch mode) |
| `npm run test:run` | Vitest (run once) |
| `npm run test:unit` | Testes unitarios (`tests/unit/`) verbose |
| `npm run test:integration` | Testes integracao (`tests/integration/`) verbose |
| `npm run test:e2e` | Playwright E2E (Chromium) |
| `npm run test:coverage` | Coverage dos testes unitarios (v8) |
| `npm run test:all` | Unit + Integration + E2E sequencial |

## Supabase CLI

### Deploy de edge functions

```bash
# Producao
supabase functions deploy <nome> --project-ref jsjsmuncfkbsbzqzqhfq

# Development
supabase functions deploy <nome> --project-ref bcfadphgsibjzivtbjvc
```

> [!danger] JWT Trap
> NAO usar `--no-verify-jwt`. Use `verify_jwt = false` no `supabase/config.toml`.
> Cuidado: `--no-verify-jwt=false` HABILITA JWT (double negative).

### Logs

```bash
# Logs em tempo real (producao)
supabase functions logs <nome> --project-ref jsjsmuncfkbsbzqzqhfq

# Logs tambem salvos em runtime_logs via logger.ts
```

### Tipos TypeScript

```bash
# Regenerar tipos auto-gerados
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
```

### Supabase local

```bash
supabase start          # Inicia containers locais
supabase stop           # Para containers
supabase db push        # Aplica migrations pendentes
supabase db reset       # Reset completo do banco local

# Servir edge function local
supabase functions serve <nome> --env-file .env.local
# Teste: curl http://localhost:54321/functions/v1/<nome>
```

### API keys

```bash
supabase projects api-keys --project-ref jsjsmuncfkbsbzqzqhfq
```

## Git

```bash
git add <files>
git checkout <branch>
git merge <branch>
git push origin main    # Trigger deploy via EasyPanel
```

> [!note] Deploy automatico
> Push para `main` dispara build Docker → deploy no EasyPanel (Hostinger VPS).

## Verificar dados no banco (producao)

```bash
curl "https://jsjsmuncfkbsbzqzqhfq.supabase.co/rest/v1/leads?select=id,name&limit=5" \
  -H "apikey: SERVICE_KEY" \
  -H "Authorization: Bearer SERVICE_KEY"
```

## CI/CD (GitHub Actions)

Pipelines em `.github/workflows/`:

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `test.yml` | Push main/develop | unit-tests, integration-tests, e2e-tests |
| `docker-image.yml` | Push main | Build Docker (Node 20 + Nginx) |

Sequencia CI:
1. `unit-tests` — Vitest
2. `integration-tests` — Vitest + Supabase local (auto `supabase start`)
3. `e2e-tests` — Playwright + Chromium
4. `docker-image` — Build Docker image

## Testes

### Estrutura

```
tests/
├── e2e/              # 5 specs Playwright
│   ├── 01-login-navigation.spec.ts
│   ├── 02-create-move-lead.spec.ts
│   ├── 03-import-leads.spec.ts
│   ├── 04-workflow-basic.spec.ts
│   └── 05-operations-center.spec.ts
├── integration/      # 14 testes (precisa Supabase local)
│   ├── permission-engine.test.ts
│   ├── rls-org-isolation.test.ts
│   ├── rls-role-based.test.ts
│   ├── org-quota-enforcement.test.ts
│   └── ...
└── unit/             # 18 testes
    ├── permissions.test.ts
    ├── normalize-phone.test.ts
    ├── auth-context.test.ts
    └── ...
```

### Requisitos

- **Unit**: Roda standalone
- **Integration**: Precisa `supabase start` (banco local)
- **E2E**: Precisa app rodando (`npm run dev`) + Playwright instalado

## Links relacionados

- [[Permissoes]]
- [[Fluxos de Trabalho]]
- [[Visao Geral]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: `package.json`, `CLAUDE.md`, `.github/workflows/`, `supabase/config.toml`.
> Testes de integracao no CI iniciam Supabase local automaticamente.
