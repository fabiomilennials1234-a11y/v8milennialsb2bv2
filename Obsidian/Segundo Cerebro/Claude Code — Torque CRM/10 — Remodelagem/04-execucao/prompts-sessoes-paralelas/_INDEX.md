# Prompts — Sessões paralelas modularização

Criado 2026-05-28. Para abrir terminais paralelos e atacar as slices restantes da modularização sem conflito.

## Estado atual (2026-05-28)

- Slices 0-15 (frontend) mergeadas em `develop`. Slice 15 ficou **doc-only** (mapeamento BC, sem mover arquivos) — decisão definitiva, ver "Slice 15 real — descartada" abaixo.
- Slice 16 (cleanup longtail) em **PR #512** aberta contra `develop`. Aguardando merge.
- 3 slices restantes: 17, 19, 18.

## Dependência

```
  17  ──┐
        ├──► 18 (finalize)
  19  ──┘
```

- **Slice 17 e Slice 19 são independentes entre si** → podem rodar em terminais paralelos.
- Ambas dependem da Slice 16 já mergeada em `develop` (PR #512). Antes de cortar branch das duas, garantir `git pull origin develop` traz #512.
- **Slice 18 é sequencial** após as duas anteriores.

## Slice 15 real — descartada

A slice 15 doc-only (mapeamento de 96 edge functions por BC) é o **estado final** definitivo. Mover edge functions para `supabase/functions/<bc>/<fn>/` não é viável: Supabase CLI exige que cada edge function viva em `supabase/functions/<fn>/index.ts` **diretamente** (filho imediato de `functions/`). Subdiretórios não são deployáveis como funções separadas. Alternativas (rename com prefixo BC) implicam mudança de URL pública = quebra de cron jobs registrados em `cron_config`, webhooks externos, n8n integrations. Custo > benefício.

**Decisão**: edge functions ficam flat. Organização por BC é via sub-CLAUDE.md por função + nomenclatura por convenção (já documentada).

Atualizar SPEC para refletir essa decisão é tarefa da slice 17.

## Constraints invariantes (TODAS as slices abaixo)

1. **Zero impacto em produção.** Branch sai de `develop`. PR target = `develop`. **NUNCA** push em `main`. **NUNCA** merge em `main`.
2. **Zero mutação em prod DB.** Project ref de prod: `jsjsmuncfkbsbzqzqhfq`. Apenas dev project ref `bcfadphgsibjzivtbjvc` é permitido para migrations/SQL.
3. **Zero deploy de edge functions em prod.** Comandos `supabase functions deploy --project-ref jsjsmuncfkbsbzqzqhfq` proibidos.
4. **Edge functions em dev:** permitido apenas com pedido explícito do CTO na sessão. Default = não-deploy.
5. **Push sempre em branch nova.** Memória `feedback_push_new_branch.md`.
6. **Stacked PRs:** se cortar branch antes do merge de #512, atenção pra rebase + retarget base→main antes do squash final, conforme memória `feedback_squash_stacked_prs.md`. Preferível esperar merge de #512.

## Arquivos

| Slice | Prompt vault | Branch | PR target |
|---|---|---|---|
| 17 (docs + ESLint flip) | [`slice-17-docs-eslint-flip.md`](./slice-17-docs-eslint-flip.md) | `feat/modularizacao/17-docs-eslint-flip` | `develop` |
| 19 (event-bus piloto) | [`slice-19-event-bus-piloto.md`](./slice-19-event-bus-piloto.md) | `feat/modularizacao/19-event-bus-piloto` | `develop` |
| 18 (finalize) | [`slice-18-finalize.md`](./slice-18-finalize.md) | `feat/modularizacao/18-finalize` | `develop` |

## Como usar — abrir terminal paralelo

Em cada novo terminal (claude-code já aberto no repo), colar o launcher correspondente do slice. Cada launcher manda o agente ler o prompt no vault e executar.

Launchers estão fora do vault (texto pra colar direto), no chat onde este index foi gerado, ou reproduzíveis a partir do template:

```
Leia o arquivo `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/prompts-sessoes-paralelas/slice-<N>-<nome>.md` no vault deste projeto e execute integralmente as instruções dele. Auto mode. Constraints invariantes (zero prod, zero main, zero prod DB) são absolutas — se qualquer instrução violar, pare e pergunte.
```

Substituir `<N>-<nome>` por: `17-docs-eslint-flip`, `19-event-bus-piloto`, ou `18-finalize`.
