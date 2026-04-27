# ADR 2026-04-27 — Workflow Time-Aware Window (Onda 5)

**Status**: Accepted (deployed prod)
**Data**: 2026-04-27
**Autor**: Gabriel (CTO) + Claude Code
**Relacionado**: [[ADR-2026-04-26-copilot-time-aware-behavior]]

## Contexto

Workflow visual do Torque CRM tem node `wait_business_window` desde sempre, mas comportamento limitado:
- 1 janela única (days/startTime/endTime/timezone)
- Hard-coded modo "hold" — pausa execução até janela abrir
- Sem branching/route por horário
- Sem múltiplas janelas com comportamentos diferentes

Cliente queria mesmo controle granular que ganhamos no Copilot ontem (Onda 4 Time-Aware Behavior): "domingo desvia pro caminho X", "madrugada segura até segunda", "fim de semana manda só msg curta".

## Decisão

Estender `wait_business_window` reusando 100% do resolver `time-context.ts` da Onda 4 Copilot.

### Schema novo
Estende `WaitBusinessWindowNodeData` em `src/types/workflow.ts`:
```ts
{
  // Legacy preservado
  days?, startTime?, endTime?, timezone?
  // Novo
  windows?: Array<{ id, name, days, start, end, action }>;
  mode?: "hold" | "route" | "hybrid";
}
```

`action` é discriminated union:
- `"pass"` — continua pela edge default
- `` `hold_until:${windowName}` `` — pausa até janela X abrir
- `` `route:${branchKey}` `` — sai pelas edges com `sourceHandle === branchKey`

### Resolver compartilhado
Não duplicado. Mesmo `time-context.ts` já em prod (Copilot). Adicionado helper novo:

```ts
computeNextWindowStart(windows, targetName, tz, from) → Date | null
```

Avança minuto-a-minuto até 14 dias, primeiro match retorna. Worst-case 20160 iterações (sub-ms V8). Usado pelo executor pra setar `next_run_at` em `hold_until:X`.

### Executor refator
`workflow-executor.ts:536` — case `wait_business_window` ganha 3 branches:
1. Resolver retorna janela com action=pass → `nextNodes.push(...getNextNodes(...))`
2. action=hold_until:X → `next_run_at = computeNextWindowStart(X)`, return paused
3. action=route:X → filtra edges por `sourceHandle === X`, push targets matching

Fallback (nenhuma janela ativa): hold até primeira janela com action=pass abrir. Legacy single-window preservado se `windows[]` vazio.

### Frontend
- Node renderiza handles dinâmicos: 1 amber por janela com route + 1 emerald default
- Sidebar config: lista até 6 janelas, dropdown action por janela, modo global hold/route/hybrid

### Backfill
Migration backfilla workflows existentes com 1 janela "Comercial" derivada de `days/startTime/endTime` + `action=pass` + `mode=hold`. Comportamento idêntico ao anterior. Mapeamento dias legacy PT (`seg/ter/...`) → EN (`mon/tue/...`) via função SQL temporária.

## Alternativas consideradas

### Alt 1: Tabela paralela `workflow_business_windows`
**Rejeitada** — overkill. JSONB no node `data` mais natural pra workflow visual (definição já é JSONB inteira em `workflows.definition`).

### Alt 2: Resolver duplicado pro workflow
**Rejeitada fortemente** — duas implementações de timezone-aware logic = risco de drift. 20+ workflows + cron 1min disparam errado se um lado tem bug. Reuso do resolver Copilot (já validado com 32 unit + 5 E2E) é mandatório.

### Alt 3: Apenas 4 janelas fixas (commercial/after_hours/late_night/weekend)
**Rejeitada** — mesmo argumento do Copilot. Cliente quer customização real.

### Alt 4: Implementar agora vs daqui 2-3 dias após soak Copilot
**Adotado: agora** — Copilot estava 1h em prod, mas testes pesados confirmaram resolver. Cliente pediu, blast radius controlado por testes + retrocompat.

## Impacto

### Retrocompat
100%. Workflows legacy (sem `windows[]`) usam path legacy intocado. Backfill cria janela "Comercial" derivada — comportamento idêntico ao anterior verificado em prod (2 workflows Milennials sem regressão).

### Performance
- Resolver O(N) onde N≤6. Negligível.
- `computeNextWindowStart` worst-case 20160 iterações — sub-ms.
- Sem nova chamada SQL.

### Operacional
- 2 workflows backfilled automaticamente
- Edge function `process-workflow-executions` redeployada
- Cron 1min batch herda nova lógica imediato

## Riscos remanescentes

1. **Cron auto-resume não exercitado E2E**: confirmei `next_run_at` set + status `paused`. Mas o ciclo completo (cron desperta → chama executor → continua de onde parou) só será validado em 1min real após primeira execução paused.
2. **Handles dinâmicos UI**: react-flow precisa que designer use cores amber pra route. Sem testes E2E de drag-drop.
3. **`hold_until:` em loop infinito**: se janela alvo nunca abre (ex: `days: []`), executor fica em loop de pause-resume. Mitigação parcial: `computeNextWindowStart` retorna null pra janela inexistente, executor falha gracioso.
4. **Hybrid mode**: combinação `pass + hold_until + route` na mesma config aumenta combinações. Suportado pelo resolver (first-match), mas UI ainda exibe textbox simples — fácil errar sintaxe.

## Decisões correlatas
- [[ADR-2026-04-26-copilot-time-aware-behavior]] — base do resolver shared
- L004 (Anti-pattern Studio sem versionar) — Onda 5 nasceu versionada desde primeira migration

## Lições

**L005**: Reuso shared infra entre sistemas distintos só vale a pena se o primeiro consumidor já tem testes pesados. 32 unit + 5 E2E do Copilot validaram resolver antes de virar shared. Sem isso, bug TZ propaga.
