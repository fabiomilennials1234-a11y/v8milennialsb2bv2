---
status: replanejado
owner: arquiteto
tipo: fase-execucao
fase: 7
criado: 2026-05-28
revisado: 2026-05-29
estimate: 6-10h
pre_requisitos:
  - "Fase 6 mergeada (develop → main)"
  - "Prod estável ≥ 7 dias"
habilita:
  - "[[fase-8-pipelines-re-deepen]]"
relacionados:
  - "[[_INDEX]]"
  - "[[../reducao-deep-imports]]"
---

> [!warning] REPLANEJADO 2026-05-29 — abordagem barrel ABORTADA
> Todo o plano de slices abaixo (7.2 mover tipos, 7.3 promover barrel) está **obsoleto**. Mantido como histórico. Achados decisivos da sessão 2026-05-29:
>
> 1. **Barrel promotion ABORTADA.** Tentativa real subiu baseline dep-cruiser 86→120 (+34 ciclos) — barrel-to-barrel cycle mais largo. Barrel renomeia o ciclo, não o trata.
> 2. **dep-cruiser conta type-only** (`tsPreCompilationDeps: true`). Mover tipos via barrel NÃO sai do ciclo. Bucket 1 do inventário é ilusório.
> 3. **Baseline só cai quebrando `no-circular`.** Reduzir deep imports parcialmente (deep→barrel) é **baseline-NEUTRO**. O ciclo de módulo persiste enquanto QUALQUER par de edges bidirecional existir.
> 4. **Event-bus NÃO resolve os 38 forward-edges.** `events.ts` é async (~60s cron); os 38 leads→pipelines são reads síncronos + mutations inline (LeadModal cria pipe entry na hora). Event-bus quebra UX. Reservado só pro `lead.stage_changed`→workflow.
> 5. **MOVE-candidates são TRONCO, não folha.** `CrossPipePanel` (8 consumidores leads), `useLeadAllPipelines`/`useLeadPipeHandlers` (API pública barrel, 6+ consumidores). Relocar pra pipelines MULTIPLICA leads→pipelines = recria o ciclo barrel↔barrel = abort original. **Não há subconjunto MOVE seguro.**
>
> **Único caminho real = inversão de dependência** (não relocação). Ver seção "## Replan 2026-05-29" no fim do doc. Incremento seguro já entregue: `useBulkSelection` (puro) movido `leads/hooks/` → `src/shared/hooks/` — back-edge 9→6, baseline-neutro, é CHORE (não slice).

# Fase 7 — Quebrar ciclo `leads ↔ pipelines`

**Branch base:** `develop`
**Target PR:** `develop`
**Estimate:** 6-10h em 2-3 slices/PRs

## Problema

47 deep imports cruzados:
- `leads → pipelines/*`: 38 (top edge medido)
- `pipelines → leads/*`: 9

Ciclo bidirecional via deep imports. Sintomas:
- Tree-shaking quebrado (medido — ratio impacto bundle não medido)
- Refactor em qualquer lado propaga
- Boundary `no-private` ESLint não bloqueia (rule permissiva), apenas dep-cruise ratchet registra
- Deletion test: deletar `leads` → quebra 38 paths em `pipelines`. Deletar `pipelines` → quebra 9 em `leads`. Acoplamento real.

## Hipóteses sobre causa

Investigação prévia indica que cruzamentos típicos são:
1. **Tipos compartilhados** (`Lead`, `PipelineEntry`, `PipeStatus`) sendo importados via paths internos
2. **Hooks de query** que precisam ambas entidades (`useLeadAllPipelines`, `usePipelineLeads`)
3. **Components de UI** que misturam (`LeadDetailKanban`, `PipeStageBadge`)

A confirmar no Slice 7.1.

## Constraints

Ver `_INDEX.md`. Adicional:
- **NÃO** mudar lógica de negócio. Apenas mover símbolos + ajustar imports.
- **NÃO** introduzir new module sem decisão prévia (ex: módulo `lead-pipeline-bridge`).
- Cada PR deixa CI verde (lint + lint:deps:check + build).
- Cada PR reduz baseline em ≥ 1 (se baseline cair, regenerar; se subir, abortar).

## Slices

### Slice 7.1 — Inventário + plano (1-2h)

Doc-only. Saída: classificação dos 47 imports em 4 buckets:

| Bucket | Destino do símbolo | Estratégia |
|---|---|---|
| Tipos puros (`Lead`, `PipelineEntry`) | `src/shared/types/` ou `src/integrations/supabase/types` (já existe) | Mover/re-export — zero side-effect |
| Hooks de query cross-conceito | Decidir owner por entidade primária | Promover pra barrel do owner |
| Components UI | Decidir owner por contexto visual | Promover pra barrel do owner |
| Side-effects (mutate stage trigger workflow) | Event-bus (consistente com slice 19) | Migrar pra `publishEvent` |

```bash
# Comando de inventário
grep -rnE 'from "@/modules/pipelines/(hooks|components|lib)/' src/modules/leads/ | \
  awk -F: '{print $1 "::" $3}' | sort > .lp-leads-to-pipelines.txt

grep -rnE 'from "@/modules/leads/(hooks|components|lib)/' src/modules/pipelines/ | \
  awk -F: '{print $1 "::" $3}' | sort > .lp-pipelines-to-leads.txt
```

**Entregáveis 7.1:**
- Doc no vault: `Obsidian/.../10 — Remodelagem/04-execucao/roadmap-arch-deepening/inventario-leads-pipelines.md` com tabela classificando os 47.
- Decisão de owner por símbolo discutida com CTO (curta — pode ser comentários inline na tabela).
- PR doc-only contra develop.

### Slice 7.2 — Mover tipos compartilhados (2-3h)

Foco: bucket 1 (tipos puros). Geralmente o mais barato — sem hooks, sem React.

**Tarefas:**
1. Identificar quais types em `leads/` e `pipelines/` são consumidos pelo outro lado.
2. Mover para `src/shared/types/` (criar diretório se não existir) OU re-exportar via `@/integrations/supabase/types` se já forem TablesRow.
3. Atualizar todos os imports nos dois lados.
4. Rodar `npm run lint:deps:baseline` — confirmar redução de violations.

**Critério aceite Slice 7.2:**
- [ ] Pelo menos 10 dos 47 deep imports removidos (heurística — depende inventário).
- [ ] `npm run lint && npm run lint:deps:check && npm run build`: tudo verde.
- [ ] Baseline ratchet regenerado, diff documentado no PR body.
- [ ] Zero comportamento mudado (types-only refactor).

### Slice 7.3 — Promover hooks + components pro barrel (3-5h)

Foco: buckets 2 + 3. Mais frágil — hooks têm side-effects.

**Tarefas:**
1. Para cada hook/component cross-importado, decidir owner (leads ou pipelines).
2. Se o owner for o módulo atual de origem, **promover ao barrel** (`index.ts`):
   - Adicionar `export { useFoo } from "./hooks/useFoo"` no `index.ts` do owner.
   - Atualizar consumer pra importar via `@/modules/<owner>` (não deep path).
3. Se símbolo é "ponte" entre conceitos (ex: `useLeadAllPipelines`), discutir com CTO se ele pertence a leads (Lead-centric) ou pipelines (Pipeline-centric).
4. Para side-effects de mudança de stage que disparam workflow, migrar pra `publishEvent('lead.stage_changed')` (já tem piloto).

**Critério aceite Slice 7.3:**
- [ ] Ciclo `leads ↔ pipelines` deep imports → **0**
- [ ] `npm run lint && npm run lint:deps:check && npm run build`: verde
- [ ] Test suites: não regridem vs baseline pré-Fase-7
- [ ] Baseline ratchet: cycles `no-circular` cross-module entre leads e pipelines = **0**
- [ ] Smoke manual: Bloco 3 (Pipelines) + Bloco 2 (Leads) do roteiro pré-Fase-5 verdes
- [ ] Doc `mapa-as-is-to-be-real.md` atualizado com novos counts

## Riscos + mitigação

| Risco | Mitigação |
|---|---|
| Hook movido quebra realtime (sub mudou path) | Validar `useRealtimeSubscription` em multi-tab smoke (Bloco 3.3) |
| Type movido quebra geração de `types.ts` Supabase | Não tocar `src/integrations/supabase/types.ts` (auto-gerado) — apenas re-exportar |
| Permissions cascateiam (LeadDetailKanban perde gate) | Validar matrix admin/membro/master |
| 47 imports vira 50 (regressão) | Ratchet em CI bloqueia. Slice abortado se subir |
| Slice 7.3 estoura estimativa | Quebrar em 7.3a (hooks) + 7.3b (components) |

## Out of scope

- Mudança em `lib/permissions.ts`
- Migrar mais eventos para event-bus além do `lead.stage_changed` (Fase 5 cobre isso quando entrar em prod)
- Refatorar `useLeadAllPipelines` semanticamente

## Próximo passo

~~Após Slice 7.3 verde em develop ≥ 24h: Fase 8 (pipelines re-deepen).~~ Obsoleto — ver replan abaixo.

---

## Replan 2026-05-29 — inversão de dependência (`PipeOpsPort`)

Abordagem barrel abortada (ver banner topo). Único caminho que zera o ciclo sem recriar o abort = **inversão**, não relocação.

### Princípio

Hoje: lead-detail UI **importa** hooks de pipelines (`useLeadAllPipelines`, `useLeadPipeHandlers`, `CrossPipePanel`, mutations inline) → 38 forward-edges leads→pipelines.

Alvo: lead-detail UI **não importa** pipelines. Recebe pipe-ops via **porta injetada** (`PipeOpsPort`) — interface que pipelines expõe e leads consome via props/context. DAG passa a ser pipelines→leads (direção natural única).

### Por que tudo de uma vez (não fatiável)

O ciclo de módulo persiste enquanto QUALQUER edge bidirecional existir (achado 3). Mover/inverter parcialmente é baseline-neutro. Logo a slice precisa eliminar **os 38 de uma vez** — não há "inverte metade agora".

Fragilidade: toca `LeadModal` V1/V2 (feature flag) + 8 consumidores de `CrossPipePanel`. Smoke **V1+V2 obrigatório**.

### Escopo da slice de inversão

| Tarefa | Detalhe |
|---|---|
| Definir `PipeOpsPort` | Interface TS: cria/atualiza/deleta pipe entries, lê stages, cross-pipe move. Owner = pipelines (exporta no barrel). |
| Provider em pipelines | `PipeOpsProvider` que implementa a porta usando os hooks atuais de pipelines. |
| Injeção em lead-detail | LeadModal V1+V2 + 8 consumidores recebem `PipeOpsPort` via context/props. Param de `pipelines/*` imports. |
| Migrar `lead.stage_changed` | Side-effect que dispara workflow → `publishEvent` (event-bus, async OK aqui). |
| Validar baseline | `no-circular` cross-module leads↔pipelines = **0**. Baseline alvo ~70. |
| Smoke V1+V2 | LeadModal flag ON/OFF — criar pipe entry inline, cross-pipe move, stage change. Blocos 2+3 do roteiro. |

### Incremento já entregue (CHORE, fora da slice)

`useBulkSelection` (hook puro, zero domain dep) movido `leads/hooks/` → `src/shared/hooks/` via git mv + 6 imports reescritos. Back-edge pipelines→leads 9→6, limpa carteira→leads de brinde. tsc 0 / lint 0. **Baseline-neutro (86→86)** — ciclo intacto. Branch `feat/arch-deepening/07-2-bis-acyclic`, sem commit (commit = arquiteto).

### Slice 7.3-bis — executado (2026-05-29)

Inversão `PipeOpsPort` (camadas D+B+C) entregue no commit `25b56628`, **mais** o re-deepen físico de `pipelines` (absorveu a [[fase-8-pipelines-re-deepen]]) na branch `feat/arch-deepening/07-3-bis-pipelines-deepen`. Números medidos:

| Métrica | Antes | Depois |
|---|---:|---:|
| `pipelines` files-per-export | 0.85 | **3.58** (68 arquivos / 19 export-statements) |
| `pipelines` barrel (export statements) | 68 | **19** |
| dep-cruiser baseline (total violations) | 86 | **83** |
| Ciclos `no-circular` | 63 | **60** |
| Ciclo `leads ↔ pipelines` (no-circular cross-module) | 1 | **0** (zerado na inversão; mantido) |
| `leads → pipelines` deep imports | 38 | **0** |
| `pipelines → leads` deep imports | 9 | **6** |

Baseline composto: **60 `no-circular` + 23 `no-orphans` = 83**. Ratchet regenerado e travado em 83 (regressão acima de 83 bloqueia CI).

**Restam 3 barrel-edges `leads → pipelines`** (`from "@/modules/pipelines"`) — não são deep imports e não recriam o ciclo de módulo (back-edge `pipelines → leads` agora é só via barrel + 6 deep residuais). Alvo de limpeza no **slice 7.4-bis**.

Tests pós-fix: **40 failed / 3902 passed / 150 skipped** — os 27 files vermelhos são baseline pré-existente (ver constraint #7 do `_INDEX.md`), **zero regressão** introduzida pelo slice.
