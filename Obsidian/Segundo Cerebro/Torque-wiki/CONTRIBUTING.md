---
tags:
  - meta
  - policy
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# Como contribuir para o vault

Politica de manutencao da documentacao. Leia antes de criar, editar ou apagar docs.

## Filosofia

**Doc nao pode mentir.** Tudo que pode ser derivado do codigo (contagens, paths, nomes) e auto-gerado. O vault guarda apenas o que o codigo nao expressa: **intent, trade-offs, runbooks, fluxo de negocio**.

Se a resposta cabe em um `grep`, nao escreva em doc. Se e "por que", documente.

## Fluxo obrigatorio

1. **Mudou feature ou arquitetura?** Atualize o doc correspondente no mesmo PR.
2. **PR sem atualizacao de doc relevante reprova em review.**
3. **Rode `npm run docs:sync` antes de commitar** — atualiza blocos auto-gerados e contagens.
4. **CI roda `npm run docs:check`** — bloqueia merge se contagens estao stale.

## Anatomia de um doc de feature

```markdown
---
feature: pipe-whatsapp
owner: @gabriel
status: active | deprecated
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
last_verified: YYYY-MM-DD
source_of_truth:
  - src/pages/PipeWhatsapp.tsx
  - src/hooks/usePipeWhatsapp.ts
  - supabase/migrations/*pipe_whatsapp*.sql
---

## O que e (business intent)
Por que existe, quem usa, qual problema resolve. 2-4 paragrafos.

## Como funciona (LINKS, nao copias)
- Pagina: [PipeWhatsapp.tsx](path)
- Hook principal: [usePipeWhatsapp.ts](path)

## Decisoes nao obvias
Por que status e string e nao enum. Por que nao usa realtime aqui.

## Runbook
Como debugar. Rollback. Feature flags.

## Gotchas conhecidos
Edge cases, bugs recorrentes, armadilhas historicas.
```

## Blocos auto-gerados

Qualquer trecho que contem contagens ou listas derivaveis do codigo deve estar entre marcadores:

```markdown
<!-- auto:CHAVE:start -->
...conteudo gerado pelo script...
<!-- auto:CHAVE:end -->
```

Ex: `CHAVE = counts` gera as contagens de pages, hooks, edge functions, migrations.

Chaves disponiveis hoje: `counts`. Adicione novas em `scripts/docs-sync.mjs`.

**Nunca edite conteudo dentro desses marcadores manualmente** — sera sobrescrito.

## Anti-padroes — NAO FACA

- **Paths absolutos de maquina local** (`/Volumes/...`, `C:/Users/...`). Sempre relativo a raiz do repo.
- **Listas manuais que contam coisas** ("46+ pages", "122 hooks"). Use `<!-- auto:counts -->` ou remova.
- **Snippets de codigo copiados do src/**. Derivam em semanas. Prefira **link** para o arquivo real (`src/hooks/useLeads.ts:42`).
- **Docs com titulos genericos e redundantes** ("Solucao Rapida", "Solucao Definitiva", "Implementacao Completa"). Substitui, nao acumula — delete os antigos quando escrever um novo.
- **ADRs sem status** (Aceita / Obsoleta / Substituida por X). Sem status = ruido.
- **Duplicar conteudo entre docs**. Escolha o canonical e linke os outros.
- **Remover docs silenciosamente**. Se deleta feature, deleta o doc no mesmo commit.

## Freshness

- Frontmatter deve ter `last_verified: YYYY-MM-DD`.
- Auditoria mensal leve: pegue 5 docs aleatorios e confirme que continuam corretos.
- Docs nao atualizados ha >60 dias recebem tag `#stale` ate serem revistos.

## Source of truth por tipo

| Tipo de info | Onde vive | Nao duplique em |
|---|---|---|
| Versoes de dependencias | `package.json` | docs |
| Schema de tabela | `supabase/migrations/` | docs (linke) |
| Lista de hooks | `src/hooks/` | docs (auto-gen) |
| Lista de edge functions | `supabase/functions/` | docs (auto-gen) |
| Assinatura de funcao | codigo | docs |
| Por que a decisao X | ADR no vault | qualquer outro lugar |
| Runbook de debug | vault | codigo |
| Fluxo de negocio | vault | codigo |

## Dois comandos para lembrar

```bash
npm run docs:sync   # atualiza blocos auto-gerados antes de commitar
npm run docs:check  # valida que docs estao em dia (roda no CI)
```

## Quando em duvida

Se a doc que voce quer escrever pode ser respondida lendo 1 arquivo de codigo, **nao escreva**. Linke o arquivo e volte a ajudar um cliente.
