---
status: concluido-via-7.3-bis
owner: arquiteto
tipo: fase-execucao
fase: 8
criado: 2026-05-28
concluido: 2026-05-29
estimate: 8-14h
pre_requisitos:
  - "[[fase-7-quebrar-ciclo-leads-pipelines]] mergeada"
  - "Ratchet baseline cycles leads↔pipelines = 0"
habilita:
  - "[[fase-9-identity-split]]"
relacionados:
  - "[[_INDEX]]"
---

> [!success] ABSORVIDA pelo slice 7.3-bis — 2026-05-29
> A Fase 8 (re-deepen de `pipelines`) foi **executada dentro da Fase 7**, no slice `07-3-bis-pipelines-deepen`. O re-deepen físico (reorg de `hooks/` em sub-pastas + sub-barris privados + redução do barrel público) andou junto com a inversão `PipeOpsPort` porque a divisão de sub-conceitos compartilha a mesma superfície tocada.
>
> **Alvos atingidos (medidos 2026-05-29):**
> - `pipelines` files-per-export: **0.85 → 3.58** (68 arquivos `.ts/.tsx` / **19** export-statements no barrel) — supera o alvo `≥ 3.0`.
> - Barrel público: **68 → 19** export statements.
> - Estrutura interna real entregue (difere das hipóteses originais abaixo): `hooks/{legacy,model,config,custom,perf}/` + `components/{kanban,shared,custom,funis,legacy/confirmacao}/`, cada um com sub-barril privado (`index.ts`).
>
> O plano de slices 8.1–8.4 abaixo fica como **histórico**. A nomenclatura de sub-conceitos divergiu (`views/canonical/custom` planejado → `legacy/model/config/custom/perf` entregue), mas a tese de deepening (interface < implementação, barrel só expõe cross-module) foi cumprida.

# Fase 8 — `pipelines` re-deepen

**Branch base:** `develop`
**Target PR:** `develop`
**Estimate:** 8-14h em 3-4 slices/PRs

## Problema

`src/modules/pipelines/` métricas atuais:
- **58 arquivos / 68 exports = 0.85 files-per-export — INVERTIDO**
- Interface barrel maior que implementação interna
- Dual model `pipe_*` (views legacy stage_key) + `pipeline_entries` (UUID stage_id) + `custom_pipelines` exposto sem separação
- Top consumidor é `pipelines` reciprocando deep imports com leads, carteira, engagement
- Deletion test: barrel é dump — não tem leverage real

## Tese de deepening

Separar `pipelines` em **sub-conceitos com interfaces distintas** (sub-pastas internas com seus próprios barrel):

```
src/modules/pipelines/
├── views/                    # API: pipe_whatsapp + pipe_confirmacao + pipe_propostas (legacy compat)
│   ├── hooks/                # usePipeWhatsApp, usePipeConfirmacao, usePipePropostas (16 hooks today)
│   ├── components/
│   ├── lib/
│   └── index.ts              # barrel privado do sub-conceito (não cross-module)
├── canonical/                # API: pipeline_entries (modelo novo)
│   ├── hooks/                # usePipelineEntries, useCreateEntry, useMoveEntry
│   ├── components/
│   └── index.ts
├── custom/                   # API: custom_pipelines + custom_pipe_entries
│   ├── hooks/
│   ├── components/
│   └── index.ts
├── shared/                   # tipos + utils comuns aos 3
│   └── types.ts
├── pages/                    # PipeWhatsApp.tsx, PipeConfirmacao.tsx, PipePropostas.tsx, Funis.tsx
├── lib/
├── index.ts                  # BARREL PÚBLICO — alvo: ≤ 20 exports (vs 68 hoje)
└── CLAUDE.md
```

Cada sub-pasta é **deep internamente** (interface < implementação). Barrel raiz expõe **só o que cross-module precisa** — alvo realista 15-20 exports.

## Hipóteses sobre alvo

Sub-conceitos prováveis baseados em CLAUDE.md `pipelines`:

| Sub-conceito | Conteúdo | Public exports estimado |
|---|---|---:|
| `views` (legacy) | hooks `usePipe*` para views compat | 6-8 |
| `canonical` | `usePipelineEntries`, hooks de `pipeline_entries` | 4-6 |
| `custom` | `useCustomPipelines`, CRUD custom | 4-6 |
| `shared/types` | `PipeStatus`, `PipelineEntryUpdate`, tipos comuns | 2-4 |
| `pages` | Re-export apenas se App.tsx precisar (mas pages já são deep-import legítimo) | 0 (via lazy) |
| **Total alvo** | | **≤ 20** |

A confirmar no Slice 8.1.

## Constraints

Ver `_INDEX.md`. Adicional:
- **NÃO** unificar dual model nesta fase (CLAUDE.md raiz pipelines explicitamente proíbe — "**Não unificar** — cleanup futuro fora do escopo")
- **NÃO** mover lógica de stage transition (área frágil)
- Cada PR cobre 1 sub-conceito (views OU canonical OU custom)
- Smoke Bloco 3 + Bloco 4 (event-bus via campanha) verde a cada slice

## Slices

### Slice 8.1 — Inventário + decisão de divisão (2-3h)

Doc-only.

**Tarefas:**
1. Listar os 68 exports do `index.ts` atual em tabela com:
   - Símbolo
   - Tipo (hook / component / type / page / helper)
   - Consumer cross-module conhecido (grep)
   - Sub-conceito sugerido (views / canonical / custom / shared)
2. Classificar quais ficam no barrel público (cross-module) vs internos (privados ao módulo).
3. Identificar potenciais quebras de import nos consumers.

```bash
# Inventário inicial
grep "^export" src/modules/pipelines/index.ts > .inventory-pipelines-exports.txt
for sym in $(grep "^export" src/modules/pipelines/index.ts | sed -E 's/.*\{([^}]+)\}.*/\1/' | tr ',' '\n' | tr -d ' '); do
  count=$(grep -rE "from \"@/modules/pipelines\"" src --include="*.ts" --include="*.tsx" | grep -c "$sym")
  echo "$sym: $count cross-module usages"
done | sort -t: -k2 -rn
```

**Entregáveis 8.1:**
- Doc `inventario-pipelines.md` no vault.
- Decisão final assinada CTO no doc.
- Lista de exports a remover do barrel (privados).
- PR doc-only.

### Slice 8.2 — Reorganização física `views/` (2-4h)

**Tarefas:**
1. Criar `src/modules/pipelines/views/` com `hooks/`, `components/`, `lib/`, `index.ts`.
2. Mover hooks `usePipe*` (legacy) para `views/hooks/`.
3. Mover components específicos de views legacy para `views/components/`.
4. `views/index.ts` re-exporta tudo internamente (privado ao módulo).
5. Atualizar imports dentro de `pipelines/` (caminho relativo curto: `./views/...`).
6. **Não tocar consumers externos** — barrel público `pipelines/index.ts` ainda re-exporta tudo. Deepening interno apenas.
7. Validar build/lint/test.

**Critério aceite 8.2:**
- [ ] `views/` populada
- [ ] `pages/PipeWhatsApp.tsx` etc importam via `./views` ou caminho relativo curto
- [ ] Barrel público inalterado (consumers ainda funcionam — quebra cross-module = 0)
- [ ] Build + lint + lint:deps:check verde
- [ ] Smoke Bloco 3.1-3.5 (kanban legacy) verde

### Slice 8.3 — Reorganização física `canonical/` + `custom/` (2-4h)

Mesma estrutura do 8.2, aplicada aos outros dois sub-conceitos.

**Critério aceite 8.3:**
- [ ] `canonical/` + `custom/` populadas
- [ ] Barrel público inalterado
- [ ] Smoke Bloco 3.6-3.7 (custom pipes) verde

### Slice 8.4 — Reduzir barrel público (3-4h)

O cuidado maior. Aqui consumers cross-module quebram **se importarem símbolos que vão ser tornados privados**.

**Tarefas:**
1. Para cada export do barrel marcado "privado" no inventário 8.1:
   - Identificar consumers externos via grep
   - Se zero consumers externos → remover do barrel imediatamente
   - Se houver consumers → triage:
     - **Migrar consumer** pra usar API pública alternativa (ex: hook menor wrapping)
     - OU **manter export** com nota no CLAUDE.md ("legacy export, candidato a remoção")
2. Atualizar `src/modules/pipelines/index.ts` para conter ≤ 20 exports.
3. Atualizar `src/modules/pipelines/CLAUDE.md` documentando sub-pastas + alvo files-per-export.
4. Rodar `npm run lint && npm run lint:deps:baseline` — confirmar redução cycles + violations.

**Critério aceite 8.4:**
- [ ] `pipelines/index.ts` ≤ 20 exports (vs 68 inicial)
- [ ] files-per-export ≥ 3.0 (alvo). Aceitável ≥ 2.5 com nota
- [ ] Zero quebra em consumers (build verde + smoke completo)
- [ ] Baseline ratchet: reduzido em ≥ 5 violations (cycle ou orphan)
- [ ] Sub-CLAUDE.md `pipelines` atualizado com nova estrutura

## Riscos + mitigação

| Risco | Mitigação |
|---|---|
| Mover hooks quebra realtime postgres_changes | Validar multi-tab smoke (Bloco 3.3) a cada slice |
| Slice 8.4 estoura — muito consumer externo | Quebrar em 8.4a (low-hanging exports privados) + 8.4b (consumer migration) |
| Dual model regride (consumer usa views path achando que é canonical) | Sub-pastas nomeadas explicitamente. Tests por sub-conceito |
| `pages/` quebra React.lazy chunks | App.tsx mantém deep-import (regra existente). Smoke navegação por todas as rotas pipelines |
| Test coverage de `pipelines` cai (hooks movidos sem test mover junto) | `git mv` preserva history. Atualizar imports nos tests proativamente |

## Métricas de progresso (snapshot por slice)

```bash
# Rodar antes e depois de cada slice
echo "files: $(find src/modules/pipelines -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l)"
echo "exports: $(grep -c '^export' src/modules/pipelines/index.ts)"
echo "deep-imports vindo de outros módulos para pipelines:"
grep -rE 'from "@/modules/pipelines/(views|canonical|custom|hooks|components|lib)/' src/modules --include="*.ts" --include="*.tsx" | grep -v 'src/modules/pipelines/' | wc -l
```

## Out of scope

- Unificar dual model `pipe_*` vs `pipeline_entries` (CLAUDE.md raiz proíbe)
- Mexer com Realtime subscription transport
- Migrar pages para outro módulo

## Próximo passo

Após Slice 8.4 verde em develop ≥ 7 dias: Fase 9 (identity split).
