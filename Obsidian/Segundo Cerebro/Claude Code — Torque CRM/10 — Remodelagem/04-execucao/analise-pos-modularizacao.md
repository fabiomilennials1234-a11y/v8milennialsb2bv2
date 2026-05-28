# Análise pós-modularização — estado do sistema (2026-05-28)

**Autor:** Claude Opus 4.7 (1M context), auto-mode review
**Branch analisada:** `origin/develop` em `0f3c246c`
**Escopo:** Estado real do codebase após slices 0-19 + 16 mergeadas em `develop`.

## TL;DR

A modularização está **estruturalmente completa** (14 módulos populados, ADR de conclusão criado, todas as slices fechadas). Mas o **enforcement das fronteiras é em grande parte teatro** — ESLint permite qualquer módulo importar qualquer módulo, dep-cruiser continua warn-only, e CI nunca chega a rodar lint porque `npm audit` falha primeiro. **973 imports cross-module deep** (não via barrel) coexistem com a regra ESLint "em error mode" porque a regra atual não proíbe esse padrão. A promessa do CLAUDE.md ("cross-module só via barrel `@/modules/<bc>`") é **aspiracional, não enforçada**.

A migração de `triggerStageChangedWorkflows` foi corretamente concluída (única call-site real migrado), mas o handler/dispatcher event-bus existe sem que o cron job esteja ativo em nenhum ambiente (estado-zero produção mantido conforme constraint da slice). A função legacy `triggerStageChangedWorkflows` é dead code agora.

CI permanece **red baseline** desde antes da modularização — falha em `Security audit` com 8 vulns de deps (esbuild, tmp, uuid, ws). Todos os outros checks ficam **skipped**.

Lista pragmática de ação no fim do doc.

## Estado do código

### Métricas

| Métrica | Valor |
|---|---|
| `src/` arquivos `.ts`/`.tsx` | 1.147 |
| `supabase/functions/` `.ts` | 230 |
| `supabase/migrations/` `.sql` | 524 |
| Módulos populados | 14/14 |
| Cross-module edges deep-import | 973 imports (não via barrel) |
| `src/components/` root | só `ui/` ✅ |
| `src/hooks/` root | só `use-toast.ts` ✅ |
| `src/pages/` root | inexistente ✅ |

### Distribuição de arquivos por módulo

| Módulo | Arquivos | Observação |
|---|---|---|
| communication | 170 | Maior. Chat, WhatsApp, Meta, Email, SMS, AI email writer. |
| leads | 156 | Lead detail modal + timeline + tags + import + bulk + enrichment. |
| analytics | 133 | Dashboards, métricas, TV, performance, UTMs. |
| platform | 117 | Onboarding, settings, observability, command palette, layout, shortcuts. |
| carteira | 85 | Clientes, orders, upsell, TinyERP. |
| engagement | 69 | Agenda, checklists, atividades, gamification, follow-ups, coaching IA. |
| identity | 66 | Auth, org, team, permissions, master ops. |
| pipelines | 58 | Pipes legacy + custom + kanban + dispatch + stages. |
| workflows | 54 | Workflow DAG + executor + triggers. |
| copilot | 44 | Agents + Oraculo + prompt builder + reasoning + tool logs. |
| campaigns | 28 | Campaigns + mass send. |
| marketing | 25 | Lead forms + landing + UTM. |
| **billing** | **5** | Subscription. Quase vazio. |
| **integrations** | **3** | Só Google Calendar. Praticamente vazio. |

**Outliers**: `integrations` e `billing` têm <10 arquivos. `integrations` é alvo legítimo de absorção em `platform` ou expansão futura (TinyERP, Asaas, Meta hoje vivem em edge functions + frontend espalhado).

### Sub-CLAUDE.md presença

Todos os 14 módulos têm `CLAUDE.md`. Tamanhos entre 64 (`integrations`, mínimo) e 196 linhas (`engagement`, máximo). Mediana ~130 linhas.

### API pública (`index.ts`)

Todos os 14 módulos têm `index.ts`. Tamanhos:

| Módulo | index.ts (linhas) |
|---|---|
| pipelines | 260 |
| carteira | 236 |
| communication | 217 |
| leads | 209 |
| identity | 160 |
| copilot | 157 |
| campaigns | 157 |
| engagement | 125 |
| analytics | 117 |
| workflows | 102 |
| platform | 88 |
| marketing | 39 |
| billing | 31 |
| integrations | 12 |

API pública existe, mas os números acima são **declarações**, não **uso**. A próxima seção mostra que cross-module via barrel é minoria.

## Enforcement é teatro

### 1. ESLint `boundaries/element-types` permite tudo entre módulos

`eslint.config.js`:

```js
"boundaries/element-types": ["error", {
  default: "allow",
  rules: [
    { from: "module", allow: ["ui", "shared", "core", "module"] },  // ← qualquer module pra qualquer module
    { from: "ui", allow: ["ui", "shared", "core"] },
    { from: "shared", allow: ["shared", "core"] },
    { from: "core", allow: ["core"] },
  ],
}],
```

**Consequência**: `@/modules/leads` pode importar `@/modules/pipelines/hooks/useFoo` (path interno). O rule diz "module → module ok". Não exige passar via `index.ts`.

### 2. `boundaries/no-private` está habilitado mas inefetivo

```js
"boundaries/no-private": ["error", { allowUncles: false }],
```

Com `mode: "folder"` em `boundaries/elements` e sem declaração explícita de **public root** (ex.: `capture: { internal: "*" }`), o plugin considera a pasta inteira como pública. Cross-module deep-imports passam.

### 3. Dep-cruiser **continua warn-only** apesar do "flip" anunciado na slice 17

`.dependency-cruiser.cjs`:

```js
{
  name: "no-circular",
  severity: "warn",  // ← ainda warn
  comment: "...Flip para `error` em slice 17 após cleanup dos ciclos existentes (issue separada).",
  ...
},
{
  name: "module-internals-private",
  severity: "warn",  // ← ainda warn
  comment: "Imports entre módulos devem passar pela API pública...",
  ...
}
```

O comentário no código ainda **promete o flip pra slice 17**, mas o flip não foi feito nesse arquivo. Slice 17 só mexeu no ESLint config.

### 4. CI nunca executa lint

Workflow `Tests` (`.github/workflows/test.yml`) tem como segundo step `Security audit` (`npm audit`). Esse step falha por 8 vulns conhecidas (esbuild, tmp, uuid, ws, exceljs, storybook, vite). Os steps seguintes — `npm run lint`, `Lint dependency graph (cycles + module boundaries)`, `Build (prod)`, e todos os 6 jobs paralelos (Unit Tests, E2E Tests, Edge Function Tests, Integration Tests, Workflow System Tests) — ficam **skipped**.

Resultado: a quarentena de boundaries em error mode é **nunca exercida**. Slice 17 verde no PR foi porque o workflow Tests não roda em PRs target=develop (`pull_request.branches: [main]` no test.yml), só em push. Quando rodou no merge (push para develop), falhou no audit como sempre.

**Toda a validação de qualidade da modularização nunca correu de verdade no CI.**

### 5. Cross-module deep imports — distribuição

Top 15 edges deep entre módulos (mais frequentes):

| Origem → Destino | Edges |
|---|---|
| leads → pipelines | 38 |
| analytics → engagement | 24 |
| leads → communication | 22 |
| platform → communication | 21 |
| pipelines → carteira | 17 |
| leads → carteira | 16 |
| carteira → pipelines | 14 |
| pipelines → engagement | 12 |
| pipelines → platform | 11 |
| pipelines → leads | 9 |
| leads → engagement | 9 |
| identity → platform | 9 |
| pipelines → workflows | 8 |
| marketing → analytics | 7 |
| workflows → campaigns | 6 |

`pipelines ↔ leads`, `pipelines ↔ carteira`, `analytics → engagement` são acoplamentos bidirecionais ou pesados. Padrão real do código: **muitos hooks de tipo/utility importados deep**, não via barrel.

Total deep-imports cross-module: **973**.

Implicação: se as regras de enforcement fossem realmente apertadas (barrel-only), seria preciso decidir caso-a-caso entre:
- Promover a referência ao `index.ts` do módulo destino, ou
- Aceitar a dependência como legítima e ampliar a API pública, ou
- Refatorar para inversão de dependência (extrair tipo compartilhado pra `src/shared/`).

Cada um desses 973 imports é uma decisão de design adiada.

## Modularização — qualidade da entrega

### Slices executadas

- **0-15** (planning + tooling + skeleton + 13 BCs + edge functions doc-only) ✅
- **16** (cleanup longtail — pastas root esvaziadas) ✅
- **17** (ESLint flip warn→error + docs raiz + sub-CLAUDE.md) ✅ parcial (dep-cruiser não flipado, CI nunca executou para confirmar)
- **18** (ADR conclusão + slices.md + smoke checklist) ✅
- **19** (event-bus piloto — domain_events + dispatcher + handler + migração de 1 call site) ✅

### Documentação raiz

| Arquivo | Atualizado pós-modularização? |
|---|---|
| `CLAUDE.md` | ✅ (estrutura atualizada, 14 módulos, src/shared, etc) |
| `AGENTS.md` | ✅ |
| `llms.txt` | ✅ |
| `Obsidian/.../02 — Arquitetura/Modulos.md` | a verificar (não inspecionado nesta análise) |
| `Obsidian/.../04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md` | ✅ criado pela slice 18 |
| `Obsidian/.../10 — Remodelagem/04-execucao/slices.md` | ✅ |
| `Obsidian/.../10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md` | ✅ |
| `.specs/features/modularizacao/SPEC.md` | a verificar adendo "slice 15 real descartada" |

### Slice 19 — event-bus piloto

- Tabela `domain_events` (migration `20261105000000_domain_events.sql`) commitada. **Não aplicada em prod nem em dev** (constraint respeitado).
- Módulo `_shared/events/` populado: `types.ts`, `publish.ts`, `registry.ts`, `dispatch.ts`, `handlers/lead-stage-changed.ts`, `index.ts`.
- Edge function `event-dispatcher/index.ts` existe. **Não deployada** (constraint respeitado).
- Client-side wrapper `src/integrations/supabase/events.ts` criado com `publishEvent(...)`.
- **Migração de call sites**: 1 callsite migrado (`src/modules/campaigns/hooks/useCampanhas.ts:823`), legacy comentado.

⚠️ **Discrepância vs SPEC original**: o SPEC e o prompt da slice 19 afirmavam "3 call sites" (`useUpdatePipeProposta`, `useUpdatePipeConfirmacao`, `useUpdatePipeWhatsapp`). Na prática a função `triggerStageChangedWorkflows` (em `src/lib/workflowTrigger.ts:45`) tem **uma única referência ativa em todo o codebase** — `useCampanhas.ts`. As 3 call sites mencionadas no SPEC não existiam (ou foram desabilitadas em slices anteriores). A migração está completa nesse sentido.

⚠️ **Dead code residual**: `src/lib/workflowTrigger.ts` ainda exporta `triggerStageChangedWorkflows` sem nenhum caller. Próximo passo natural: deletar a função quando estiver claro que ninguém reverteu o `useCampanhas.ts`.

## Riscos identificados

### Risco 1 — CI vermelho mascara regressões

Severidade: **alta**. `npm audit` falha → todo restante skipped. Slice 17 não foi validada por lint/build/tests. Qualquer regressão de import ou tipo entra silenciosamente em develop. Sintoma já observado: as PRs #514, #515, #516 mergearam sem CI verde.

Mitigação:
- Curto prazo: separar `Security audit` num job não-bloqueante OU mover pra step opcional com `continue-on-error: true`.
- Médio prazo: `npm audit fix` (não-breaking) + decidir caso a caso sobre `--force` (breaking, vite 6→8).

### Risco 2 — Enforcement de boundaries é teatro

Severidade: **alta** pro objetivo declarado do projeto. Slice 17 prometeu "gate definitivo" mas a regra ESLint atual aceita o padrão que ela teoricamente proíbe. dep-cruiser continua warn-only. Decisões de design ficam adiadas em 973 deep-imports.

Mitigação:
- Restringir `boundaries/element-types` para forçar `from: module, allow: [module]` apenas no `index.ts` do destino (via `boundaries/no-private` configurada corretamente, ou regra custom).
- Promover dep-cruiser `module-internals-private` para `error` e rodar `npm run lint:deps` localmente — espera-se centenas de violations; tratar em sub-slices por módulo.
- Considerar abordagem incremental: aceitar o estado atual como baseline e criar regra que falha **apenas em violations novas** (via golden file de violations).

### Risco 3 — `triggerStageChangedWorkflows` dead function

Severidade: baixa. Função exportada sem caller. Confunde leitura. Pequeno débito.

Mitigação: deletar em chore branch após confirmação de que ninguém vai reverter o `useCampanhas.ts`.

### Risco 4 — Módulos quase-vazios

`integrations` (3 arquivos) e `billing` (5 arquivos). Risco: módulo "fantasma" sem critical mass — qualquer mudança lá é arbitrária, fronteira instável.

Mitigação:
- `integrations`: alvo expansão (TinyERP, Asaas, Meta hoje vivem em edge functions + UI espalhada). Slice futura pode consolidar.
- `billing`: se a feature de subscription estiver dormente, ok manter compacto. Se ativa, ampliar.

### Risco 5 — Cross-module deep-imports em arquivos central

Onde:
- `leads → pipelines` (38 edges): muitos types e hooks de pipeline puxados pelo lead detail modal + páginas de leads.
- `analytics → engagement` (24 edges): KPIs e charts puxam tipos de engagement.

Esses dois acoplamentos são reflexo de domínio real (lead **vive** em pipes; analytics **mede** engagement). Não são bugs, são acoplamentos verdadeiros que precisam atravessar fronteiras. Decisão de design: **promover esses tipos pro public API** de pipelines/engagement OU criar `src/shared/domain-types/` pra tipos partilhados sem chefe-único.

## Pragmatismo — lista de ação ordenada por ROI

| # | Ação | Esforço | Impacto |
|---|---|---|---|
| 1 | Desbloquear CI: mover `Security audit` pra job não-bloqueante (`continue-on-error`) | 0.5h | Alto — destrava lint/build/tests em todos os PRs futuros |
| 2 | Rodar `npm audit fix` (não-breaking) | 0.5h | Médio — reduz ruído |
| 3 | Flip dep-cruiser `module-internals-private` e `no-circular` para `error` (modo measurement primeiro, lista as violations num arquivo) | 1h | Alto — torna enforcement real |
| 4 | Configurar `boundaries/no-private` com `mode: "folder"` corretamente (definir `capture` + `internal/public`) — ou substituir por regra custom que exige import via `from "@/modules/<bc>"` exato | 2h | Alto — fecha o teatro |
| 5 | Deletar `triggerStageChangedWorkflows` (dead code) | 0.5h | Baixo |
| 6 | Audit + decisão para os 973 deep-imports: golden file de violations + plan de redução incremental (1 módulo / sprint) | 2h planning + N sprints | Alto — paga o débito |
| 7 | Decidir destino de `integrations` (absorver em platform OU expandir com TinyERP/Asaas/Meta) | 1h decisão | Médio |
| 8 | Aplicar migration `domain_events` em **dev** e ativar cron em **dev** pra validar dispatcher end-to-end | 1h + autorização CTO | Médio — valida event-bus antes de prod |
| 9 | Smoke manual seguindo `smoke-pre-develop-to-main.md` | 2h | Alto — pré-requisito do PR final pra main |
| 10 | Abrir PR `develop → main` quando smoke verde + CI verde + boundaries reais | 0.5h + coordenação | Alto |

## O que ficou bom

- Estrutura física do código reflete domínio do CONTEXT.md.
- Sub-CLAUDE.md em todos os 14 módulos — onboarding ganha âncoras de domínio.
- Roteamento dos subagentes (`arquiteto / design / engenheiro`) ganha endereços previsíveis.
- API pública declarada (mesmo que pouco usada hoje) — base para evolução.
- Cleanup longtail (slice 16) eliminou os 3 critérios de aceite mais visíveis do SPEC.
- Event-bus tem infra pronta pra expansão (registry + dispatcher + tipos) — próximos eventos só adicionam handlers.
- ADR de conclusão captura decisões (incluindo "slice 15 real descartada por restrição do Supabase CLI").

## O que ficou para sessões futuras

- Tornar enforcement real (item 3 e 4 da lista de ação).
- Desbloquear CI (item 1 e 2).
- Pagar débito de 973 deep-imports (item 6).
- Aplicar event-bus em prod (depende de CTO e smoke).
- Próximos eventos pós-pilot: `lead.created`, `message.received`, `campaign.dispatched`, `workflow.step_executed` — projeto separado.
- Decisão sobre `integrations` (item 7).
- Eventual fala-finalmente entre módulos: substituir 973 deep-imports por barrel ou por eventos.

## Conclusão

A modularização entregou o que prometeu **fisicamente** (todos os arquivos no lugar, ADR fechado, docs atualizadas) mas não entregou **enforcement real**. O sistema está mais organizado e navegável — o que era o ganho principal pra onboarding + AI subagentes — mas a promessa de "boundaries em error mode + CI gate" ainda é fachada enquanto npm audit bloquear o pipeline e a regra ESLint não exigir barrel.

A continuação natural é a lista pragmática acima, com prioridade em destravar CI (item 1) e tornar enforcement real (itens 3 e 4). Sem isso, o monolito modular vira monolito-com-pastas-bonitas dentro de poucos meses.

---

**Refs**:
- ADR conclusão: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-28-modularizacao-conclusao.md`
- SPEC: `.specs/features/modularizacao/SPEC.md`
- Smoke checklist: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md`
- Slices roadmap: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md`
- Prompts paralelos (já executados): `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/prompts-sessoes-paralelas/`
- Memória `project_ci_baseline_red.md` — CI vermelho desde 2026-05-19, anterior à modularização.
