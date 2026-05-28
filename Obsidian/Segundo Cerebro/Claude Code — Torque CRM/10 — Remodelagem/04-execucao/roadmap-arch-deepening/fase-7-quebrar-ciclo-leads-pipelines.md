---
status: planejado
owner: arquiteto
tipo: fase-execucao
fase: 7
criado: 2026-05-28
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

Após Slice 7.3 verde em develop ≥ 24h: Fase 8 (pipelines re-deepen).

---

## Atualização 2026-05-28 — replan

Slice 7.2 original tentada, **abortada** (baseline subiu 86→120). Detalhes técnicos completos em `inventario-leads-pipelines.md` (seção "Slice 7.2 — tentativa invalidada").

**Roadmap reescrito:**

- **Slice 7.2-bis** — inversão via event-bus (mata `leads → pipelines/hooks/*` substituindo hooks por publicação de evento)
- **Slice 7.3-bis** — re-deepen pipelines barrel em sub-pastas (`views`, `canonical`, `custom`, `kanban`, `legacy`)
- **Slice 7.4-bis** — type-only imports cross-module remanescentes
- **Fase 8 CANCELADA** — 7.3-bis cobre re-deepen

Razão da reescrita: barrel-promotion não trata coupling de domínio. Ciclo `leads ↔ pipelines` é real (leads muta pipes, pipelines lê leads). Solução = inverter direção via event-bus, não renomear via barrel.
