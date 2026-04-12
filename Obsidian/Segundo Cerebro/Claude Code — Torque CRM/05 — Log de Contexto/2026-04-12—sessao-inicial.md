---
tags:
  - claude-code
  - log
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Sessao Inicial — 2026-04-12

## Resumo

Primeira varredura completa do projeto Torque CRM para construir o segundo cerebro no Obsidian. Nenhuma alteracao de codigo foi feita — apenas leitura e documentacao.

## O que foi descoberto

### Dimensoes do projeto

| Metrica | Valor |
|---------|-------|
| Migrations SQL | 322 |
| Edge functions | 78+ |
| Shared modules | 33 |
| React hooks | 122+ |
| Pages | 46+ |
| Component categories | 46+ |
| UI primitives (shadcn) | 54 |
| Cron jobs (pg_cron) | 17 |
| Utility files (lib/) | 31 |
| Test files total | 37+ |
| Docs files | 64 |
| Contexts | 3 |
| Integracoes externas | 9+ |

### Ultimas migrations (mais recentes)

As 9 mais recentes (20260910*) implementam **quotas por org** com modelo delta:
- `create_org_quotas` → `seed_org_quotas` → RPCs de enforcement → `update_features_limits_rpc`

### Integracao mais nova documentada

Quota system (org-level enforcement) e o commit mais recente significativo:
```
30c8ee0 feat(quotas): org-level quota enforcement with delta model
```

## Arquivos lidos nesta sessao

- `CLAUDE.md` (raiz)
- `CLAUDE.md` (global do usuario)
- `package.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- `.env.example`
- `supabase/config.toml` (via agent)
- `vite.config.ts` (via agent)
- `tailwind.config.ts` (via agent)
- Listagem de: `src/pages/`, `src/hooks/`, `src/components/`, `src/contexts/`, `src/lib/`, `src/types/`, `src/integrations/`
- Listagem de: `supabase/functions/`, `supabase/functions/_shared/`
- Listagem de: `docs/`, `tests/`, `.github/workflows/`
- Busca por pg_cron e pg_net em migrations (via agent)

## Notas criadas

| Nota | Pasta |
|------|-------|
| [[00 — INDEX]] | raiz |
| [[Permissoes]] | 01 — Identidade |
| [[Comportamentos]] | 01 — Identidade |
| [[Visao Geral]] | 02 — Arquitetura |
| [[Modulos]] | 02 — Arquitetura |
| [[Integracoes]] | 02 — Arquitetura |
| [[Scripts e Comandos]] | 03 — Operacional |
| [[Fluxos de Trabalho]] | 03 — Operacional |
| [[Limitacoes]] | 03 — Operacional |
| [[ADR-2026-04-12-arquitetura-inicial]] | 04 — Decisoes |
| [[2026-04-12—sessao-inicial]] | 05 — Log de Contexto |

## Incertezas registradas

- `webhook-calcom`: existe em edge functions mas NAO documentado no CLAUDE.md — status incerto
- `cadastro-externo-push`: edge function nao documentada — pode ser feature em progresso
- `stream-media`: edge function sem documentacao — provavel streaming de audio/media
- `semi-automatic-dispatch`: edge function sem contexto claro
- Integracao Cal.com: ativa ou experimental?

## Proximos passos sugeridos

1. Confirmar status das edge functions nao documentadas
2. Mapear data model completo (tabelas e relacoes)
3. Documentar fluxos de workflow (DAG) com mais detalhe
4. Adicionar notas sobre o sistema de campanhas

## Links relacionados

- [[00 — INDEX]]

## Notas do agente

> Esta sessao foi puramente de leitura. Nenhum arquivo do projeto foi modificado.
> Total de 11 notas criadas no vault Obsidian.
