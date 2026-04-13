---
tags:
  - claude-code
  - identidade
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Permissoes do Agente

## Resumo

Configuracoes de permissoes, MCPs e ferramentas disponiveis para o agente Claude Code neste projeto. Extraido de `.claude/settings.json`, `.claude/settings.local.json` e `CLAUDE.md`.

## Permissoes explicitas (settings.local.json)

### Allow list

```json
"allow": [
  "Bash(npx supabase functions deploy tinyerp-connect --no-verify-jwt)",
  "Bash(npx supabase functions logs tinyerp-sync-products --limit 30)",
  "Bash(npx vite:*)",
  "Bash(npx tsc:*)",
  "Bash(npx supabase:*)",
  "Bash(git add:*)",
  "Bash(git checkout:*)",
  "Bash(git merge:*)",
  "Bash(git push:*)",
  "Bash(supabase db:*)",
  "Bash(chmod +x scripts/test-summarize-conversation.sh)"
]
```

> [!note] Wildcards
> Entradas com `:*` permitem qualquer subcomando. Ex: `npx supabase:*` cobre `supabase functions deploy`, `supabase db push`, etc.

### Grep permissions (busca em migrations)

```json
"Bash(grep -l \"tinyerp\\\\|tiny_erp\" .../*.sql)",
"Bash(grep -r \"authentication\\\\|Authorization\\\\|RLS\\\\|Row Level Security\" .../*.sql)",
"Bash(grep -l \"upsell\\\\|meta\\\\|instagram\" .../*.sql)",
"Bash(grep -l \"CREATE TABLE\" .../*.sql)",
"Bash(grep -l \"outbound_dispatch_log\" *.sql)",
"Bash(grep -l 'trg_pipe_whatsapp_dispatch...' *.sql)",
"Bash(grep -l 'CREATE TYPE.*app_role' *.sql)",
"Bash(grep -l 'cron\\\\.' *.sql)"
```

## Deny list

Nenhuma regra de deny explicita encontrada em `settings.json` ou `settings.local.json`.

> [!warning] Ausencia de denys
> A falta de regras deny nao significa permissao total. O modelo de permissoes do Claude Code exige aprovacao do usuario para acoes nao listadas no allow.

## Plugins habilitados (settings.json)

```json
{
  "enabledPlugins": {
    "obsidian@obsidian-skills": true
  }
}
```

## MCPs configurados

Com base nos skills disponiveis e na configuracao do projeto:

| MCP | Proposito |
|-----|-----------|
| **Supabase** | Gerenciamento de banco, migrations, edge functions, SQL, types |
| **n8n** | Gerenciamento de workflows, nodes, templates, credenciais |
| **Playwright** | Automacao de browser para testes E2E |
| **Sentry** | Monitoramento de erros, debugging, triage |
| **Stripe** | Pagamentos, checkout (usado via Asaas no Brasil) |
| **Context7** | Documentacao atualizada de bibliotecas e frameworks |
| **Gmail** | Integracao email (autenticacao disponivel) |
| **Google Calendar** | Integracao calendario (autenticacao disponivel) |

## Diretorios acessiveis

O agente pode ler/escrever em todo o projeto:

```
/Volumes/Untitled/v8milennialsb2bv2-main/
├── src/           (frontend completo)
├── supabase/      (functions, migrations, config)
├── tests/         (unit, integration, e2e)
├── docs/          (documentacao)
├── services/      (google-calendar-service)
├── scripts/       (shell scripts)
├── Obsidian/      (vault do segundo cerebro)
└── .claude/       (configuracao do agente)
```

## Links relacionados

- [[Comportamentos]]
- [[Scripts e Comandos]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: `.claude/settings.json`, `.claude/settings.local.json`, lista de skills no sistema.
> Algumas permissoes de grep referenciam paths absolutos que incluem o mount point `/Volumes/Untitled/`.
