---
title: "Slice 3 (completar) — Catálogo de tools: writes restantes + mídia"
feature: copilot-v2-remodel
slice: "3"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-05-guardrails-handoff]]", "[[slice-06-asset-stores]]", "[[slice-07-ingestion-rag]]"]
branch: feat/copilot-v2/slice-3-tools-media
handoff: "design (UX tool/gatilho no wizard) → engenheiro"
security: true
tags: [copilot-v2, slice, execution-ready, media]
---

# Slice 3 (completar) — Tools restantes + mídia 🔒

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-3-tools-media` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev** (`bcfadphgsibjzivtbjvc`). Migration via **MCP `apply_migration`** (nunca `db push` — prod tem drift). Cada migration é **committed-not-applied**: dev tem drift (a fundação copilot-v2 pode faltar), então o executor **valida o que existe em dev (`supabase migration list --project-ref bcfadphgsibjzivtbjvc`) ANTES de aplicar** e aplica via MCP na ordem do timestamp; fundação faltando + não-aplicável → **parar e sinalizar**. Migrations são **imutáveis** → sempre NOVA migration com timestamp real (`date -u +%Y%m%d%H%M%S`), nunca editar uma existente. TDD: incidente→regressão (teste-que-falha primeiro). QA com counts literais do runner (output cru do vitest/lint/build, nunca "all green" parafraseado).
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (§5 Slice 3, §9 apêndice) · ADR: `docs/adr/0002-copilot-v2-architecture.md` (decisões #5, #6, #7, #12 + Emenda áudio §1) · Dep dura: [[slice-1H-harness-hardening]] (#677, MERGEADO) + fundação 0-C (MERGEADA) — **satisfeito**.

---

# Slice 3 (completar) — Catálogo de tools v2: writes restantes + mídia (Copilot v2) 🔒

> 🔒 **Security-sensitive**: multi-tenant (`organization_id` SEMPRE do `ToolContext`/border/instância confiável, NUNCA do payload/LLM — invariante já fixada em `tool-executor.ts` linhas 5-13), mídia entregue via **signed URL de bucket privado** (nunca link público), Calendar OAuth com escopo por usuário responsável do lead, e **fallback explícito sem silent-drop** em todo caminho de falha de envio (lição do incidente VitrineVET — a v1 dropava a media-directive em silêncio, finding #6). Todo gate (capability, introspect, momento/repetição de mídia) falha **fail-CLOSED**.

## Goal

Completar o catálogo de tools v2 levando os 4 handlers hoje `not_implemented` ao estado funcional — **com a fronteira de propriedade explícita entre as slices da Fase B**. O **foco próprio e independente desta slice** (sem dono concorrente) é o par **`check_agenda_availability` + `schedule_meeting`** via o Google Calendar adapter (`_shared/google-calendar-utils.ts`), com **write-after-introspect** (`check_agenda_availability` ANTES de `schedule_meeting`, ou bloqueio fail-CLOSED) gravando em `pipe_confirmacao` (`pipeline-adapter.upsertPipeEntry`, stage `reuniao_marcada`) — isso recebe o maior peso de Tasks. Os demais handlers são **integração/registro coordenada**: `handoff_to_vendedor` (Slice 3 é dono do handler — reassign + payload estruturado; a infra de notificação é do Slice 5), `send_media` (Slice **6** é dono canônico do handler acervo-aware + `media-mime.ts`/`send-media-selector.ts`; Slice 3 só consolida o **contrato no tool-registry** com áudio + o introspect/capability), e `search_knowledge` (Slice **7** é dono do RPC `copilot_v2_match_knowledge` + handler; Slice 3 mantém `not_implemented` honesto com teste de contrato). Ver `## ⚠️ Decisões abertas` pra as fronteiras anotadas.

## Architecture

Pipeline real tocado (leia ponta-a-ponta antes de começar):

```
copilot-v2-worker/index.ts (I/O shell)
  → resolveContext (contact-status → archetype; config/caps; introspection)   [Slice 1-H, intocado]
  → processBatch → queue-processor.ts → cognition-worker.ts → cognition-loop.ts
       por tool-call: budget → capability-gate → write-after-introspect(introspect-guard.ts)
  → tool-executor.ts  createToolExecutor → HANDLERS[name]
       ├─ check_agenda_availability (READ/introspect)  ◄── NOVO (Slice 3, foco próprio)
       │     └─ google-calendar-utils.getValidAccessToken(responsibleUserId) → freeBusy/events list
       ├─ schedule_meeting (WRITE, after-introspect)    ◄── NOVO (Slice 3, foco próprio)
       │     └─ introspect-guard valida o slot escolhido contra os horários introspectados
       │     └─ pipeline-adapter.upsertPipeEntry(slug:"confirmacao", stageKey:"reuniao_marcada")
       │     └─ Google Calendar createEvent (graceful — degrada sem travar o agendamento)
       ├─ handoff_to_vendedor (WRITE)                   ◄── NOVO (Slice 3, dono do handler)
       │     └─ reassign lead→owner do agente Vendedor ativo + retorna payload estruturado
       │     └─ dispatchHandoffNotification (DEP injetada; infra real = Slice 5)
       ├─ send_media (WRITE)                            ◄── Slice 6 implementa o handler real
       │     └─ Slice 3: só o CONTRATO (registry + áudio na descrição + introspect/capability)
       └─ search_knowledge (READ)                       ◄── Slice 7 implementa o handler real
             └─ Slice 3: mantém not_implemented honesto + teste de contrato
```

Módulos REAIS tocados/citados:
- `_shared/copilot-v2/tool-executor.ts` (217-227 `HANDLERS`, 234-242 `createToolExecutor`, 18-25 `ToolContext`) — adiciona handlers + deps injetadas.
- `_shared/copilot-v2/tool-registry.ts` (33-51 `TOOL_REGISTRY`, 60-70 `writeTargetOf`) — `schedule_meeting` ganha `targetArg`; `send_media` ganha "áudio" na descrição (contrato).
- `_shared/copilot-v2/introspect-guard.ts` (13-16 `Introspection`, 31-35 `TARGET_COLLECTION`) — adiciona a coleção `slots` (horários introspectados) pro `schedule_meeting`.
- `_shared/copilot-v2/cognition-worker.ts` (22-29 `ResolvedContext`, 75 `introspection`) — `Introspection` ganha `slots`.
- `copilot-v2-worker/index.ts` (76-82 `makeExecutor`, 157-161 introspection) — injeta as deps de I/O (calendar, handoff dispatch) + popula `introspection.slots`.
- `_shared/google-calendar-utils.ts` (`getValidAccessToken` 144-179, `logCalendarOp` 266-293) — adapter de leitura/escrita.
- `_shared/pipeline-adapter.ts` (`upsertPipeEntry`/`updatePipeEntryById`) — grava `pipe_confirmacao`.

Decisão segue o padrão da fundação: **lógica pura** em módulos testáveis sem DB (gates/selectors), a edge fn/handler como **shell I/O**. `organization_id` NUNCA vem do LLM — vem do `ctx` (resolvido pelo worker da instância). O `responsibleUserId` do Calendar vem do lead (`responsible_id` → fallback `sdr_id`), nunca do payload.

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` com `.ts` explícito).
- **Supabase Postgres** RPCs (`SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role`) quando houver SQL; RLS deny-all default.
- **Google Calendar** via `_shared/google-calendar-utils.ts` (OAuth por `user_id` do responsável, AES-256-GCM tokens, freeBusy/events v3).
- **Tests: Vitest** (NÃO `deno test`). Os specs copilot-v2 vivem em `tests/unit/copilot-v2/*.test.ts` e importam os fontes `.ts` Deno via path relativo (`../../../supabase/functions/_shared/copilot-v2/x.ts`); o Vite transform do Vitest resolve a extensão `.ts`.
  - Arquivo único: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Suíte copilot-v2 inteira: `npx vitest run tests/unit/copilot-v2/`
  - Verificado funcionando no 1-H: `npx vitest run tests/unit/copilot-v2/tool-executor.test.ts`.
  - **NÃO** passar `--reporter=basic` (falha ao carregar o reporter neste repo — usar o reporter default).

## Setup

- [ ] Criar a branch a partir de `develop`:

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-3-tools-media
```

- [ ] Baseline verde da suíte copilot-v2 antes de tocar nada (anotar counts literais pra comparar no fim):

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes (o 1-H deixou ~23 files). Anotar `Test Files` / `Tests` literais.

**Migration policy do slice**: Tasks 1-5 são **edge/TS-only — SEM migration nova** (o `pipe_confirmacao` write reusa `pipeline-adapter`; o Calendar reusa `google_calendar_tokens`; o handoff reusa `copilot_v2_set_human_pause`/colunas de lead existentes). Se o executor concluir que precisa de uma coluna de tracking de slot agendado, **parar e sinalizar** antes de criar migration (provável fronteira com Slice 8/11 — não inventar schema). `send_media`/`search_knowledge` NÃO criam schema aqui (donos = Slice 6/7). **PROD PROIBIDO** sem autorização explícita do CTO na sessão.

---

## Task 1 — `Introspection.slots` + `schedule_meeting` ganha `targetArg` (write-after-introspect de agenda)

**Problem**: `schedule_meeting` é um write tool (`tool-registry.ts` linha 46, `capability: "can_schedule_meeting"`) mas **não tem `targetArg`** — então no `introspect-guard.ts` ele cai no ramo "tools sem target estrutural" (linhas 44-46: `if (!collection) return { ok: true }`). Resultado: o write-after-introspect só barra `missing_introspect` (introspection ausente), mas **não** valida que o horário escolhido foi de fato introspectado como livre. A ADR #6 exige que **toda** escrita aponte pra uma entidade que existe na introspecção viva (`check_agenda_availability` ANTES de `schedule_meeting`) — sem o `targetArg` + a coleção `slots`, o agente pode `schedule_meeting` num horário que nunca checou (a classe de bug "ação sobre entidade fantasma"). Hoje `Introspection` (`introspect-guard.ts` 13-16) só tem `stages`/`fields`.

**Fix**: (a) `Introspection` ganha `slots: string[]` (horários ISO confirmados livres por `check_agenda_availability` no turno); (b) `TARGET_COLLECTION` mapeia `schedule_meeting → "slots"`; (c) o registry dá a `schedule_meeting` o `targetArg: "datetime"`. Resultado: um `schedule_meeting` num `datetime` que não está em `introspection.slots` → `orphaned_target` (bloqueado, fail-CLOSED). Tudo puro/testável.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/introspect-guard.ts` — `Introspection.slots` (13-16) + `TARGET_COLLECTION` (31-35).
- **Modify** `supabase/functions/_shared/copilot-v2/tool-registry.ts` — `schedule_meeting` ganha `targetArg: "datetime"` (linha 46).
- **Modify** `supabase/functions/_shared/copilot-v2/cognition-worker.ts` — `ResolvedContext.introspection` agora carrega `slots` (a interface `Introspection` é a fonte; só re-exporta).
- **Modify** `tests/unit/copilot-v2/introspect-guard.test.ts` — `ctx`/literais de `Introspection` ganham `slots: []`; adicionar casos de `schedule_meeting`.
- **Modify** `tests/unit/copilot-v2/cognition-worker.test.ts` + `tests/unit/copilot-v2/queue-processor*.test.ts` — literais `introspection: { stages, fields }` ganham `slots: []`.

### Steps

- [ ] Ler o ramo "sem target" do guard (`introspect-guard.ts` 43-52) e o mapa (31-35):

```ts
const TARGET_COLLECTION: Record<string, keyof Introspection> = {
  move_lead_stage: "stages",
  fill_lead_field: "fields",
};
```

- [ ] Escrever o teste que falha. Estender `tests/unit/copilot-v2/introspect-guard.test.ts` (os literais de `Introspection` precisam de `slots` — esse é o primeiro red de TS). Adicionar o `describe`:

```ts
describe('assertWriteTarget — schedule_meeting (write-after-introspect de agenda)', () => {
  const introspected = { stages: ['abordado'], fields: ['cnpj'], slots: ['2026-06-10T14:00:00-03:00'] };

  it('permite agendar num horário que check_agenda_availability introspectou como livre', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T14:00:00-03:00', introspected }))
      .toEqual({ ok: true, reason: null });
  });

  it('BLOQUEIA (orphaned_target) agendar num horário que nunca foi introspectado', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T18:00:00-03:00', introspected }))
      .toEqual({ ok: false, reason: 'orphaned_target' });
  });

  it('fail-CLOSED: schedule_meeting sem introspecção alguma → missing_introspect', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T14:00:00-03:00', introspected: null }))
      .toEqual({ ok: false, reason: 'missing_introspect' });
  });
});
```

  E confirmar que o registry expõe o `targetArg` — adicionar em `tests/unit/copilot-v2/tool-registry.test.ts` (se existir; senão, criar uma asserção no introspect-guard test importando `writeTargetOf`):

```ts
import { writeTargetOf } from '../../../supabase/functions/_shared/copilot-v2/tool-registry.ts';
it('writeTargetOf extrai o datetime de schedule_meeting (introspect target)', () => {
  expect(writeTargetOf('schedule_meeting', { datetime: '2026-06-10T14:00:00-03:00' }))
    .toBe('2026-06-10T14:00:00-03:00');
});
```

- [ ] Rodar — esperar FALHAR (literais sem `slots` → erro de tipo; `schedule_meeting` sem `targetArg` → `writeTargetOf` devolve `null`; o guard libera horário fantasma):

```bash
npx vitest run tests/unit/copilot-v2/introspect-guard.test.ts tests/unit/copilot-v2/tool-registry.test.ts
```

Esperado: `Test Files ... failed` — `slots` ausente / `orphaned_target` não dispara / `writeTargetOf` `null`.

- [ ] Implementar. `introspect-guard.ts` — interface (13-16) + mapa (31-35):

```ts
export interface Introspection {
  stages: string[];
  fields: string[];
  /** ISO datetimes confirmed FREE by check_agenda_availability this turn. */
  slots: string[];
}
```

```ts
const TARGET_COLLECTION: Record<string, keyof Introspection> = {
  move_lead_stage: "stages",
  fill_lead_field: "fields",
  schedule_meeting: "slots",
};
```

  `tool-registry.ts` — `schedule_meeting` ganha o `targetArg` (linha 46):

```ts
  { name: "schedule_meeting", kind: "write", capability: "can_schedule_meeting", targetArg: "datetime", description: "Agenda reunião em horário confirmado livre (após check_agenda_availability).", parameters: obj({ datetime: str("ISO 8601 — um dos horários retornados por check_agenda_availability"), title: str("título") }, ["datetime"]) },
```

- [ ] Atualizar TODOS os literais de `Introspection` nos testes vizinhos pra incluir `slots: []`: `cognition-worker.test.ts` (builder `ctx()` — `introspection: { stages: [...], fields: [], slots: [] }`), `queue-processor.test.ts`, `queue-processor-outbound.test.ts`, `queue-processor-pause.test.ts`, `queue-processor-failmark.test.ts` (os `as ResolvedContext` cobrem o cast; tornar explícito onde o objeto é tipado).

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/introspect-guard.test.ts tests/unit/copilot-v2/tool-registry.test.ts tests/unit/copilot-v2/cognition-worker.test.ts
```

Esperado: todos passam (os novos casos de `schedule_meeting` + os vizinhos com `slots`).

- [ ] **Segurança**: o write-after-introspect de agenda agora é estrutural — `schedule_meeting` num horário não introspectado é bloqueado server-side (fail-CLOSED), além do capability-gate `can_schedule_meeting`. O LLM nunca escolhe um horário fora do que `check_agenda_availability` retornou de verdade.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/introspect-guard.ts \
        supabase/functions/_shared/copilot-v2/tool-registry.ts \
        tests/unit/copilot-v2/introspect-guard.test.ts \
        tests/unit/copilot-v2/tool-registry.test.ts \
        tests/unit/copilot-v2/cognition-worker.test.ts \
        tests/unit/copilot-v2/queue-processor.test.ts \
        tests/unit/copilot-v2/queue-processor-outbound.test.ts \
        tests/unit/copilot-v2/queue-processor-pause.test.ts \
        tests/unit/copilot-v2/queue-processor-failmark.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): write-after-introspect de agenda (schedule_meeting targetArg)

schedule_meeting era write sem targetArg, entao o introspect-guard so barrava
missing_introspect — nao validava o horario contra a agenda introspectada.
Introspection ganha slots[] (horarios confirmados livres por
check_agenda_availability); TARGET_COLLECTION mapeia schedule_meeting->slots;
o registry da targetArg datetime. Agendar horario nao-introspectado ->
orphaned_target (fail-CLOSED). ADR #6.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Módulo puro `agenda.ts`: normalização de slots + decisão de agendamento (sem I/O)

**Problem**: o handler `check_agenda_availability` (Task 3) e `schedule_meeting` (Task 4) precisam de duas decisões **puras e testáveis sem DB/Calendar**, espelhando `rubric-engine`/`capability-gate`/`send-media-selector`:
1. **Normalização de slots** — dado o retorno da Google freeBusy (intervalos ocupados) + uma janela desejada, computar os horários livres como ISO strings determinísticas (os mesmos que vão pra `introspection.slots` da Task 1). A v1 espalhava esse cálculo no meio do I/O (`schedule-meeting.ts` 36-57 misturava janela comercial com fetch).
2. **Decisão de confirmação** — dado o `datetime` proposto + os slots livres, decidir `{ ok, reason }` (fail-CLOSED: horário fora dos livres, no passado, ou janela inválida → bloqueia). O introspect-guard (Task 1) já barra estruturalmente, mas o módulo puro dá a mensagem de motivo explícita que o handler devolve ao LLM.

**Fix** — módulo puro novo `_shared/copilot-v2/agenda.ts`:
- `computeFreeSlots({ busy, window, slotMinutes, now })` → `string[]` (ISO).
- `decideScheduleSlot({ datetime, freeSlots, now })` → `{ ok, reason }`.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/agenda.ts`.
- **Create** test `tests/unit/copilot-v2/agenda.test.ts`.

### Steps

- [ ] Ler a referência v1 de janela/slot pra ancorar o formato ISO + timezone default `America/Sao_Paulo` (`_shared/actions/schedule-meeting.ts` 84-90 monta `${date}T${time}:00`).

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/agenda.test.ts`:

```ts
/**
 * Slice 3 — agenda: cálculo puro de slots livres + decisão de agendamento (Copilot v2)
 *
 * O handler check_agenda_availability resolve a agenda via Google freeBusy (I/O);
 * este módulo é a decisão PURA: a partir dos intervalos ocupados + janela desejada,
 * computa os horários livres (ISO) que vão pra introspection.slots; e decide se um
 * datetime proposto é agendável. Fail-CLOSED: fora dos livres / no passado -> bloqueia.
 */
import { describe, it, expect } from 'vitest';
import { computeFreeSlots, decideScheduleSlot } from '../../../supabase/functions/_shared/copilot-v2/agenda.ts';

const NOW = new Date('2026-06-10T09:00:00-03:00');

describe('computeFreeSlots', () => {
  it('retorna os slots de 60min livres na janela, excluindo os ocupados', () => {
    const slots = computeFreeSlots({
      busy: [{ start: '2026-06-10T10:00:00-03:00', end: '2026-06-10T11:00:00-03:00' }],
      window: { start: '2026-06-10T09:00:00-03:00', end: '2026-06-10T12:00:00-03:00' },
      slotMinutes: 60,
      now: NOW,
    });
    expect(slots).toEqual([
      '2026-06-10T09:00:00.000-03:00',
      '2026-06-10T11:00:00.000-03:00',
    ]);
  });

  it('nunca propõe um slot no passado (fail-safe)', () => {
    const slots = computeFreeSlots({
      busy: [],
      window: { start: '2026-06-10T08:00:00-03:00', end: '2026-06-10T11:00:00-03:00' },
      slotMinutes: 60,
      now: NOW, // 09:00 — o slot das 08:00 é passado
    });
    expect(slots).not.toContain('2026-06-10T08:00:00.000-03:00');
    expect(slots[0]).toBe('2026-06-10T09:00:00.000-03:00');
  });

  it('janela inválida (end <= start) → lista vazia (nunca lança)', () => {
    expect(computeFreeSlots({ busy: [], window: { start: 'x', end: 'y' }, slotMinutes: 60, now: NOW })).toEqual([]);
  });
});

describe('decideScheduleSlot — fail-CLOSED', () => {
  const freeSlots = ['2026-06-10T11:00:00.000-03:00', '2026-06-10T14:00:00.000-03:00'];
  it('permite um datetime exatamente igual a um slot livre', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T11:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: true, reason: null });
  });
  it('bloqueia datetime que não está nos slots livres', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T15:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'slot_not_available' });
  });
  it('bloqueia datetime no passado', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T08:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'slot_in_past' });
  });
  it('bloqueia datetime malformado', () => {
    expect(decideScheduleSlot({ datetime: 'amanhã de tarde', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'invalid_datetime' });
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/agenda.test.ts
```

Esperado: `Test Files 1 failed` — import error em `agenda.ts`.

- [ ] Implementar `supabase/functions/_shared/copilot-v2/agenda.ts`:

```ts
/**
 * agenda — Copilot v2 scheduling decision core (Slice 3, PURE).
 *
 * Sem I/O. (a) computeFreeSlots transforma os intervalos OCUPADOS (Google
 * freeBusy) + uma janela desejada em horários LIVRES (ISO determinístico) — os
 * mesmos que vão pra Introspection.slots, fechando o write-after-introspect de
 * agenda. (b) decideScheduleSlot decide, fail-CLOSED, se um datetime proposto é
 * agendável (deve estar nos livres, não no passado, ISO válido). O Google
 * Calendar I/O (token + fetch) vive no handler/worker.
 */

export interface BusyInterval { start: string; end: string; }
export interface TimeWindow { start: string; end: string; }

export interface FreeSlotsInput {
  busy: BusyInterval[];
  window: TimeWindow;
  /** Duração de cada slot proposto (default 60). */
  slotMinutes: number;
  now: Date;
}

const MS = 60_000;

/** ISO com offset preservado da janela (canônico p/ comparar com o datetime do LLM). */
function isoOf(d: Date, sample: string): string {
  // Preserva o offset textual da janela (ex.: -03:00) pra o slot bater 1:1 com
  // o que o LLM devolve. Sem isso, a comparação por string falharia entre Z e -03.
  const m = sample.match(/([+-]\d{2}:\d{2}|Z)$/);
  const offset = m ? m[1] : "Z";
  if (offset === "Z") return d.toISOString();
  const sign = offset[0] === "-" ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const shifted = new Date(d.getTime() + sign * (oh * 60 + om) * MS);
  return shifted.toISOString().replace("Z", offset);
}

export function computeFreeSlots(input: FreeSlotsInput): string[] {
  const winStart = new Date(input.window.start).getTime();
  const winEnd = new Date(input.window.end).getTime();
  if (isNaN(winStart) || isNaN(winEnd) || winEnd <= winStart) return [];

  const step = input.slotMinutes * MS;
  const busy = input.busy
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .filter((b) => !isNaN(b.s) && !isNaN(b.e));

  const free: string[] = [];
  for (let t = winStart; t + step <= winEnd; t += step) {
    if (t < input.now.getTime()) continue; // nunca propõe passado
    const slotEnd = t + step;
    const overlaps = busy.some((b) => t < b.e && slotEnd > b.s);
    if (!overlaps) free.push(isoOf(new Date(t), input.window.start));
  }
  return free;
}

export interface ScheduleSlotInput {
  datetime: string;
  freeSlots: string[];
  now: Date;
}

export type ScheduleDenyReason = "invalid_datetime" | "slot_in_past" | "slot_not_available";

export function decideScheduleSlot(
  input: ScheduleSlotInput,
): { ok: boolean; reason: ScheduleDenyReason | null } {
  const t = new Date(input.datetime).getTime();
  if (isNaN(t)) return { ok: false, reason: "invalid_datetime" };
  if (t < input.now.getTime()) return { ok: false, reason: "slot_in_past" };
  return input.freeSlots.includes(input.datetime)
    ? { ok: true, reason: null }
    : { ok: false, reason: "slot_not_available" };
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/agenda.test.ts
```

Esperado: `Test Files 1 passed (1)` / `Tests 7 passed (7)`.

- [ ] **Segurança**: módulo puro, sem PII, sem org. A decisão é determinística — o LLM não pode forjar um slot livre (só `computeFreeSlots` a partir do freeBusy real os produz; `decideScheduleSlot` rejeita qualquer outro).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/agenda.ts \
        tests/unit/copilot-v2/agenda.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): modulo puro agenda (free-slots + decisao de agendamento)

computeFreeSlots transforma freeBusy(ocupados)+janela em horarios LIVRES ISO
deterministicos (alimentam introspection.slots); decideScheduleSlot decide
fail-CLOSED se um datetime e agendavel (nos livres, nao no passado, ISO valido).
Mata a heuristica de janela espalhada no I/O da v1. Sem rede/DB.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Handler `check_agenda_availability` (READ via Google Calendar adapter)

**Problem**: `check_agenda_availability` está no registry (`tool-registry.ts` linha 41, kind `read`) e no capability-gate como read-tool (`capability-gate.ts` 18, 47) mas **NÃO tem handler** em `HANDLERS` → `createToolExecutor` lança `not_implemented` (`tool-executor.ts` 238-240). Sem ele, o `schedule_meeting` não tem como ser precedido por uma introspecção de agenda — o write-after-introspect (Task 1) bloquearia TODO agendamento (`missing_introspect`), tornando a capability inútil. É o introspect-read do par.

**Fix**: implementar `checkAgendaAvailability: Handler` que: (1) resolve o `responsibleUserId` do lead (`responsible_id` → `sdr_id`, org do ctx); (2) obtém o token via `getValidAccessToken` (dep injetada `getCalendarFreeBusy` pra manter o executor testável sem Google); (3) chama freeBusy na janela pedida; (4) computa os slots livres via `computeFreeSlots` (Task 2); (5) **retorna os slots E o worker os injeta em `introspection.slots`** (Task 5 fecha esse loop) — o handler devolve `{ slots, freeBusyOk }`. Sem responsável com Calendar conectado → `{ slots: [], reason: "no_calendar" }` **explícito** (fallback honesto, não silent — o agente avisa que não consegue ver a agenda).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/tool-executor.ts` — `ToolContext` ganha dep opcional `getCalendarFreeBusy`; handler `checkAgendaAvailability`; registrar em `HANDLERS`.
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — bateria do handler (resolve responsável, computa slots, fallback `no_calendar`).

### Steps

- [ ] Reler o ponto de extensão (`tool-executor.ts` 18-25 `ToolContext`, 36 `Handler`, 217-227 `HANDLERS`) e o adapter (`google-calendar-utils.ts getValidAccessToken` 144-179).

- [ ] Escrever o teste que falha. Adicionar em `tests/unit/copilot-v2/tool-executor.test.ts`:

```ts
import { computeFreeSlots } from '../../../supabase/functions/_shared/copilot-v2/agenda.ts';

describe('check_agenda_availability (read via calendar adapter)', () => {
  const agendaCtx = { organizationId: 'org-1', leadId: 'lead-1', canonicalPhone: '11987654321' };

  function execWithCalendar(sb: any, freeBusyImpl: any, over: Record<string, unknown> = {}) {
    return createToolExecutor(sb, {
      ...agendaCtx,
      getCalendarFreeBusy: freeBusyImpl,
      now: new Date('2026-06-10T09:00:00-03:00'),
      ...over,
    } as any);
  }

  it('resolve o responsável do lead e devolve os slots livres da janela', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', responsible_id: 'm-resp', sdr_id: null } });
    const freeBusy = async () => ({ ok: true, busy: [{ start: '2026-06-10T10:00:00-03:00', end: '2026-06-10T11:00:00-03:00' }] });
    const out: any = await execWithCalendar(sb, freeBusy)('check_agenda_availability', { date_range: '2026-06-10T09:00:00-03:00/2026-06-10T12:00:00-03:00' });
    expect(out.slots).toContain('2026-06-10T09:00:00.000-03:00');
    expect(out.slots).not.toContain('2026-06-10T10:00:00.000-03:00'); // ocupado
    const q = sb.queries.find((x: any) => x.table === 'leads')!;
    expect(q.filters).toContainEqual(['organization_id', 'org-1']);
  });

  it('FALLBACK EXPLÍCITO no_calendar quando o responsável não tem Calendar conectado', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', responsible_id: 'm-resp' } });
    const freeBusy = async () => ({ ok: false, busy: [] }); // sem token
    const out: any = await execWithCalendar(sb, freeBusy)('check_agenda_availability', { date_range: 'x/y' });
    expect(out).toMatchObject({ slots: [], reason: 'no_calendar' });
  });
});
```

- [ ] Rodar — esperar FALHAR (handler ausente → `not_implemented`):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

Esperado: os novos casos falham; os 10 grupos pré-existentes (incl. Task 1 sem mudança aqui) passam.

- [ ] Implementar em `tool-executor.ts`. Imports (topo):

```ts
import { computeFreeSlots, decideScheduleSlot } from "./agenda.ts";
```

  Estender `ToolContext` (após `agentId`, 18-25) com as deps injetadas + `now` (testabilidade):

```ts
export interface ToolContext {
  organizationId: string;
  leadId?: string | null;
  conversationId?: string | null;
  canonicalPhone?: string | null;
  /** The active agent for this turn (needed to load its rubric). */
  agentId?: string | null;
  /** Injected clock (tests pin it); the worker passes new Date(). */
  now?: Date;
  /**
   * Calendar freeBusy I/O (injected by the worker). Pure tests pass a fake.
   * Returns busy intervals for the lead's responsible user, or ok:false when no
   * connected calendar (→ honest no_calendar fallback, never a silent empty).
   */
  getCalendarFreeBusy?: (p: { userId: string; window: { start: string; end: string } }) =>
    Promise<{ ok: boolean; busy: { start: string; end: string }[] }>;
  /** Scheduling I/O sink (injected by the worker) — Task 4. */
  scheduleMeetingViaCalendar?: (p: {
    userId: string; leadId: string; datetime: string; title: string;
  }) => Promise<{ created: boolean; meetLink?: string | null; error?: string }>;
  /** Handoff notification dispatch (injected by the worker; infra = Slice 5) — Task 5. */
  dispatchHandoffNotification?: (p: {
    leadId: string; reason: string; summary: string | null; targetArchetype: "vendedor";
  }) => Promise<{ dispatched: boolean; reason?: string }>;
}
```

  Helper de janela + handler (junto aos read handlers):

```ts
/** Parse "<ISO>/<ISO>" (date_range) → window; default = próximas 48h. */
function parseWindow(dateRange: unknown, now: Date): { start: string; end: string } {
  if (typeof dateRange === "string" && dateRange.includes("/")) {
    const [start, end] = dateRange.split("/");
    if (!isNaN(new Date(start).getTime()) && !isNaN(new Date(end).getTime())) return { start, end };
  }
  return { start: now.toISOString(), end: new Date(now.getTime() + 48 * 3600_000).toISOString() };
}

async function resolveResponsibleUserId(supabase: any, ctx: ToolContext): Promise<string | null> {
  if (!ctx.leadId) return null;
  const { data: lead } = await supabase
    .from("leads").select("responsible_id, sdr_id")
    .eq("organization_id", ctx.organizationId).eq("id", ctx.leadId).maybeSingle();
  return lead?.responsible_id ?? lead?.sdr_id ?? null;
}

const checkAgendaAvailability: Handler = async (supabase, ctx, args) => {
  const now = ctx.now ?? new Date();
  const userId = await resolveResponsibleUserId(supabase, ctx);
  if (!userId || !ctx.getCalendarFreeBusy) return { slots: [], reason: "no_calendar" };

  const window = parseWindow(args.date_range, now);
  const fb = await ctx.getCalendarFreeBusy({ userId, window });
  if (!fb.ok) return { slots: [], reason: "no_calendar" };

  const slots = computeFreeSlots({ busy: fb.busy, window, slotMinutes: 60, now });
  return { slots, window, reason: null };
};
```

  Registrar em `HANDLERS` (junto aos reads):

```ts
  list_custom_fields: listCustomFields,
  check_agenda_availability: checkAgendaAvailability,
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

Esperado: handler + grupos antigos verdes.

- [ ] **Segurança**: `organization_id` SEMPRE do ctx (lead filtrado por org). O `responsibleUserId` vem do lead (DB), nunca do payload/LLM. O Calendar I/O é dep injetada (o worker usa `getValidAccessToken` do usuário responsável — escopo OAuth por pessoa). Fallback `no_calendar` é explícito (o agente avisa, não inventa horário).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/tool-executor.ts \
        tests/unit/copilot-v2/tool-executor.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): handler check_agenda_availability (read via Calendar adapter)

Resolve o responsavel do lead (responsible_id->sdr_id, org do ctx), consulta a
agenda via dep injetada getCalendarFreeBusy (worker usa getValidAccessToken),
computa os slots livres (computeFreeSlots) na janela pedida. Sem Calendar
conectado -> fallback explicito no_calendar (nunca lista vazia silenciosa).
Os slots alimentam introspection.slots (write-after-introspect de agenda).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Handler `schedule_meeting` (WRITE after-introspect → `pipe_confirmacao` + Google Calendar graceful)

**Problem**: `schedule_meeting` está em `HANDLERS` ausente → `not_implemented` (`tool-executor.ts` 238-240). O agente não consegue marcar reunião. A v1 (`_shared/actions/schedule-meeting.ts`) entregava mas misturava janela comercial + I/O + degradação no mesmo bloco (22-171); reusamos a **forma** (grava `pipe_confirmacao` via `pipeline-adapter`, Calendar como graceful degradation) mas com a decisão pura separada (Task 2) e o introspect-guard estrutural (Task 1).

**Fix**: implementar `scheduleMeeting: Handler` que: (1) exige `ctx.leadId` + `args.datetime`; (2) re-valida o slot com `decideScheduleSlot` contra os slots livres recomputados (o introspect-guard upstream já barrou, mas o handler dá o motivo explícito + defesa em profundidade contra um `introspection.slots` stale); (3) grava `pipe_confirmacao` via `upsertPipeEntry` (dep injetada `upsertConfirmacaoEntry` pra testabilidade) stage `reuniao_marcada` + metadata `{ meeting_at }`; (4) tenta o Google Calendar via dep `scheduleMeetingViaCalendar` (graceful — falha do Calendar NÃO desfaz o agendamento no pipe, só não anexa `meet_link`); (5) retorna `{ scheduled: true, stage, meetLink }` ou bloqueio explícito. **Sem silent-drop**: todo caminho de falha devolve `{ scheduled: false, reason }`.

> **Nota de slots no handler**: como o handler é puro-ish (deps injetadas), recebe os `freeSlots` recomputados via uma dep `getFreeSlotsForValidation` OU re-deriva via `getCalendarFreeBusy` + `computeFreeSlots`. Pra evitar dupla chamada de Calendar no turno, o caminho canônico é: o introspect-guard (Task 1) JÁ garantiu que `datetime ∈ introspection.slots`; o handler revalida só **passado/ISO** via `decideScheduleSlot` com `freeSlots = [datetime]` (defesa contra clock-skew, não re-fetch). Mantém 1 chamada de Calendar por turno (o `check_agenda_availability`).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/tool-executor.ts` — handler `scheduleMeeting` + registrar em `HANDLERS` (dep `scheduleMeetingViaCalendar` + `upsertConfirmacaoEntry` no `ToolContext`).
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — bateria do handler.

### Steps

- [ ] Reler o write v1 de referência (`_shared/actions/schedule-meeting.ts` 59-69: `upsertPipeEntry(slug:"confirmacao", stageKey:"reuniao_marcada")`; 70-164: Calendar graceful).

- [ ] Escrever o teste que falha. Adicionar em `tool-executor.test.ts`:

```ts
describe('schedule_meeting (write after-introspect → pipe_confirmacao + calendar graceful)', () => {
  const meetCtx = { organizationId: 'org-1', leadId: 'lead-1', canonicalPhone: '11987654321', now: new Date('2026-06-10T09:00:00-03:00') };

  function execMeet(sb: any, calendar: any, confirmacao: any, over: Record<string, unknown> = {}) {
    return createToolExecutor(sb, {
      ...meetCtx,
      scheduleMeetingViaCalendar: calendar,
      upsertConfirmacaoEntry: confirmacao,
      ...over,
    } as any);
  }

  it('grava pipe_confirmacao (reuniao_marcada) e anexa meet_link quando o Calendar cria', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', responsible_id: 'm-resp' } });
    const confirmacao = async () => ({ pipeId: 'pe-1' });
    const calendar = async () => ({ created: true, meetLink: 'https://meet/x' });
    const out: any = await execMeet(sb, calendar, confirmacao)('schedule_meeting', { datetime: '2026-06-10T14:00:00.000-03:00', title: 'Discovery' });
    expect(out).toMatchObject({ scheduled: true, stage: 'reuniao_marcada', meetLink: 'https://meet/x' });
  });

  it('GRACEFUL: agendamento persiste mesmo se o Calendar falhar (sem meet_link, sem silent-drop)', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', responsible_id: 'm-resp' } });
    const confirmacao = async () => ({ pipeId: 'pe-1' });
    const calendar = async () => ({ created: false, error: 'google 403' });
    const out: any = await execMeet(sb, calendar, confirmacao)('schedule_meeting', { datetime: '2026-06-10T14:00:00.000-03:00' });
    expect(out).toMatchObject({ scheduled: true, stage: 'reuniao_marcada', meetLink: null, calendar: 'failed' });
  });

  it('bloqueio explícito quando o datetime está no passado (fail-CLOSED, sem write)', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1' } });
    let wrote = false;
    const out: any = await execMeet(sb, async () => ({ created: true }), async () => { wrote = true; return { pipeId: 'x' }; })(
      'schedule_meeting', { datetime: '2026-06-10T08:00:00.000-03:00' });
    expect(out).toMatchObject({ scheduled: false, reason: 'slot_in_past' });
    expect(wrote).toBe(false);
  });

  it('exige lead no contexto', async () => {
    const exec = createToolExecutor(mockSupabase({}), { organizationId: 'org-1', now: meetCtx.now } as any);
    await expect(exec('schedule_meeting', { datetime: '2026-06-10T14:00:00.000-03:00' })).rejects.toMatchObject({ code: 'missing_context' });
  });
});
```

- [ ] Rodar — esperar FALHAR (handler ausente):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

- [ ] Implementar em `tool-executor.ts`. Adicionar a dep `upsertConfirmacaoEntry` no `ToolContext` (junto às outras deps de I/O da Task 3):

```ts
  /** Persists the confirmacao pipe entry (injected; worker backs with pipeline-adapter). */
  upsertConfirmacaoEntry?: (p: { leadId: string; orgId: string; meetingAt: string; meetLink?: string | null }) =>
    Promise<{ pipeId: string | null }>;
```

  Handler (junto aos write handlers):

```ts
const CONFIRMACAO_STAGE = "reuniao_marcada";

const scheduleMeeting: Handler = async (supabase, ctx, args) => {
  if (!ctx.leadId) throw new ToolError("missing_context", "schedule_meeting:lead");
  const datetime = String(args.datetime ?? "");
  if (!datetime) throw new ToolError("missing_context", "schedule_meeting:datetime");
  const now = ctx.now ?? new Date();

  // Defesa em profundidade: o introspect-guard (Task 1) já garantiu que o
  // datetime estava nos slots introspectados; aqui revalidamos só passado/ISO
  // (clock-skew) sem re-bater no Calendar — fail-CLOSED com motivo explícito.
  const slot = decideScheduleSlot({ datetime, freeSlots: [datetime], now });
  if (!slot.ok) return { scheduled: false, reason: slot.reason };

  // 1. Grava o pipe_confirmacao (sempre — o agendamento é o efeito de negócio).
  if (!ctx.upsertConfirmacaoEntry) return { scheduled: false, reason: "no_pipe_writer" };
  const { pipeId } = await ctx.upsertConfirmacaoEntry({
    leadId: ctx.leadId, orgId: ctx.organizationId, meetingAt: datetime,
  });

  // 2. Google Calendar — GRACEFUL: falha NÃO desfaz o agendamento (só sem link).
  let meetLink: string | null = null;
  let calendar: "ok" | "failed" | "skipped" = "skipped";
  if (ctx.scheduleMeetingViaCalendar) {
    const userId = await resolveResponsibleUserId(supabase, ctx);
    if (userId) {
      const res = await ctx.scheduleMeetingViaCalendar({
        userId, leadId: ctx.leadId, datetime, title: String(args.title ?? "Reunião"),
      });
      if (res.created) { meetLink = res.meetLink ?? null; calendar = "ok"; }
      else calendar = "failed";
    }
  }

  return { scheduled: true, stage: CONFIRMACAO_STAGE, pipeId, meetLink, calendar, datetime };
};
```

  Registrar em `HANDLERS` (após `setQualificationTier`):

```ts
  set_qualification_tier: setQualificationTier,
  schedule_meeting: scheduleMeeting,
```

- [ ] Re-rodar — esperar PASSAR (handler + grupos antigos + `check_agenda_availability` da Task 3):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts tests/unit/copilot-v2/tool-registry.test.ts
```

- [ ] **Segurança**: `organization_id` do ctx (lead + pipe filtrados por org). `responsibleUserId` do lead (DB), nunca do payload. Calendar graceful degradation — falha do provider não trava o agendamento de negócio nem deixa o pipe inconsistente. Write-after-introspect (Task 1) + revalidação de passado (fail-CLOSED) = dupla barreira contra horário fantasma.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/tool-executor.ts \
        tests/unit/copilot-v2/tool-executor.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): handler schedule_meeting (after-introspect -> pipe_confirmacao)

schedule_meeting deixa de ser not_implemented: revalida o slot (fail-CLOSED,
defesa contra clock-skew), grava pipe_confirmacao (reuniao_marcada) via dep
injetada upsertConfirmacaoEntry, e tenta o Google Calendar GRACEFUL (falha do
provider nao desfaz o agendamento, so nao anexa meet_link). Todo caminho de
falha devolve motivo explicito — sem silent-drop. Reusa a forma do v1.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Handler `handoff_to_vendedor` (reassign + payload estruturado; notificação = dep do Slice 5) + fiação no worker

**Problem**: `handoff_to_vendedor` está em `HANDLERS` ausente → `not_implemented` (`tool-executor.ts` 238-240; registry linha 50, `capability: "can_handoff"`). É o mecanismo do ADR §4 ("Handoff `qualificador → vendedor`") — sem ele o Qualificador não passa o lead qualificado ao Vendedor. O `transfer_to_human` (173-192) já mostra o padrão (pausa + retorna payload estruturado; a notificação é a camada outbound, comentário 183-186). O `handoff_to_vendedor` é o irmão **agente→agente** (não humano): reassign do lead + sinalização ao Vendedor.

**Fix**: implementar `handoffToVendedor: Handler` que: (1) exige `ctx.leadId`; (2) **reassign** — garante que o lead esteja em estado QUALIFIED de forma que o roteamento determinístico (`get_contact_status`) passe o próximo turno ao arquétipo Vendedor (o roteamento já é por `qualification_tier` ∈ qualified — `tool-executor.ts` 140, 156-158; o handoff em si não força tier, mas registra a intenção e o resumo); concretamente grava o resumo + dispara a notificação; (3) chama `dispatchHandoffNotification` (dep injetada — a INFRA real é do **Slice 5** `handoff-routing.ts` + RPC fan-out; aqui só o ponto de chamada); (4) retorna `{ handed_off, targetArchetype: "vendedor", summary }`. fail-CLOSED: sem lead → `missing_context`; notificação ausente (Slice 5 não mergeado ainda) → `{ handed_off: true, notified: false, reason: "notify_pending" }` **explícito** (o handoff de negócio acontece; a notificação fica pendente — sem silent-drop).

> **Nota de ordering (soft-dep Slice 5):** o Slice **5** é dono da infra de notificação (`handoff-routing.ts` resolve destino role-aware + RPC fan-out org-scoped + realtime no sino + WhatsApp ao responsável). Esta slice (3) é dona do **handler** `handoff_to_vendedor`: faz o reassign/registro e **chama** a dep `dispatchHandoffNotification`. Quando o Slice 5 mergear, o worker passa a dep real; até lá a dep é `undefined` → caminho `notify_pending` (handoff acontece, notificação registrada como pendente). **Não bloqueia** (`status: ready`). Coordenação anotada em `## ⚠️ Decisões abertas`.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/tool-executor.ts` — handler `handoffToVendedor` + registrar em `HANDLERS`.
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — bateria do handler.
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — injeta as deps de I/O (`getCalendarFreeBusy`, `scheduleMeetingViaCalendar`, `upsertConfirmacaoEntry`, `dispatchHandoffNotification`, `now`) no `makeExecutor` + popula `introspection.slots` (fecha o loop da Task 1/3).

### Steps

- [ ] Reler o irmão `transferToHuman` (`tool-executor.ts` 173-192) e o `makeExecutor` do worker (`copilot-v2-worker/index.ts` 76-82) + onde a introspection é montada (157-178).

- [ ] Escrever o teste que falha. Adicionar em `tool-executor.test.ts`:

```ts
describe('handoff_to_vendedor (reassign + notificação como dep)', () => {
  const hoCtx = { organizationId: 'org-1', leadId: 'lead-1', canonicalPhone: '11987654321' };

  it('registra o handoff e dispara a notificação via dep (infra = Slice 5)', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1', responsible_id: 'm-resp' } });
    const dispatched: any[] = [];
    const exec = createToolExecutor(sb, {
      ...hoCtx,
      dispatchHandoffNotification: async (p: any) => { dispatched.push(p); return { dispatched: true }; },
    } as any);
    const out: any = await exec('handoff_to_vendedor', { summary: 'lead diamante, quer proposta' });
    expect(out).toMatchObject({ handed_off: true, targetArchetype: 'vendedor', notified: true });
    expect(dispatched[0]).toMatchObject({ leadId: 'lead-1', targetArchetype: 'vendedor', summary: 'lead diamante, quer proposta' });
  });

  it('FALLBACK EXPLÍCITO notify_pending quando a infra de notificação ainda não está plugada (Slice 5)', async () => {
    const sb = mockSupabase({ leads: { id: 'lead-1' } });
    const out: any = await createToolExecutor(sb, hoCtx as any)('handoff_to_vendedor', { summary: 's' });
    expect(out).toMatchObject({ handed_off: true, notified: false, reason: 'notify_pending' });
  });

  it('exige lead no contexto', async () => {
    await expect(createToolExecutor(mockSupabase({}), { organizationId: 'org-1' } as any)('handoff_to_vendedor', { summary: 's' }))
      .rejects.toMatchObject({ code: 'missing_context' });
  });
});
```

- [ ] Rodar — esperar FALHAR (handler ausente):

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts
```

- [ ] Implementar em `tool-executor.ts`. Handler (após `transferToHuman`):

```ts
const handoffToVendedor: Handler = async (_supabase, ctx, args) => {
  if (!ctx.leadId) throw new ToolError("missing_context", "handoff_to_vendedor:lead");
  const summary = args.summary != null ? String(args.summary) : null;

  // The structured handoff payload — the routing target + delivery is the Slice 5
  // notification infra (dispatchHandoffNotification dep). When that dep is absent
  // (Slice 5 not merged yet) the business handoff still happens; the notification
  // is reported pending — NEVER a silent drop.
  if (!ctx.dispatchHandoffNotification) {
    return { handed_off: true, targetArchetype: "vendedor", notified: false, reason: "notify_pending", summary };
  }
  const res = await ctx.dispatchHandoffNotification({
    leadId: ctx.leadId, reason: "handoff_qualificador_vendedor", summary, targetArchetype: "vendedor",
  });
  return { handed_off: true, targetArchetype: "vendedor", notified: res.dispatched, reason: res.reason ?? null, summary };
};
```

  Registrar em `HANDLERS` (após `transfer_to_human`):

```ts
  transfer_to_human: transferToHuman,
  handoff_to_vendedor: handoffToVendedor,
```

- [ ] Re-rodar o tool-executor — esperar PASSAR. Depois fiar o worker. Em `copilot-v2-worker/index.ts`, imports (topo):

```ts
import { getValidAccessToken } from "../_shared/google-calendar-utils.ts";
import { upsertPipeEntry } from "../_shared/pipeline-adapter.ts";
```

  Estender o `makeExecutor` (76-82) com as deps de I/O reais:

```ts
      makeExecutor: (row, context) => createToolExecutor(supabase, {
        organizationId: row.organization_id,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        canonicalPhone: row.canonical_phone,
        agentId: context._agentId,
        now: new Date(),
        getCalendarFreeBusy: async ({ userId, window }) => {
          try {
            const tok = await getValidAccessToken(userId, supabase);
            if (!tok) return { ok: false, busy: [] };
            const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
              method: "POST",
              headers: { Authorization: `Bearer ${tok.accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ timeMin: window.start, timeMax: window.end, items: [{ id: "primary" }] }),
            });
            if (!res.ok) return { ok: false, busy: [] };
            const j = await res.json();
            return { ok: true, busy: (j.calendars?.primary?.busy ?? []) as { start: string; end: string }[] };
          } catch { return { ok: false, busy: [] }; }
        },
        scheduleMeetingViaCalendar: async ({ userId, leadId, datetime, title }) => {
          try {
            const tok = await getValidAccessToken(userId, supabase);
            if (!tok) return { created: false, error: "no_token" };
            const start = new Date(datetime);
            const end = new Date(start.getTime() + 3600_000);
            const res = await fetch(
              "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
              {
                method: "POST",
                headers: { Authorization: `Bearer ${tok.accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  summary: title,
                  start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
                  end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
                  conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
                  extendedProperties: { private: { lead_id: leadId, system: "copilot_v2" } },
                }),
              },
            );
            if (!res.ok) return { created: false, error: `google ${res.status}` };
            const ev = await res.json();
            const link = ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? ev.hangoutLink ?? null;
            return { created: true, meetLink: link };
          } catch (e) { return { created: false, error: e instanceof Error ? e.message : String(e) }; }
        },
        upsertConfirmacaoEntry: async ({ leadId, orgId, meetingAt }) => {
          const pipeId = await upsertPipeEntry(supabase, {
            leadId, orgId, slug: "confirmacao", stageKey: "reuniao_marcada",
            metadata: { meeting_at: meetingAt },
          });
          return { pipeId: pipeId ?? null };
        },
        // dispatchHandoffNotification: <plugado pelo Slice 5 quando mergeado>
      }),
```

  E popular `introspection.slots` no `resolveContext` (157-178). Como os slots só existem APÓS `check_agenda_availability` rodar no turno, a fonte canônica é o resultado do read-tool (o `cognition-loop` injeta os results dos reads na conversa). **Caminho mínimo desta slice**: `resolveContext` inicializa `slots: []` (o introspect-guard fail-CLOSED bloqueia agendamento até o read rodar e popular). A propagação dinâmica dos slots do `check_agenda_availability` pro `introspection` do mesmo turno é uma melhoria do `cognition-loop` — **anotada como follow-up explícito** (ver `## ⚠️ Decisões abertas`), não escopo aqui. Adicionar `slots: []`:

```ts
    introspection: {
      stages: (stages ?? []).map((s: any) => s.stage_key),
      fields: (fields ?? []).map((f: any) => f.field_name),
      slots: [],
    },
```

- [ ] Re-rodar a suíte tocada:

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts tests/unit/copilot-v2/cognition-worker.test.ts
```

Esperado: todos verdes.

- [ ] **Segurança**: `organization_id` do ctx. O handoff não recebe org do payload. A notificação (quando plugada pelo Slice 5) faz fan-out SÓ dentro da org (destino derivado do lead, role-aware — `handoff-routing.ts`). Sem a infra, o handoff de negócio acontece e a notificação fica `notify_pending` explícito (auditável no result/trace). As deps de Calendar usam token OAuth do responsável (escopo por pessoa), token AES-GCM decriptado server-side.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/tool-executor.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/tool-executor.test.ts \
        tests/unit/copilot-v2/cognition-worker.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): handler handoff_to_vendedor + fiacao das deps I/O no worker

handoff_to_vendedor deixa de ser not_implemented: registra o handoff
qualificador->vendedor e dispara a notificacao via dep injetada
(dispatchHandoffNotification; infra real = Slice 5). Sem a infra -> notify_pending
explicito (handoff de negocio acontece, sem silent-drop). O worker passa as deps
reais de Calendar (freeBusy/createEvent via getValidAccessToken) + pipe_confirmacao
(upsertPipeEntry) + inicializa introspection.slots=[].

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Contrato de `send_media` (áudio no registry) + `search_knowledge` honesto + regressão full + build

**Goal**: consolidar o **contrato** dos 2 handlers cujos donos são outras slices (sem invadir a implementação), provar a suíte inteira verde, e confirmar build/typecheck (CI não tem gate `tsc` em edge — root memory `project_ci_no_typecheck_gate` — então verificamos localmente). **Fronteiras (ver `## ⚠️ Decisões abertas`):** o **handler** `send_media` é do **Slice 6** (acervo-aware + `media-mime`/`send-media-selector`); o **handler** `search_knowledge` é do **Slice 7** (RPC `copilot_v2_match_knowledge`). Slice 3 NÃO os implementa — só fixa o contrato e a honestidade do `not_implemented`.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/tool-registry.ts` — `send_media` description menciona `image|vídeo|áudio` (Emenda ADR §1) — contrato visível ao LLM; sem mudar `capability`/`parameters`.
- **Modify** `tests/unit/copilot-v2/tool-executor.test.ts` — manter `send_media`/`search_knowledge` como `not_implemented` (contrato honesto até Slice 6/7); asserir que o registry expõe áudio.

### Steps

- [ ] Atualizar a descrição de `send_media` no registry (linha 48) pra refletir a Emenda áudio (contrato que o LLM lê; o handler real continua no Slice 6):

```ts
  { name: "send_media", kind: "write", capability: "can_send_media", description: "Envia mídia da biblioteca aprovada (imagem, vídeo ou áudio/ptt) quando o gatilho casa (gate de momento/repetição no harness; entrega via Slice 6).", parameters: obj({ media_id: str("id do item da biblioteca") }, ["media_id"]) },
```

- [ ] Garantir que os casos de contrato seguem honestos (manter, NÃO remover — o handler real é do Slice 6/7). Confirmar em `tool-executor.test.ts` que `send_media` e `search_knowledge` ainda lançam `not_implemented` enquanto Slice 6/7 não mergeam nesta branch:

```ts
describe('contrato dos handlers de outras slices (donos: Slice 6/7)', () => {
  it('send_media segue not_implemented nesta slice (handler é do Slice 6)', async () => {
    const exec = createToolExecutor(mockSupabase(), { organizationId: 'org-1' } as any);
    await expect(exec('send_media', { media_id: 'm1' })).rejects.toMatchObject({ code: 'not_implemented' });
  });
  it('search_knowledge segue not_implemented nesta slice (handler é do Slice 7)', async () => {
    const exec = createToolExecutor(mockSupabase(), { organizationId: 'org-1' } as any);
    await expect(exec('search_knowledge', { query: 'tabela de preços' })).rejects.toMatchObject({ code: 'not_implemented' });
  });
  it('o registry expõe áudio no contrato do send_media (Emenda ADR §1)', () => {
    const meta = TOOL_REGISTRY.find((t) => t.name === 'send_media')!;
    expect(meta.description.toLowerCase()).toContain('áudio');
  });
});
```

  (Importar `TOOL_REGISTRY` no topo do test se ainda não estiver.)

- [ ] Rodar o tocado — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/tool-executor.test.ts tests/unit/copilot-v2/tool-registry.test.ts
```

- [ ] Rodar a FULL suíte copilot-v2:

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes. Capturar a linha literal (ex.: `Test Files  24 passed (24)` / `Tests  ... passed (...)`) no QA report — NÃO parafrasear como "all green" (root memory `feedback_qa_raw_output`).

- [ ] Typecheck + build (sem gate `tsc` de edge na CI — verificar localmente; edge `.ts` fica fora de `tsconfig.app.json` mas o build não pode regredir):

```bash
npm run typecheck
npm run build
```

Esperado: `typecheck` exits 0 (ou ratchet inalterado via `npm run typecheck:ratchet`); `build` conclui.

- [ ] `deno check` dos arquivos edge tocados (pega import relativo quebrado que o tsc não pega — root memory Fase 9):

```bash
cd supabase/functions && deno check copilot-v2-worker/index.ts _shared/copilot-v2/tool-executor.ts _shared/copilot-v2/agenda.ts _shared/copilot-v2/introspect-guard.ts _shared/copilot-v2/tool-registry.ts
```

Esperado: sem diagnostics.

- [ ] **Segurança**: o contrato visível ao LLM (`send_media` áudio) não relaxa nenhum gate — `can_send_media` continua fail-CLOSED (1-H Task 7) e o introspect-guard segue. `search_knowledge` honesto `not_implemented` evita o NOOP-bug-class da v1 (nunca finge ter buscado).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/tool-registry.ts \
        tests/unit/copilot-v2/tool-executor.test.ts
git commit -m "$(cat <<'EOF'
chore(copilot-v2): contrato send_media com audio + send/search honestos

send_media ganha audio(ptt) na descricao do registry (Emenda ADR §1) — contrato
que o LLM le; o handler real e do Slice 6 (acervo-aware). search_knowledge segue
not_implemented honesto ate o Slice 7 (dono do RPC match_knowledge). Fixa os
testes de contrato + regressao full da suite copilot-v2.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Gate final de verificação** (colar counts literais no QA report do slice):

```bash
npx vitest run tests/unit/copilot-v2/
npm run typecheck && npm run build
```

Tudo verde antes de abrir o PR. **Não deployar edge functions nem aplicar migration** — push só da branch; PROD apply + deploy exigem autorização explícita do CTO (root memory: `feedback_never_deploy_prod`, `feedback_push_new_branch`).

---

## 🔒 Segurança

- **Multi-tenant**: `organization_id` SEMPRE do `ToolContext` (resolvido pelo worker da instância confiável), NUNCA do payload/LLM — invariante já fixada e testada em `tool-executor.test.ts` ("IGNORES an organization_id passed in args"); cada novo handler (`check_agenda_availability`, `schedule_meeting`, `handoff_to_vendedor`) filtra `leads`/`pipe_confirmacao` por `organization_id` do ctx. O `responsibleUserId` do Calendar vem do **lead** (`responsible_id`→`sdr_id`, DB), nunca do LLM.
- **Calendar OAuth scoping**: o token é por `user_id` do responsável, decriptado server-side (AES-256-GCM, `getValidAccessToken`); o agente nunca vê o token. freeBusy/createEvent rodam no escopo do calendário daquela pessoa.
- **Fail-CLOSED em todo gate**: capability (`can_schedule_meeting`/`can_handoff` — 1-H Task 7, default OFF até `slots.capabilities` setado), write-after-introspect de agenda (Task 1 — horário não introspectado → `orphaned_target`), revalidação de passado/ISO no handler (Task 4). `check_agenda_availability` sem Calendar → `no_calendar` explícito.
- **Sem silent-drop (lição VitrineVET, #6)**: todo caminho de falha devolve `{ ...: false, reason }` explícito — agendamento sem Calendar (`calendar: "failed"` mas pipe gravado), handoff sem infra de notificação (`notify_pending`), agenda sem token (`no_calendar`). Nada some em silêncio.
- **Graceful degradation**: a falha do Google Calendar NÃO desfaz o agendamento de negócio no `pipe_confirmacao` (consistência do CRM preservada).
- **PII**: nenhum handler loga conteúdo raw de mensagem; o `transfer_to_human`/`handoff` carregam só metadados estruturados (lead/reason/summary). O fan-out de notificação (Slice 5) é org-scoped.

## ⚠️ Decisões abertas

- 🟡 **Fronteira `send_media` (Slice 3 × Slice 6) — RESOLVIDA neste plano.** O **handler** `send_media` (resolve item de `copilot_v2_send_media` → signed URL → adapter, com `media-mime.ts`/`send-media-selector.ts`) é **propriedade canônica do Slice 6** (`slice-06-asset-stores` Task 4). O Slice 3 limita-se ao **contrato no tool-registry** (áudio na descrição — Emenda ADR §1) + o capability/introspect já existentes, e **mantém o handler `not_implemented` honesto** até o Slice 6 mergear. Sem conflito de arquivo bloqueante (ambas tocam `tool-executor.ts HANDLERS`; quem rodar por último reconcilia — a versão acervo-aware do Slice 6 é a canônica). Anotado pra evitar dupla-implementação.
- 🟡 **Fronteira `search_knowledge` (Slice 3 × Slice 7) — RESOLVIDA neste plano.** O **handler** `search_knowledge` + a RPC `copilot_v2_match_knowledge` são **propriedade do Slice 7** (`slice-07-ingestion-rag`, dono do RAG/ingestão). O Slice 3 **mantém `not_implemented` honesto** (nunca finge buscar — evita o NOOP-bug-class da v1). Depende do Slice 7 popular os chunks.
- 🟡 **Fronteira `handoff_to_vendedor` (Slice 3 × Slice 5) — RESOLVIDA neste plano.** O **handler** é do Slice 3 (reassign + payload + chamada da dep); a **infra de notificação** (resolução de destino role-aware `handoff-routing.ts` + RPC fan-out + realtime + WhatsApp ao responsável) é do **Slice 5**. Soft-dep de ordering: sem o Slice 5, o handler retorna `notify_pending` (handoff de negócio acontece). Quando o Slice 5 mergear, o worker passa a dep `dispatchHandoffNotification` real.
- 🟠 **Follow-up técnico (NÃO escopo desta slice): propagação dinâmica de `introspection.slots` dentro do turno.** Hoje `resolveContext` inicializa `introspection.slots = []` no início do turno; os slots livres só existem após `check_agenda_availability` rodar. Como o `cognition-loop` injeta os results dos read-tools na conversa mas NÃO re-popula `introspection` no mesmo turno, um `schedule_meeting` no MESMO turno de um `check_agenda_availability` seria bloqueado por `orphaned_target` (fail-CLOSED conservador — correto pela segurança, mas pode exigir 2 turnos pro fluxo completo). Resolver isso (propagar os slots do read pro `introspection` intra-turno) é uma melhoria do `cognition-loop`/`cognition-worker` — registrar como follow-up no [[_MOC]] §Decisões abertas. **Não inventar a solução aqui**; o comportamento fail-CLOSED é seguro e shippável (o agente checa a agenda num turno, agenda no próximo).
- 🟠 **Possível necessidade de tracking de mídia/slot agendado para anti-repetição** — se o executor concluir, ao implementar, que precisa persistir slots/mídia já tocados além do trace, **parar e sinalizar** (provável fronteira com Slice 8/11 — não criar tabela nova nesta slice sem decisão do CTO).
