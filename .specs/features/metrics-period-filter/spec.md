# Metrics Period Filter — Specification

## Problem Statement

Os funis do Torque CRM (WhatsApp, Confirmacao, Propostas) possuem apenas dois modos de periodo para metricas: `Geral` e `Este mes`. Usuarios precisam de granularidade semanal e de intervalos customizados para analisar performance de vendas com precisao. Alem disso, a logica de periodo esta duplicada em cada pagina de funil sem abstracao compartilhada.

## Goals

- [ ] Expandir os modos de periodo de metricas para: `all`, `month`, `week`, `custom`
- [ ] Criar abstracao compartilhada que elimine duplicacao entre os 3 funis
- [ ] Preservar 100% da semantica temporal existente de cada pipe (sem regressoes)
- [ ] Manter qualidade visual, acessibilidade e dark mode

## Out of Scope

| Feature | Reason |
|---------|--------|
| Alterar queries no backend/banco | Contrato de dados atual ja suporta ranges arbitrarios |
| Filtrar kanban cards por periodo (WhatsApp/Confirmacao) | Apenas Propostas filtra kanban por periodo — preservar comportamento atual |
| Adicionar novos campos temporais no banco | Nao necessario |
| Alterar semantica de `metrics_period_at` | Regra de negocio existente |

---

## Semantica Temporal por Pipe (Preservar)

Regras criticas que NAO devem ser alteradas:

| Pipe | Campo temporal (period=month/week/custom) | Fallback | Notas |
|------|------------------------------------------|----------|-------|
| **WhatsApp** | `created_at` | — | Filtra apenas por data de criacao |
| **Confirmacao** | `metrics_period_at` | `created_at` (quando `metrics_period_at` is null) | Duas queries unidas |
| **Propostas (vendido/perdido)** | `metrics_period_at` | `closed_at` (quando `metrics_period_at` is null) | Duas queries unidas |
| **Propostas (in_progress)** | Sempre live (sem filtro temporal) | — | `inProgress` e `inProgressCount` vem sempre do pipe completo |

**Confirmacao**: Metricas sao calculadas inline a partir de `pipeData` filtrado localmente (NAO usa hook `usePipeConfirmacaoMetrics`). Essa abordagem sera mantida — a abstracao de periodo produz o range, mas o filtro local continua.

**Propostas + kanban**: Quando `period !== "all"`, o kanban de Propostas filtra cards via `isPropostaInPeriod()`. Esse comportamento sera preservado e estendido para `week` e `custom`.

---

## User Stories

### P1: Modo "Por semana" — MVP

**User Story**: Como usuario de vendas, quero filtrar metricas por semana corrente para acompanhar performance semanal.

**Why P1**: Granularidade semanal e a mais pedida apos mensal.

**Acceptance Criteria**:

1. WHEN usuario seleciona "Por semana" THEN sistema SHALL exibir metricas filtradas pela semana corrente (segunda a domingo, pt-BR)
2. WHEN semana corrente inicia em um mes e termina em outro THEN sistema SHALL incluir dados de ambos os meses
3. WHEN usuario troca de "Por semana" para "Geral" THEN sistema SHALL exibir metricas historicas completas sem delay perceptivel
4. WHEN "Por semana" esta ativo em Propostas THEN sistema SHALL filtrar tambem os cards do kanban (mesmo comportamento que "Este mes")

**Independent Test**: Selecionar "Por semana" no pipe WhatsApp e verificar que metricas refletem apenas leads criados na semana corrente.

**Requirement IDs**: MPF-01, MPF-02, MPF-03, MPF-04

---

### P1: Modo "Personalizado" — MVP

**User Story**: Como gestor de vendas, quero selecionar um intervalo customizado de datas para analisar periodos especificos (trimestre, quinzena, etc).

**Why P1**: Essencial para analise retroativa e relatorios ad-hoc.

**Acceptance Criteria**:

1. WHEN usuario seleciona "Personalizado" THEN sistema SHALL exibir um date range picker (calendario)
2. WHEN usuario seleciona data inicial e final THEN sistema SHALL filtrar metricas pelo intervalo inclusivo [start 00:00:00, end 23:59:59]
3. WHEN usuario seleciona intervalo de 1 dia THEN sistema SHALL funcionar corretamente (start === end)
4. WHEN usuario ainda nao selecionou ambas as datas THEN sistema SHALL manter as metricas do periodo anterior ate a selecao estar completa
5. WHEN "Personalizado" esta ativo THEN sistema SHALL exibir texto resumo com o intervalo selecionado (ex: "13 abr - 20 abr 2026")
6. WHEN "Personalizado" esta ativo em Propostas THEN sistema SHALL filtrar kanban cards pelo intervalo customizado

**Independent Test**: Selecionar "Personalizado", escolher intervalo de 7 dias no calendario, verificar que metricas correspondem ao periodo.

**Requirement IDs**: MPF-05, MPF-06, MPF-07, MPF-08, MPF-09, MPF-10

---

### P1: Abstracao compartilhada — MVP

**User Story**: Como desenvolvedor, quero uma abstracao unica para periodo de metricas para nao duplicar logica entre os 3 funis.

**Why P1**: Eliminar duplicacao e a base que viabiliza os novos modos.

**Acceptance Criteria**:

1. WHEN qualquer funil precisa de periodo THEN sistema SHALL usar tipo compartilhado `MetricsPeriod` e funcao `getDateRange()` de um unico local
2. WHEN componente `MetricsPeriodSelector` e renderizado THEN sistema SHALL exibir tabs com 4 opcoes: Geral, Por mes, Por semana, Personalizado
3. WHEN periodo e `month` THEN sistema SHALL exibir dropdowns de mes/ano (comportamento atual preservado)
4. WHEN periodo e `week` THEN sistema SHALL nao exibir dropdowns extras (semana corrente automatica)
5. WHEN periodo e `custom` THEN sistema SHALL exibir date range picker inline

**Independent Test**: Montar `MetricsPeriodSelector` isolado e verificar que todos os 4 modos produzem o range correto.

**Requirement IDs**: MPF-11, MPF-12, MPF-13, MPF-14, MPF-15

---

## Edge Cases

- WHEN semana corrente cruza virada de ano (ex: dez 2026 → jan 2027) THEN sistema SHALL calcular range corretamente
- WHEN usuario seleciona intervalo customizado que cruza meses THEN sistema SHALL incluir dados de ambos os meses
- WHEN usuario limpa selecao do calendario THEN sistema SHALL voltar ao estado anterior sem quebrar
- WHEN usuario alterna rapidamente entre modos THEN sistema SHALL nao disparar queries desnecessarias (staleTime existente + debounce natural)
- WHEN nao ha dados no periodo selecionado THEN sistema SHALL exibir metricas zeradas (comportamento atual)
- WHEN `metrics_period_at` e null em Confirmacao/Propostas THEN sistema SHALL usar fallback (`created_at` / `closed_at`) conforme regra existente

---

## Requirement Traceability

| Requirement ID | Story | Status |
|---------------|-------|--------|
| MPF-01 | P1: Semana — filtrar pela semana corrente | Pending |
| MPF-02 | P1: Semana — cruzar meses | Pending |
| MPF-03 | P1: Semana — troca rapida entre modos | Pending |
| MPF-04 | P1: Semana — filtrar kanban Propostas | Pending |
| MPF-05 | P1: Custom — date range picker | Pending |
| MPF-06 | P1: Custom — intervalo inclusivo | Pending |
| MPF-07 | P1: Custom — intervalo de 1 dia | Pending |
| MPF-08 | P1: Custom — manter periodo anterior ate selecao completa | Pending |
| MPF-09 | P1: Custom — texto resumo do intervalo | Pending |
| MPF-10 | P1: Custom — filtrar kanban Propostas | Pending |
| MPF-11 | P1: Abstracao — tipo e funcao unicos | Pending |
| MPF-12 | P1: Abstracao — componente com 4 tabs | Pending |
| MPF-13 | P1: Abstracao — dropdowns mes/ano no modo month | Pending |
| MPF-14 | P1: Abstracao — semana corrente automatica | Pending |
| MPF-15 | P1: Abstracao — date range picker no modo custom | Pending |

**Coverage:** 15 total, 15 P1 (all MVP)

---

## Success Criteria

- [ ] Os 3 funis exibem 4 modos de periodo: Geral, Por mes, Por semana, Personalizado
- [ ] Metricas mudam corretamente em cada modo para cada pipe
- [ ] Nao ha regressao na semantica temporal existente
- [ ] Duplicacao de codigo de periodo reduzida significativamente
- [ ] Dark mode, acessibilidade e performance mantidos
- [ ] Build passa sem erros
- [ ] Lint passa sem erros

---

## Design Decisions (Inline — Medium Scope)

### Tipo compartilhado

```typescript
type MetricsPeriod = "all" | "month" | "week" | "custom";

interface DateRange {
  startStr: string; // ISO 8601
  endStr: string;   // ISO 8601
}
```

### Funcao utilitaria central

```typescript
// src/lib/metrics-period.ts
function getDateRange(period: MetricsPeriod, options?: {
  month?: number;
  year?: number;
  customStart?: Date;
  customEnd?: Date;
}): DateRange | null  // null quando period === "all"
```

- `all` → retorna `null` (sem filtro)
- `month` → usa month/year fornecidos (default: mes corrente)
- `week` → calcula segunda a domingo da semana corrente
- `custom` → usa customStart/customEnd fornecidos

### Componente UI

```
MetricsPeriodSelector
├── Tabs: Geral | Por mes | Por semana | Personalizado
├── [month mode] → Select mes + Select ano
├── [custom mode] → Calendar mode="range"
└── Texto resumo do periodo ativo
```

### Arquivos a criar/modificar

| Arquivo | Acao |
|---------|------|
| `src/lib/metrics-period.ts` | **Criar** — tipos + `getDateRange()` + helpers |
| `src/components/pipes/MetricsPeriodSelector.tsx` | **Criar** — componente UI reutilizavel |
| `src/hooks/usePipeMetrics.ts` | **Modificar** — expandir `MetricsPeriod`, aceitar `DateRange` |
| `src/pages/PipeWhatsapp.tsx` | **Modificar** — usar `MetricsPeriodSelector` + novo tipo |
| `src/pages/PipeConfirmacao.tsx` | **Modificar** — usar `MetricsPeriodSelector` + filtro local com range |
| `src/pages/PipePropostas.tsx` | **Modificar** — usar `MetricsPeriodSelector` + kanban filter com range |
