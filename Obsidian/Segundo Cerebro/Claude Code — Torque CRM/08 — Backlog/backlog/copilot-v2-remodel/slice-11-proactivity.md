---
title: "Slice 11 — Proatividade / scheduler"
feature: copilot-v2-remodel
slice: "11"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-05-guardrails-handoff]]", "[[slice-08-wizard]]"]
branch: feat/copilot-v2/slice-11-proactivity
handoff: "engenheiro"
security: true
tags: [copilot-v2, slice, execution-ready, scheduler, security]
---

# Slice 11 — Proatividade / scheduler Implementation Plan 🔒

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-11-proactivity` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev** (`bcfadphgsibjzivtbjvc`). Migration via **MCP `apply_migration`** (nunca `db push` — prod tem drift). TDD: incidente→regressão (cada double-send da v1 vira invariante + teste). QA com counts literais do runner (nunca "all green" parafraseado).
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (§5 escopo, §9 apêndice finding→slice) · ADR: `docs/adr/0002-copilot-v2-architecture.md` (decisão #11 Proatividade)

---

# Slice 11 — Proatividade / scheduler (Copilot v2 runtime) 🔒

> 🔒 **Security-sensitive**: multi-tenant (`organization_id` SEMPRE do contato/instância/cron-resolvido, NUNCA do payload/LLM), todos os gates fail-CLOSED (rate-limit, horário comercial, claim idempotente), PII (telefone canônico no caminho proativo). Cada disparo proativo passa pelos MESMOS gates fail-CLOSED do inbound (human-pause re-check no envio — já existe pós-1-H) e por uma chave de idempotência estável que mata o double-send da v1 (#7/#8/#9).

## Goal

O agente **inicia** conversa (não só responde), sem nunca duplicar o envio. Três caminhos proativos, todos enfileirados na fila durável v2 existente (`copilot_v2_message_queue`) via a primitiva idempotente que o 1-H já provou (`copilot_v2_enqueue_message` + `UNIQUE (organization_id, idempotency_key)` + `ON CONFLICT DO NOTHING RETURNING id`): **(1) first-touch** — ad lead que entra pelo `lead-webhook` recebe a 1ª mensagem do Qualificador; **(2) followup agendado** — lead frio reengaja numa cadência configurável; **(3) resgate Carteira** — cliente dormindo reabre conversa. Um **scheduler pg_cron → edge** (1/min) computa os candidatos respeitando horário comercial + rate-limit por org, e enfileira com uma chave estável por (org, lead, motivo, slot-da-cadência). A fila durável + o worker existente fazem o resto. Massa fria continua em `campaigns` — proativo é 1:1, não duplica campanha.

## Architecture

Pipeline real tocado (leia ponta-a-ponta antes de começar). O proativo **adiciona um produtor** à fila durável existente; ele **não** reescreve o claim/worker do 1-H — ADICIONA novos `source` e chaves de idempotência:

```
            ┌─ (A) first-touch ──── lead-webhook/index.ts (ad lead novo)
            │                         → enqueueProactive (source='first_touch')
pg_cron 1/min ─► copilot-v2-proactive/index.ts (NOVO, cron edge, x-cron-secret)
            │      ├─ (B) followup ── selectFollowupCandidates (leads frios)
            │      └─ (C) carteira ── selectRescueCandidates (clientes dormindo)
            │            │
            │            ▼ por candidato:
            │      proactive-scheduler.ts (PURO: gates fail-CLOSED)
            │        businessHoursGate → rateLimitGate → idempotencyKey
            │            │
            │            ▼ enfileira UMA vez (idempotente)
            └────► copilot_v2_enqueue_message(source, idempotency_key)   [RPC existente, 1-H]
                          │  ON CONFLICT(org, idempotency_key) DO NOTHING RETURNING id
                          ▼
                   copilot_v2_message_queue  (fila durável existente)
                          ▼  pg_cron 1/min (já agendado: 20260601020907)
                   copilot-v2-worker/index.ts  (claim → resolveContext → processBatch)
                          ▼
                   queue-processor.ts  (re-checa human-pause no envio — 1-H #49)
                          ▼
                   sendReply (whatsapp-client)  +  recordOutbound (loop-gate — 1-H #3)
```

Módulos REAIS tocados:
- **`supabase/functions/_shared/copilot-v2/proactive-scheduler.ts`** (NOVO, puro) — decide os gates do proativo (horário comercial, rate-limit, chave de idempotência). Espelha o estilo de `dedup-lock.ts`/`loop-detector.ts`: decisão pura, efeito injetado.
- **`supabase/functions/copilot-v2-proactive/index.ts`** (NOVO, edge cron) — I/O shell: seleciona candidatos (followup/resgate) do DB, aplica o scheduler puro, enfileira via RPC. Espelha `copilot-v2-worker/index.ts` (auth `x-cron-secret`, `createClient` service_role, batch).
- **`supabase/functions/lead-webhook/index.ts`** (MODIFY) — no caminho "novo lead" (linha 866–885, hoje dispara `outbound-trigger` v1), ADICIONAR um enqueue proativo v2 `first_touch` (idempotente por lead) atrás de um guard "v2 ativo pra org". NÃO remover o v1 (decommission é Slice 12).
- **`copilot-v2-worker/index.ts` `resolveContext`** (MODIFY leve) — uma row proativa não tem mensagem inbound de lead; o worker sintetiza um *directive de sistema* como `content` da row pra cognição produzir a 1ª mensagem (a row já chega com `content` = directive; nenhuma mudança no claim).
- **Migrations** (NOVAS, dev-only): (1) tabela `copilot_v2_proactive_log` (ledger idempotente + rate-limit por org/dia) + RPC `copilot_v2_claim_proactive_slot` (claim atômico do slot, fail-CLOSED); (2) schedule pg_cron do `copilot-v2-proactive`.

Org identity: no first-touch vem do `lead-webhook` (já resolvido por webhook key + lead.organization_id). No followup/resgate vem da query cron scoped por org. **Nunca** do payload/LLM. A fila já carrega `organization_id` na row.

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` com `.ts` explícito). Padrão: `serve(withSentry(...))` + `withSecurityHeaders(getCorsHeaders(...))` + OPTIONS early return + auth `x-cron-secret`.
- **Supabase Postgres** RPCs (`SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role`). pg_cron 1/min via `cron.schedule` (espelha `20260601020907`).
- **Tests: Vitest** (NÃO `deno test`). Specs copilot-v2 vivem em `tests/unit/copilot-v2/*.test.ts` e importam os `.ts` Deno por path relativo (`../../../supabase/functions/_shared/copilot-v2/x.ts`); o transform do Vite resolve o `.ts`.
  - Arquivo único: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Suíte copilot-v2 inteira: `npx vitest run tests/unit/copilot-v2/`
  - Baseline conhecida (pós-1-H): `npx vitest run tests/unit/copilot-v2/loop-detector.test.ts` → **10 passed**.
  - **NUNCA** passar `--reporter=basic` (falha ao carregar o módulo do reporter neste repo — usar o reporter default).

**Branch**: `feat/copilot-v2/slice-11-proactivity` off `develop`.

## Setup

- [ ] Criar branch a partir de `develop`:

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-11-proactivity
```

- [ ] Baseline verde antes de tocar nada (anota counts literais pra comparar no fim):

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes. Anotar `Test Files N passed (N)` / `Tests M passed (M)`.

**Migration policy do slice**: Tasks 4 e 6 criam NOVAS migrations. Migrations são **imutáveis** — nunca editar `20260531174908` / `20260601015114` / `20260602151330` / `20260602151331`; sempre uma nova com timestamp real (`date -u +%Y%m%d%H%M%S`). Default target = **dev** (`bcfadphgsibjzivtbjvc`). **Marcadas committed-not-applied**: dev tem drift (a fundação copilot-v2 pode faltar lá); o executor **valida** que a fundação está aplicada em dev (`supabase migration list --project-ref bcfadphgsibjzivtbjvc` contém `20260531174908`) ANTES de aplicar as deste slice. **PROD PROIBIDO** neste slice — apply em prod exige autorização explícita do CTO (Slice 12). NÃO deployar edge functions; só push da branch.

---

## Task 1 — Scheduler puro: gate de horário comercial (fail-CLOSED)

**Problem**: O proativo não pode iniciar conversa fora do horário comercial da org (ADR decisão #11 + base-prompt Carteira `base-prompts.ts:250` — "fora da janela, não inicie abordagem proativa"). Hoje não existe nenhum módulo que decida isso para o v2 — `_shared/copilot-v2/` não tem `business-hours` nem `proactive-scheduler`. Sem esse gate, um cron 1/min dispararia first-touch/followup/resgate de madrugada.

**Fix**: criar o módulo puro `proactive-scheduler.ts` com `decideBusinessHoursGate({ window, now, tz })` → `{ allowed, reason }`. **Fail-CLOSED**: janela ausente/malformada, ou erro de parsing → **bloqueia** (não dispara). A janela vem da config do agente (`copilot_v2_config.slots.businessHours`, o mesmo slot que o prompt já consome — `prompt-builder.ts:22,45`); o I/O shell (Task 5) carrega e passa. Decisão pura, sem `Date.now()` interno (recebe `now`), testável sem DB.

> Decisão de produto: o **formato** e o **default** da janela de horário comercial são config (ver `## ⚠️ Decisões abertas`). Esta Task trata a janela como **parâmetro** — propõe um default (`{ days: [1,2,3,4,5], start: "08:00", end: "18:00", tz: "America/Sao_Paulo" }`) marcado ajustável, mas a regra final fica como slot. O gate é fail-CLOSED quando o slot está ausente, então o comportamento default é "não dispara até a org configurar a janela" — postura consistente com o capability-gate fail-closed do 1-H Task 7.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/proactive-scheduler.ts`.
- **Create** test `tests/unit/copilot-v2/proactive-scheduler.test.ts`.

### Steps

- [ ] Ler como o slot de horário já é consumido (`prompt-builder.ts` 20–46) pra reusar o nome do campo (`businessHours`) e não inventar um novo:

```ts
// prompt-builder.ts (excerto)
businessHours?: string;
// ...
business_hours: config.businessHours,
```

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/proactive-scheduler.test.ts`:

```ts
/**
 * Slice 11 — proactive scheduler: business-hours gate (Copilot v2)
 *
 * O proativo INICIA conversa; jamais fora do horário comercial da org
 * (ADR #11). Decisão pura, fail-CLOSED: janela ausente/malformada bloqueia.
 * 'now' é injetado — sem Date.now() interno, testável sem relógio real.
 */
import { describe, it, expect } from 'vitest';
import {
  decideBusinessHoursGate,
  type BusinessHoursWindow,
} from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

const win: BusinessHoursWindow = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', tz: 'America/Sao_Paulo' };
// Segunda-feira 14:00 BRT == 17:00 UTC
const insideUtc = new Date('2026-06-01T17:00:00.000Z');
// Segunda-feira 03:00 BRT == 06:00 UTC
const beforeUtc = new Date('2026-06-01T06:00:00.000Z');
// Domingo 14:00 BRT == 17:00 UTC
const sundayUtc = new Date('2026-05-31T17:00:00.000Z');

describe('decideBusinessHoursGate — fail-CLOSED', () => {
  it('allows inside the window on a business day', () => {
    expect(decideBusinessHoursGate({ window: win, now: insideUtc }))
      .toEqual({ allowed: true, reason: null });
  });

  it('blocks before opening hour', () => {
    expect(decideBusinessHoursGate({ window: win, now: beforeUtc }))
      .toEqual({ allowed: false, reason: 'outside_business_hours' });
  });

  it('blocks on a non-business day (Sunday)', () => {
    expect(decideBusinessHoursGate({ window: win, now: sundayUtc }))
      .toEqual({ allowed: false, reason: 'outside_business_hours' });
  });

  it('fail-CLOSED: a missing window blocks (never fires before config)', () => {
    expect(decideBusinessHoursGate({ window: null, now: insideUtc }))
      .toEqual({ allowed: false, reason: 'no_business_hours_window' });
  });

  it('fail-CLOSED: a malformed window blocks (does not throw)', () => {
    const bad = { days: [1], start: '99:99', end: 'x', tz: 'America/Sao_Paulo' } as BusinessHoursWindow;
    expect(() => decideBusinessHoursGate({ window: bad, now: insideUtc })).not.toThrow();
    expect(decideBusinessHoursGate({ window: bad, now: insideUtc }).allowed).toBe(false);
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo/export não existem):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

Esperado: `Test Files 1 failed` — erro de import (`decideBusinessHoursGate` não existe).

- [ ] Implementar `supabase/functions/_shared/copilot-v2/proactive-scheduler.ts` (parte 1 — o gate de horário):

```ts
/**
 * proactive-scheduler — Copilot v2 outbound proactivity (Slice 11, ADR #11).
 *
 * PURE decision layer for the proactive scheduler. The cron edge shell selects
 * candidates and performs the I/O (DB reads, enqueue RPC); THIS module decides
 * the fail-CLOSED gates (business-hours, rate-limit) and computes the STABLE
 * idempotency key that kills the v1 double-send (#7/#8/#9). No Date.now(), no
 * DB — every clock/effect is injected, so the whole policy is unit-testable.
 */

/** Per-org commercial window. tz is an IANA zone (Intl is available in Deno). */
export interface BusinessHoursWindow {
  /** ISO weekdays allowed, 1=Mon … 7=Sun. */
  days: number[];
  /** "HH:MM" 24h, in `tz`. */
  start: string;
  /** "HH:MM" 24h, in `tz`. */
  end: string;
  /** IANA tz, e.g. "America/Sao_Paulo". */
  tz: string;
}

export type GateDecision = { allowed: boolean; reason: string | null };

function parseHHMM(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Local wall-clock (weekday 1-7, minutes-of-day) of `now` in `tz`, fail-safe. */
function localParts(now: Date, tz: string): { isoDow: number; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "";
    const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const isoDow = dowMap[wd];
    const minutes = Number(hh) * 60 + Number(mm);
    if (!isoDow || Number.isNaN(minutes)) return null;
    return { isoDow, minutes };
  } catch {
    return null;
  }
}

/**
 * Business-hours gate, fail-CLOSED: a missing/malformed window or any error
 * blocks the proactive send (never initiate outside the org's commercial window).
 */
export function decideBusinessHoursGate(
  input: { window: BusinessHoursWindow | null | undefined; now: Date },
): GateDecision {
  const w = input.window;
  if (!w || !Array.isArray(w.days) || w.days.length === 0 || typeof w.tz !== "string") {
    return { allowed: false, reason: "no_business_hours_window" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin == null || endMin == null || startMin >= endMin) {
    return { allowed: false, reason: "outside_business_hours" };
  }
  const local = localParts(input.now, w.tz);
  if (!local) return { allowed: false, reason: "outside_business_hours" };
  const dayOk = w.days.includes(local.isoDow);
  const timeOk = local.minutes >= startMin && local.minutes < endMin;
  return dayOk && timeOk
    ? { allowed: true, reason: null }
    : { allowed: false, reason: "outside_business_hours" };
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

Esperado: `Test Files 1 passed (1)` / `Tests 5 passed (5)`.

- [ ] **Segurança**: a janela é por org (`copilot_v2_config.slots` é org-scoped via `agent_id`/`organization_id` na fundação `20260531174908:52-59`); o gate nunca recebe org do LLM. Fail-CLOSED preservado.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/proactive-scheduler.ts \
        tests/unit/copilot-v2/proactive-scheduler.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): gate de horário comercial pro scheduler proativo (fail-CLOSED)

ADR #11: o agente inicia conversa, mas nunca fora da janela comercial da org.
decideBusinessHoursGate é puro (now injetado, sem Date.now), lê a janela do
slot businessHours já consumido pelo prompt. Janela ausente/malformada
bloqueia (fail-CLOSED) — não dispara até a org configurar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Scheduler puro: chave de idempotência estável (mata #7/#8/#9)

**Problem**: O double-send da v1 (#7/#8/#9 — apêndice §9 do plano mestre) vinha de followups/outbound disparados por caminhos não-atômicos: o mesmo lead recebia a mesma mensagem 2× porque o "já enviei?" era um bucket de tempo frágil ou um read-then-write sem lock. O v2 já tem a primitiva certa na fila (`UNIQUE (organization_id, idempotency_key)` + `ON CONFLICT DO NOTHING RETURNING id`, fundação `20260531174908:79,226-228`), mas só funciona se a chave for **estável e determinística por (org, lead, motivo, slot)** — NÃO por timestamp (timestamp muda a cada tick do cron 1/min → duplica). Hoje não existe nenhuma função que compute essa chave pro proativo.

**Fix**: `buildProactiveIdempotencyKey({ orgId, leadId, kind, slot })` no `proactive-scheduler.ts`. `kind` ∈ `first_touch | followup | carteira_rescue`. `slot` é o discretizador do motivo: pra first-touch é fixo (`"1"` — só pode haver uma 1ª mensagem por lead); pra followup é o índice da cadência (`"d3"`, `"d7"`…); pra resgate é a "rodada" de resgate (ex.: a data-âncora do `churned_at` ou o nº da tentativa). A chave NÃO contém timestamp do tick. Determinística → o cron pode rodar o mesmo candidato 60×/hora; a fila colapsa pra UMA row. Espelha exatamente `buildDedupKey` (`dedup-lock.ts:42-45`) mas no escopo proativo.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/proactive-scheduler.ts` — adicionar `ProactiveKind`, `buildProactiveIdempotencyKey`.
- **Modify** `tests/unit/copilot-v2/proactive-scheduler.test.ts` — `describe` da chave.

### Steps

- [ ] Reler a primitiva existente que a chave alimenta (`dedup-lock.ts:42-45`) e o `UNIQUE` da fila (`20260531174908:79`):

```ts
// dedup-lock.ts — o padrão a espelhar (org-scoped, determinístico)
export function buildDedupKey(args: DedupKeyArgs): string {
  const contentHash = fnv1a(normalizeForDedup(args.content));
  return `${args.orgId}:${args.phone}:${args.source}:${contentHash}`;
}
```

- [ ] Adicionar ao teste (no mesmo arquivo):

```ts
import { buildProactiveIdempotencyKey } from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

describe('buildProactiveIdempotencyKey — stable, no timestamp', () => {
  it('is deterministic for the same (org, lead, kind, slot)', () => {
    const a = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'first_touch', slot: '1' });
    const b = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'first_touch', slot: '1' });
    expect(a).toBe(b); // dois ticks do cron → MESMA chave → fila colapsa pra 1 row
  });

  it('differs by kind, by slot, and by org (no cross-tenant collision)', () => {
    const ft = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'first_touch', slot: '1' });
    const fu = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'followup', slot: 'd3' });
    const fu2 = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'followup', slot: 'd7' });
    const other = buildProactiveIdempotencyKey({ orgId: 'o2', leadId: 'l1', kind: 'first_touch', slot: '1' });
    expect(new Set([ft, fu, fu2, other]).size).toBe(4);
  });

  it('carries the kind as a prefix so it never collides with an inbound dedup key', () => {
    const k = buildProactiveIdempotencyKey({ orgId: 'o1', leadId: 'l1', kind: 'followup', slot: 'd3' });
    expect(k.startsWith('proactive:')).toBe(true);
  });
});
```

- [ ] Rodar — esperar FALHAR (`buildProactiveIdempotencyKey` não existe):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

Esperado: o `describe` da chave falha; os 5 da Task 1 continuam passando.

- [ ] Implementar em `proactive-scheduler.ts`:

```ts
export type ProactiveKind = "first_touch" | "followup" | "carteira_rescue";

export interface ProactiveKeyArgs {
  orgId: string;
  leadId: string;
  kind: ProactiveKind;
  /** Discretiza o motivo: "1" (first-touch), "d3"/"d7" (cadência), rodada de resgate. NUNCA timestamp do tick. */
  slot: string;
}

/**
 * Chave de idempotência ESTÁVEL do proativo. Determinística por
 * (org, lead, kind, slot) — sem timestamp — pra que o cron 1/min possa
 * re-selecionar o mesmo candidato e a fila colapse pra UMA row via
 * ON CONFLICT (org, idempotency_key). Prefixo "proactive:" garante que
 * nunca colide com a dedup key de inbound (dedup-lock.ts). Mata #7/#8/#9.
 */
export function buildProactiveIdempotencyKey(args: ProactiveKeyArgs): string {
  return `proactive:${args.orgId}:${args.kind}:${args.leadId}:${args.slot}`;
}
```

- [ ] Re-rodar — esperar PASSAR (8 ao total no arquivo):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

Esperado: `Tests 8 passed (8)`.

- [ ] **Segurança**: a chave começa com `orgId` (isolamento multi-tenant — uma org nunca colapsa a row de outra). É a barreira anti-double-send: o mesmo (lead, motivo, slot) só enfileira uma vez.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/proactive-scheduler.ts \
        tests/unit/copilot-v2/proactive-scheduler.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): chave de idempotência estável do proativo (mata #7/#8/#9)

O double-send da v1 vinha de followups/outbound com 'já enviei?' por bucket
de tempo frágil. buildProactiveIdempotencyKey é determinística por
(org, lead, kind, slot) SEM timestamp, então o cron 1/min re-seleciona o
mesmo candidato e a fila colapsa pra 1 row via ON CONFLICT. Prefixo
'proactive:' nunca colide com a dedup key de inbound.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Scheduler puro: gate de rate-limit por org + decisão composta

**Problem**: Um cron proativo sem teto pode inundar uma org (e a instância Uazapi) — risco operacional e de banimento do número. ADR decisão #11 + escopo §5 ("respeitando horário + rate-limit"). Não existe nenhum gate de rate-limit proativo no v2.

**Fix**: `decideRateLimitGate({ sentToday, ceiling })` → `{ allowed, reason }`, fail-CLOSED (ceiling ausente/≤0 → bloqueia). E uma função composta `decideProactiveSend({ window, now, sentToday, ceiling })` que encadeia: horário comercial → rate-limit, retornando a PRIMEIRA razão de bloqueio (fail-CLOSED em qualquer erro). O `sentToday` e o `ceiling` vêm do I/O shell (Task 5) — o `sentToday` é contado do ledger `copilot_v2_proactive_log` (Task 4); o `ceiling` é config por org (default proposto, ver Decisões abertas).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/proactive-scheduler.ts` — `decideRateLimitGate`, `decideProactiveSend`.
- **Modify** `tests/unit/copilot-v2/proactive-scheduler.test.ts`.

### Steps

- [ ] Adicionar ao teste:

```ts
import {
  decideRateLimitGate,
  decideProactiveSend,
} from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

describe('decideRateLimitGate — fail-CLOSED', () => {
  it('allows under the daily ceiling', () => {
    expect(decideRateLimitGate({ sentToday: 9, ceiling: 50 })).toEqual({ allowed: true, reason: null });
  });
  it('blocks at the ceiling', () => {
    expect(decideRateLimitGate({ sentToday: 50, ceiling: 50 })).toEqual({ allowed: false, reason: 'rate_limit_reached' });
  });
  it('fail-CLOSED: a non-positive ceiling blocks', () => {
    expect(decideRateLimitGate({ sentToday: 0, ceiling: 0 })).toEqual({ allowed: false, reason: 'no_rate_ceiling' });
  });
});

describe('decideProactiveSend — composed, first blocking reason wins', () => {
  const win: BusinessHoursWindow = { days: [1,2,3,4,5], start: '08:00', end: '18:00', tz: 'America/Sao_Paulo' };
  const inside = new Date('2026-06-01T17:00:00.000Z'); // Mon 14:00 BRT
  it('allows when all gates pass', () => {
    expect(decideProactiveSend({ window: win, now: inside, sentToday: 1, ceiling: 50 }))
      .toEqual({ allowed: true, reason: null });
  });
  it('blocks on business-hours BEFORE checking rate-limit', () => {
    const night = new Date('2026-06-01T06:00:00.000Z'); // Mon 03:00 BRT
    expect(decideProactiveSend({ window: win, now: night, sentToday: 999, ceiling: 50 }))
      .toEqual({ allowed: false, reason: 'outside_business_hours' });
  });
  it('blocks on rate-limit when inside hours but at ceiling', () => {
    expect(decideProactiveSend({ window: win, now: inside, sentToday: 50, ceiling: 50 }))
      .toEqual({ allowed: false, reason: 'rate_limit_reached' });
  });
});
```

- [ ] Rodar — esperar FALHAR (exports não existem):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

- [ ] Implementar em `proactive-scheduler.ts`:

```ts
/** Daily per-org rate-limit, fail-CLOSED (ceiling ≤ 0 or NaN → blocks). */
export function decideRateLimitGate(input: { sentToday: number; ceiling: number }): GateDecision {
  if (!Number.isFinite(input.ceiling) || input.ceiling <= 0) {
    return { allowed: false, reason: "no_rate_ceiling" };
  }
  return input.sentToday >= input.ceiling
    ? { allowed: false, reason: "rate_limit_reached" }
    : { allowed: true, reason: null };
}

/**
 * Composed proactive gate: business-hours → rate-limit. Returns the FIRST
 * blocking reason; fail-CLOSED throughout. The caller still relies on the
 * claim RPC (Task 4) for the atomic anti-double-send — this is the cheap
 * pre-filter that avoids even attempting an enqueue out of hours / over budget.
 */
export function decideProactiveSend(
  input: { window: BusinessHoursWindow | null | undefined; now: Date; sentToday: number; ceiling: number },
): GateDecision {
  const hours = decideBusinessHoursGate({ window: input.window, now: input.now });
  if (!hours.allowed) return hours;
  return decideRateLimitGate({ sentToday: input.sentToday, ceiling: input.ceiling });
}
```

- [ ] Re-rodar — esperar PASSAR (14 ao total no arquivo):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

Esperado: `Tests 14 passed (14)`.

- [ ] **Segurança**: rate-limit é por org/dia (multi-tenant — uma org nunca consome o teto de outra). Fail-CLOSED: sem teto config → não dispara.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/proactive-scheduler.ts \
        tests/unit/copilot-v2/proactive-scheduler.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): rate-limit por org + decisão proativa composta (fail-CLOSED)

decideRateLimitGate barra ao atingir o teto diário (ceiling<=0 = bloqueia).
decideProactiveSend encadeia horário->rate-limit retornando a 1a razão de
bloqueio. Pre-filtro barato; o anti-double-send atômico é o claim RPC.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Migration: ledger idempotente + RPC de claim atômico do slot proativo

**Problem**: A chave de idempotência (Task 2) + `ON CONFLICT` da fila garante que a *mesma row de fila* não duplica. Mas precisamos de (a) um **ledger** que conte quantos proativos a org já mandou hoje (alimenta o rate-limit da Task 3) e que sirva de **registro auditável** de cada disparo; e (b) um **claim atômico do slot** que decida "este (org, lead, kind, slot) é meu pra enfileirar?" de forma serializável, pra que dois ticks concorrentes do cron (ou duas réplicas) não passem ambos pelo gate e enfileirem em paralelo antes do `ON CONFLICT` materializar. Sem isso, o gate de rate-limit poderia ser violado por corrida, e o ledger ficaria inconsistente. Não existe nenhuma tabela/RPC proativa hoje (`grep copilot_v2_proactive` em migrations → nada).

**Fix** — NOVA migration `copilot_v2_proactive_log`:
- Tabela `copilot_v2_proactive_log` (org-scoped, RLS deny-all default + read org-scoped pro wizard/observabilidade futura): `organization_id, lead_id, kind, slot, idempotency_key (unique global), enqueued_queue_id, sent_date (date), created_at`. `UNIQUE (organization_id, idempotency_key)` espelha a fila → mesma chave nunca registra 2×.
- RPC `copilot_v2_claim_proactive_slot(p_org_id, p_lead_id, p_kind, p_slot, p_idempotency_key, p_daily_ceiling)` → `SECURITY DEFINER`. **Atômico + fail-CLOSED**: numa única transação, (1) conta `sent_date = current_date` da org com `FOR UPDATE`-style lock via insert; (2) se já existe a chave → retorna `{claimed:false, reason:'already_claimed'}` (idempotente, sem erro); (3) se `count >= ceiling` → `{claimed:false, reason:'rate_limit_reached'}`; (4) senão insere o ledger e retorna `{claimed:true}`. O `ON CONFLICT (organization_id, idempotency_key) DO NOTHING` no insert do ledger é o serializador real — dois ticks concorrentes: só um insere, o outro vê `claimed:false`.

> Nota de ordering (soft-dep): a contagem `sent_date` é o mesmo número que `decideRateLimitGate` consome no shell (Task 5). O shell faz o gate barato (Task 3) ANTES de chamar o claim (evita ir ao DB fora de hora), mas o claim é a **autoridade** atômica do rate-limit — o gate puro é só pre-filtro. Defesa em profundidade.

### Files

- **Create** `supabase/migrations/<TS>_copilot_v2_proactive_log.sql` (timestamp real via comando abaixo).
- **Create** test `tests/unit/copilot-v2/proactive-claim.contract.test.ts` (contrato do shape do retorno do claim — o DB-level vai na integração `.skip`, Task 7).

### Steps

- [ ] Validar que a fundação está em dev ANTES de criar migration (committed-not-applied policy):

```bash
supabase migration list --project-ref bcfadphgsibjzivtbjvc | grep 20260531174908
```

Se não listar → **PARAR e sinalizar** (dev drift; a fundação copilot-v2 não está aplicada em dev — não aplicar as deste slice até reconciliar).

- [ ] Criar a migration com timestamp real:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_copilot_v2_proactive_log.sql"
echo "$TS"   # anotar — reusar +1s no schedule (Task 6)
```

- [ ] Escrever o SQL (`supabase/migrations/<TS>_copilot_v2_proactive_log.sql`):

```sql
-- ============================================================================
-- Copilot v2 — Proactivity ledger + atomic slot claim (Slice 11, ADR #11).
--
-- Ledger idempotente dos disparos proativos (first-touch, followup, resgate
-- Carteira) + claim atômico do slot que serializa o rate-limit por org/dia e
-- mata o double-send da v1 (#7/#8/#9). org_id SEMPRE do ctx/cron, nunca do LLM.
--
-- NOT applied to prod by this slice — apply requires explicit CTO auth (Slice 12).
-- Default target = dev (bcfadphgsibjzivtbjvc) via MCP apply_migration.
-- ============================================================================

create table if not exists public.copilot_v2_proactive_log (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  lead_id           uuid,
  kind              text not null,            -- first_touch | followup | carteira_rescue
  slot              text not null,            -- "1" | "d3" | "d7" | rodada de resgate
  idempotency_key   text not null,
  enqueued_queue_id uuid,                     -- a row de copilot_v2_message_queue criada (null se ON CONFLICT)
  sent_date         date not null default (now() at time zone 'utc')::date,
  created_at        timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_copilot_v2_proactive_log_org_day
  on public.copilot_v2_proactive_log (organization_id, sent_date);

alter table public.copilot_v2_proactive_log enable row level security;
-- Org members may READ their own proactive ledger (observabilidade/wizard).
-- Writes só via RPC SECURITY DEFINER (service_role). NUNCA inline SELECT FROM
-- team_members numa policy (recursão RLS sob Realtime — root CLAUDE.md).
do $$ begin
  create policy copilot_v2_proactive_log_org_read on public.copilot_v2_proactive_log
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Claim atômico do slot proativo. Fail-CLOSED + idempotente:
--  - chave já existe        → (false, 'already_claimed')   [não erro]
--  - count(dia) >= ceiling  → (false, 'rate_limit_reached')
--  - senão                  → insere ledger e (true, null)
-- O ON CONFLICT DO NOTHING no insert é o serializador: 2 ticks concorrentes,
-- só um insere; o outro relê e vê already_claimed. org_id vem do caller (cron),
-- nunca do LLM.
create or replace function public.copilot_v2_claim_proactive_slot(
  p_org_id uuid,
  p_lead_id uuid,
  p_kind text,
  p_slot text,
  p_idempotency_key text,
  p_daily_ceiling int
) returns table (claimed boolean, reason text, log_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_count int; v_id uuid;
begin
  if p_daily_ceiling is null or p_daily_ceiling <= 0 then
    return query select false, 'no_rate_ceiling'::text, null::uuid; return;
  end if;

  -- Já reivindicado? (idempotente — não conta como erro)
  if exists (
    select 1 from public.copilot_v2_proactive_log
     where organization_id = p_org_id and idempotency_key = p_idempotency_key
  ) then
    return query select false, 'already_claimed'::text, null::uuid; return;
  end if;

  select count(*) into v_count
    from public.copilot_v2_proactive_log
   where organization_id = p_org_id
     and sent_date = (now() at time zone 'utc')::date;
  if v_count >= p_daily_ceiling then
    return query select false, 'rate_limit_reached'::text, null::uuid; return;
  end if;

  insert into public.copilot_v2_proactive_log
    (organization_id, lead_id, kind, slot, idempotency_key)
  values (p_org_id, p_lead_id, p_kind, p_slot, p_idempotency_key)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- corrida: outro tick inseriu entre o exists e o insert
    return query select false, 'already_claimed'::text, null::uuid; return;
  end if;

  return query select true, null::text, v_id;
end $$;

revoke all on function public.copilot_v2_claim_proactive_slot(uuid, uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.copilot_v2_claim_proactive_slot(uuid, uuid, text, text, text, int) to service_role;
```

- [ ] Escrever um contrato unit-level do shape de retorno (o claim em si é SQL — o DB-level vai na integração `.skip` da Task 7; aqui pinamos o contrato que o shell consome) — `tests/unit/copilot-v2/proactive-claim.contract.test.ts`:

```ts
/**
 * Slice 11 — proactive claim contract (Copilot v2)
 *
 * O claim atômico vive na RPC SQL copilot_v2_claim_proactive_slot. Este teste
 * pina o CONTRATO que o shell (copilot-v2-proactive) consome: a função
 * interpretClaim mapeia o retorno {claimed, reason} para a decisão de enfileirar
 * ou pular, fail-CLOSED (claim ausente/erro = NÃO enfileira). O comportamento
 * DB (corrida, rate-limit, idempotência) é provado na suíte .skip de integração.
 */
import { describe, it, expect } from 'vitest';
import { interpretClaim } from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

describe('interpretClaim — fail-CLOSED interpretation of the claim RPC', () => {
  it('enqueues when the slot was claimed', () => {
    expect(interpretClaim({ claimed: true, reason: null })).toEqual({ enqueue: true, reason: null });
  });
  it('does NOT enqueue when already claimed (idempotent skip, not an error)', () => {
    expect(interpretClaim({ claimed: false, reason: 'already_claimed' })).toEqual({ enqueue: false, reason: 'already_claimed' });
  });
  it('does NOT enqueue when rate-limited', () => {
    expect(interpretClaim({ claimed: false, reason: 'rate_limit_reached' })).toEqual({ enqueue: false, reason: 'rate_limit_reached' });
  });
  it('fail-CLOSED: a null/garbage claim result does NOT enqueue', () => {
    expect(interpretClaim(null).enqueue).toBe(false);
    expect(interpretClaim({} as any).enqueue).toBe(false);
  });
});
```

- [ ] Adicionar `interpretClaim` ao `proactive-scheduler.ts`:

```ts
/** Fail-CLOSED interpretation of copilot_v2_claim_proactive_slot's return. */
export function interpretClaim(
  result: { claimed: boolean; reason: string | null } | null | undefined,
): { enqueue: boolean; reason: string | null } {
  if (!result || result.claimed !== true) {
    return { enqueue: false, reason: result?.reason ?? "claim_unavailable" };
  }
  return { enqueue: true, reason: null };
}
```

- [ ] Rodar — esperar FALHAR primeiro (sem `interpretClaim`), depois PASSAR após a impl:

```bash
npx vitest run tests/unit/copilot-v2/proactive-claim.contract.test.ts
```

Esperado após impl: `Tests 4 passed (4)`.

- [ ] **Segurança**: tabela multi-tenant com `organization_id NOT NULL REFERENCES organizations` + RLS deny-all + read org-scoped via `get_my_organization_ids()` (SECURITY DEFINER, sem subquery inline `team_members` — evita recursão RLS sob Realtime, root CLAUDE.md). RPC `SECURITY DEFINER set search_path = public` + `revoke all from public/anon/authenticated` + `grant execute to service_role`. `org_id` é parâmetro do caller (cron/service_role), nunca do LLM. O claim é o gate fail-CLOSED autoritativo do rate-limit + anti-double-send.

- [ ] Commit:

```bash
git add "supabase/migrations/"*_copilot_v2_proactive_log.sql \
        supabase/functions/_shared/copilot-v2/proactive-scheduler.ts \
        tests/unit/copilot-v2/proactive-claim.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): ledger proativo + claim atômico do slot (anti-double-send)

Nova tabela copilot_v2_proactive_log (org-scoped, RLS deny-all + read
org-scoped) e RPC copilot_v2_claim_proactive_slot: numa transação serializa
o rate-limit por org/dia e o claim idempotente do slot (ON CONFLICT DO
NOTHING). Dois ticks concorrentes do cron: só um enfileira. interpretClaim
mapeia o retorno fail-CLOSED. Não aplicado em prod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Edge cron `copilot-v2-proactive`: seleciona candidatos, aplica gates, enfileira

**Problem**: Os gates puros (Tasks 1–3) e o claim atômico (Task 4) precisam de um I/O shell que: (a) seja agendado por pg_cron 1/min; (b) selecione candidatos de **followup** (leads frios na cadência) e **resgate Carteira** (clientes dormindo); (c) carregue a janela comercial + o teto por org; (d) aplique `decideProactiveSend` (pre-filtro) → `copilot_v2_claim_proactive_slot` (autoridade atômica) → `copilot_v2_enqueue_message` com `source` proativo + a chave estável. Não existe `copilot-v2-proactive` hoje. O first-touch tem um caminho próprio (Task 6) disparado pelo `lead-webhook` (evento, não cron).

**Fix**: criar `supabase/functions/copilot-v2-proactive/index.ts` espelhando o `copilot-v2-worker` (auth `x-cron-secret`, `createClient` service_role, OPTIONS early return, `withSentry`/`withSecurityHeaders`). O shell delega TODA decisão aos módulos puros — ele só faz I/O. O `content` enfileirado é um **directive de sistema** (não uma mensagem de lead): pra followup, algo como `[PROATIVO:followup d3] Reengaje este lead frio na cadência.`; o worker o trata como o input da cognição (a 1ª mensagem proativa). `source` na fila ∈ `first_touch|followup|carteira_rescue` (a fila tem `source text` livre — fundação `20260531174908:70`; só `inbound` mapeia pra `outgoing` no loop-gate, então proativos não poluem o loop-detector).

> Soft-dep (ordering, NÃO bloqueia): a *seleção* de candidatos de followup/resgate depende de campos de domínio (lead frio, cliente dormindo) que são config/thresholds (ver Decisões abertas). Esta Task implementa o shell com **selectors parametrizados por threshold** e defaults propostos; o ajuste fino do threshold é config, não premissa silenciosa. O first-touch (Task 6) é o caminho mais "puro" e não depende de threshold.

### Files

- **Create** `supabase/functions/copilot-v2-proactive/index.ts`.
- **Modify** `supabase/functions/_shared/copilot-v2/proactive-scheduler.ts` — adicionar `buildProactiveDirective(kind, slot)` (puro, o `content` da row) + `type ProactiveCandidate`.
- **Modify** `tests/unit/copilot-v2/proactive-scheduler.test.ts` — testar `buildProactiveDirective`.
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — `resolveContext` aceita `source` proativo sem mudar o claim (documentar; o `content` já é o directive, a cognição roda normal). Conferir que `source !== 'inbound'` não quebra `resolveContext` (ele roteia por contact-status do telefone, que existe pra first-touch/followup; pra resgate é `CLIENTE_CARTEIRA`).

### Steps

- [ ] Reler o shell que vamos espelhar (`copilot-v2-worker/index.ts` 34–55: auth + client + claim) e o enqueue (95–109: o `recordOutbound` já chama `copilot_v2_enqueue_message` com `source`/`p_idempotency_key` — mesma RPC).

- [ ] Adicionar `buildProactiveDirective` + tipo ao teste do scheduler:

```ts
import { buildProactiveDirective, type ProactiveCandidate } from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

describe('buildProactiveDirective — system directive content', () => {
  it('produces a tagged directive for followup', () => {
    const d = buildProactiveDirective('followup', 'd3');
    expect(d).toContain('[PROATIVO:followup');
    expect(d).toContain('d3');
  });
  it('differs by kind', () => {
    expect(buildProactiveDirective('first_touch', '1')).not.toBe(buildProactiveDirective('carteira_rescue', 'r1'));
  });
});
```

- [ ] Rodar — FALHAR (sem `buildProactiveDirective`):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

- [ ] Implementar no `proactive-scheduler.ts`:

```ts
export interface ProactiveCandidate {
  organizationId: string;
  leadId: string;
  canonicalPhone: string;
  kind: ProactiveKind;
  slot: string;
}

const DIRECTIVE_BY_KIND: Record<ProactiveKind, string> = {
  first_touch: "Inicie o primeiro contato com este lead novo: apresente-se em nome da empresa e abra a qualificação de forma natural.",
  followup: "Reengaje este lead que esfriou, retomando o assunto anterior de forma leve, sem soar insistente.",
  carteira_rescue: "Reabra a conversa com este cliente que parou de comprar (resgate), de forma calorosa e útil — não como cobrança.",
};

/**
 * O `content` da row proativa: um directive de SISTEMA (não uma fala do lead).
 * O worker passa isso à cognição como o input do turno, então o agente produz
 * a 1ª mensagem proativa respeitando o base-prompt + config do arquétipo.
 */
export function buildProactiveDirective(kind: ProactiveKind, slot: string): string {
  return `[PROATIVO:${kind} ${slot}] ${DIRECTIVE_BY_KIND[kind]}`;
}
```

- [ ] Re-rodar o scheduler — esperar PASSAR (16 ao total):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts
```

- [ ] Implementar o shell `supabase/functions/copilot-v2-proactive/index.ts` (I/O only; toda decisão nos módulos puros):

```ts
/**
 * copilot-v2-proactive — Copilot v2 proactive scheduler (Slice 11, ADR #11).
 *
 * Cron (pg_cron → pg_net, 1/min), auth x-cron-secret. Por org ativa:
 * seleciona candidatos de followup (lead frio) e resgate Carteira (cliente
 * dormindo), aplica os gates PUROS (horário comercial + rate-limit), faz o
 * CLAIM ATÔMICO do slot (anti-double-send) e enfileira UMA vez na fila durável
 * existente (copilot_v2_enqueue_message). O worker existente drena.
 *
 * I/O shell: TODA decisão vive nos módulos puros (proactive-scheduler).
 * organization_id SEMPRE da query scoped por org, NUNCA do payload/LLM.
 * First-touch NÃO passa aqui — entra pelo lead-webhook (evento, Task 6).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { initTraceContext } from "../_shared/copilot-v2/trace-context.ts";
import {
  decideProactiveSend,
  buildProactiveIdempotencyKey,
  buildProactiveDirective,
  interpretClaim,
  type BusinessHoursWindow,
  type ProactiveCandidate,
} from "../_shared/copilot-v2/proactive-scheduler.ts";

// Defaults propostos (ajustáveis — ver "Decisões abertas" no plano). Sobrescritos
// por config da org quando existir.
const DEFAULT_DAILY_CEILING = 50;
const DEFAULT_COLD_LEAD_DAYS = 3;      // lead sem resposta há N dias → followup d{N}
const DEFAULT_DORMANT_DAYS = 60;       // cliente sem pedido há N dias → resgate

serve(
  withSentry("copilot-v2-proactive", async (req: Request) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const now = new Date();

    // Orgs com pelo menos um agente v2 ATIVO (proativo só pra org ativada).
    const { data: activeAgents } = await supabase
      .from("copilot_v2_agents").select("organization_id, archetype").eq("is_active", true);
    const orgIds = [...new Set((activeAgents ?? []).map((a: any) => a.organization_id))];
    if (orgIds.length === 0) return json({ orgs: 0, enqueued: 0 });

    let enqueued = 0;
    for (const orgId of orgIds) {
      // Janela comercial + teto da org (config; fallback default).
      const window = await loadBusinessHours(supabase, orgId);
      const ceiling = await loadDailyCeiling(supabase, orgId);
      const sentToday = await countSentToday(supabase, orgId);

      // Pre-filtro barato (não vai ao DB de candidatos fora de hora / sobre o teto).
      const pre = decideProactiveSend({ window, now, sentToday, ceiling });
      if (!pre.allowed) continue;

      const candidates: ProactiveCandidate[] = [
        ...(await selectFollowupCandidates(supabase, orgId, DEFAULT_COLD_LEAD_DAYS)),
        ...(await selectRescueCandidates(supabase, orgId, DEFAULT_DORMANT_DAYS)),
      ];

      for (const c of candidates) {
        const idem = buildProactiveIdempotencyKey({ orgId: c.organizationId, leadId: c.leadId, kind: c.kind, slot: c.slot });
        // Claim atômico (autoridade do rate-limit + anti-double-send).
        const { data: claimRows } = await supabase.rpc("copilot_v2_claim_proactive_slot", {
          p_org_id: c.organizationId, p_lead_id: c.leadId, p_kind: c.kind,
          p_slot: c.slot, p_idempotency_key: idem, p_daily_ceiling: ceiling,
        });
        const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
        if (!interpretClaim(claim).enqueue) continue;

        const trace = initTraceContext({
          org_id: c.organizationId, canonical_phone: c.canonicalPhone, lead_id: c.leadId, conversation_id: null,
        });
        const { data: queueId } = await supabase.rpc("copilot_v2_enqueue_message", {
          p_org_id: c.organizationId,
          p_lead_id: c.leadId,
          p_canonical_phone: c.canonicalPhone,
          p_message_type: "text",
          p_content: buildProactiveDirective(c.kind, c.slot),
          p_source: c.kind,                 // first_touch | followup | carteira_rescue
          p_trace_id: trace.trace_id,
          p_idempotency_key: idem,          // mesma chave do ledger → fila colapsa
        });
        if (queueId) {
          enqueued++;
          await supabase.from("copilot_v2_proactive_log")
            .update({ enqueued_queue_id: queueId }).eq("idempotency_key", idem);
        }
      }
    }

    return json({ orgs: orgIds.length, enqueued });
  }),
);

// ── I/O helpers (puro-delegado: estes só leem o DB) ─────────────────────────
async function loadBusinessHours(supabase: any, orgId: string): Promise<BusinessHoursWindow | null> {
  // businessHours mora em copilot_v2_config.slots (mesmo slot do prompt-builder).
  const { data } = await supabase
    .from("copilot_v2_config").select("slots")
    .eq("organization_id", orgId).limit(1).maybeSingle();
  const raw = data?.slots?.businessHours;
  return raw && typeof raw === "object" ? (raw as BusinessHoursWindow) : null;
}
async function loadDailyCeiling(supabase: any, orgId: string): Promise<number> {
  const { data } = await supabase
    .from("copilot_v2_config").select("slots")
    .eq("organization_id", orgId).limit(1).maybeSingle();
  const c = Number(data?.slots?.proactiveDailyCeiling);
  return Number.isFinite(c) && c > 0 ? c : DEFAULT_DAILY_CEILING;
}
async function countSentToday(supabase: any, orgId: string): Promise<number> {
  const { count } = await supabase
    .from("copilot_v2_proactive_log").select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("sent_date", new Date().toISOString().slice(0, 10));
  return count ?? 0;
}
async function selectFollowupCandidates(supabase: any, orgId: string, coldDays: number): Promise<ProactiveCandidate[]> {
  // Leads frios: sem atividade há >= coldDays, com telefone, ainda no pipe de qualificação.
  // (Seleção parametrizada por threshold — ver Decisões abertas. Query mínima; o
  // claim idempotente garante que re-selecionar não duplica.)
  const cutoff = new Date(Date.now() - coldDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("leads").select("id, normalized_phone, updated_at")
    .eq("organization_id", orgId).is("deleted_at", null)
    .not("normalized_phone", "is", null)
    .lte("updated_at", cutoff)
    .limit(100);
  return (data ?? []).map((l: any) => ({
    organizationId: orgId, leadId: l.id, canonicalPhone: l.normalized_phone,
    kind: "followup" as const, slot: `d${coldDays}`,
  }));
}
async function selectRescueCandidates(supabase: any, orgId: string, dormantDays: number): Promise<ProactiveCandidate[]> {
  // Clientes Carteira "dormindo": is_active, sem pedido recente. Threshold = dormantDays.
  // (Ver Decisões abertas — "dormindo" deriva da data do último pedido.)
  const cutoff = new Date(Date.now() - dormantDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("upsell_clients").select("id, lead_id, phone, updated_at")
    .eq("organization_id", orgId).eq("is_active", true)
    .lte("updated_at", cutoff)
    .not("phone", "is", null)
    .limit(100);
  return (data ?? []).map((c: any) => ({
    organizationId: orgId, leadId: c.lead_id, canonicalPhone: c.phone,
    kind: "carteira_rescue" as const, slot: `r${dormantDays}`,
  }));
}
async function loadDailyCeilingUnused() {} // (placeholder removido na impl real)
```

> Nota pro executor: remova o placeholder `loadDailyCeilingUnused`; ele só marca onde a impl real termina. Ajuste os selectors aos campos REAIS de domínio (confirme `leads.updated_at`/`normalized_phone` e `upsell_clients.updated_at`/`phone` no `src/integrations/supabase/types.ts` — a coluna de "último pedido" pode exigir join com a tabela de orders; ver Decisões abertas).

- [ ] Registrar a função no `supabase/config.toml` se ela precisar de `verify_jwt = false` (auth via `x-cron-secret`, padrão das cron edge fns — espelhar a entry do `copilot-v2-worker`). Conferir o bloco existente:

```bash
grep -n "copilot-v2-worker" supabase/config.toml
```

Adicionar entry análoga `[functions.copilot-v2-proactive]` com `verify_jwt = false` logo abaixo.

- [ ] Confirmar (documentar) que `copilot-v2-worker/index.ts resolveContext` lida com row proativa sem mudança: o `content` já é o directive, o roteamento é por `normalized_phone`→contact-status (existe pra todos os 3 kinds), e o loop-gate (`border.ts:153`) só conta `source === 'outbound'` como `outgoing` — `first_touch|followup|carteira_rescue` não viram `outgoing`, então não falseiam o pingpong. Nenhuma edição de código no worker é necessária; adicionar um comentário curto em `resolveContext` documentando que rows proativas reusam o mesmo caminho.

- [ ] **Segurança**: `organization_id` vem da query scoped por org (loop sobre `orgIds` de agentes ativos), nunca do payload. `x-cron-secret` obrigatório. Gates fail-CLOSED (pre-filtro) + claim atômico fail-CLOSED. PII: telefone canônico nas queries é o mesmo padrão do worker; o ledger não guarda conteúdo de mensagem.

- [ ] Commit:

```bash
git add supabase/functions/copilot-v2-proactive/index.ts \
        supabase/functions/_shared/copilot-v2/proactive-scheduler.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/proactive-scheduler.test.ts \
        supabase/config.toml
git commit -m "$(cat <<'EOF'
feat(copilot-v2): edge cron proativo (followup + resgate carteira)

copilot-v2-proactive (pg_cron 1/min, x-cron-secret): por org ativa seleciona
leads frios (followup) e clientes dormindo (resgate), aplica gates puros
(horário+rate-limit) -> claim atômico do slot -> enfileira UMA vez na fila
durável existente com source proativo + chave estável. I/O shell; decisão nos
módulos puros. org sempre da query scoped, nunca do payload.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — First-touch no lead-webhook + schedule pg_cron do proativo

**Problem**: First-touch (ad lead → Qualificador manda a 1ª msg) é **evento**, não cron: dispara quando o `lead-webhook` cria um lead novo (`lead-webhook/index.ts` 866–885, hoje só `fetch outbound-trigger` da v1). Sem um caminho v2, ads não recebem first-touch do v2. E o cron `copilot-v2-proactive` (Task 5) precisa ser agendado (pg_cron 1/min) — sem schedule, followup/resgate nunca rodam.

**Fix**:
- (a) No `lead-webhook`, no bloco `if (isNewLead)`, ADICIONAR (sem remover o v1 — decommission é Slice 12) um enqueue proativo v2 `first_touch` atrás de um guard "a org tem Qualificador v2 ativo". Idempotente por lead (slot `"1"`), via a MESMA RPC de claim + enqueue. Fire-and-forget (não bloqueia a resposta do webhook, igual ao trigger v1).
- (b) NOVA migration schedule do `copilot-v2-proactive` (espelha `20260601020907_schedule_copilot_v2_worker.sql`).

### Files

- **Modify** `supabase/functions/lead-webhook/index.ts` — bloco `if (isNewLead)` (866–885), adicionar enqueue proativo v2 first-touch.
- **Create** `supabase/migrations/<TS+1>_schedule_copilot_v2_proactive.sql`.

### Steps

- [ ] Reler o bloco do `lead-webhook` que vamos estender (linhas 866–885 — o `fetch outbound-trigger`) e o ledger/claim da Task 4 (a chave first-touch é `slot:"1"`).

- [ ] No `lead-webhook/index.ts`, dentro do `if (isNewLead) {`, adicionar ao `backgroundTasks` (depois do push do `outbound-trigger`), guardado por org-ativa:

```ts
    // ── Copilot v2 first-touch (proativo) — ADITIVO, NÃO remove o v1 ──────
    // Só dispara se a org tem um Qualificador v2 ATIVO. Idempotente por lead
    // (slot "1"): a mesma chave nunca enfileira 2x (mata #7/#8/#9 no first-touch).
    backgroundTasks.push((async () => {
      try {
        const phone = result.lead.normalized_phone || result.lead.phone;
        if (!phone) return;
        const { data: qualAgent } = await supabase
          .from("copilot_v2_agents").select("id")
          .eq("organization_id", organizationId).eq("archetype", "qualificador").eq("is_active", true)
          .maybeSingle();
        if (!qualAgent) return; // org não ativou o Qualificador v2 → nada (v1 cuida)

        const idem = `proactive:${organizationId}:first_touch:${leadId}:1`;
        const ceilingRow = await supabase
          .from("copilot_v2_config").select("slots")
          .eq("organization_id", organizationId).limit(1).maybeSingle();
        const ceiling = Number(ceilingRow.data?.slots?.proactiveDailyCeiling) || 50;

        const { data: claimRows } = await supabase.rpc("copilot_v2_claim_proactive_slot", {
          p_org_id: organizationId, p_lead_id: leadId, p_kind: "first_touch",
          p_slot: "1", p_idempotency_key: idem, p_daily_ceiling: ceiling,
        });
        const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
        if (!claim?.claimed) return; // já reivindicado ou rate-limit → não duplica

        const traceId = crypto.randomUUID();
        const { data: queueId } = await supabase.rpc("copilot_v2_enqueue_message", {
          p_org_id: organizationId,
          p_lead_id: leadId,
          p_canonical_phone: phone,
          p_message_type: "text",
          p_content: "[PROATIVO:first_touch 1] Inicie o primeiro contato com este lead novo: apresente-se em nome da empresa e abra a qualificação de forma natural.",
          p_source: "first_touch",
          p_trace_id: traceId,
          p_idempotency_key: idem,
        });
        if (queueId) {
          await supabase.from("copilot_v2_proactive_log")
            .update({ enqueued_queue_id: queueId }).eq("idempotency_key", idem);
          console.log("[lead-webhook] copilot-v2 first-touch enqueued for lead:", leadId);
        }
      } catch (e) {
        console.warn("[lead-webhook] copilot-v2 first-touch failed (non-fatal):", e);
      }
    })());
```

> Nota: o `content` literal duplica o `buildProactiveDirective('first_touch','1')` de propósito — o `lead-webhook` é uma edge fn separada que não importa `_shared/copilot-v2/proactive-scheduler.ts` hoje; o executor PODE importar o helper se preferir DRY (ambos deployam `_shared` junto). Mantenha UM dos dois; se importar, troque o literal por `buildProactiveDirective("first_touch", "1")` e adicione o import.

- [ ] Criar a migration de schedule (`<TS+1>`, espelha `20260601020907`):

```sql
-- Schedule copilot-v2-proactive every minute (first-touch é evento via lead-webhook;
-- followup + resgate Carteira são cron). pg_net → edge com x-cron-secret.
-- NOT applied to prod by this slice — apply requires explicit CTO auth (Slice 12).
create or replace function public.invoke_copilot_v2_proactive()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value into v_url    from public.cron_config where key = 'campaign_rule_dispatch_url';
  select value into v_secret from public.cron_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning '[copilot-v2-proactive] cron_config incomplete: url=%, secret_present=%', v_url is not null, v_secret is not null;
    return;
  end if;
  v_url := replace(v_url, 'campaign-rule-dispatch', 'copilot-v2-proactive');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning '[copilot-v2-proactive] invoke failed: %', sqlerrm;
end $$;

revoke all on function public.invoke_copilot_v2_proactive() from public;
grant execute on function public.invoke_copilot_v2_proactive() to service_role;

do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron not installed — skipping copilot_v2_proactive schedule'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_proactive') then
    perform cron.unschedule('copilot_v2_proactive');
  end if;
  perform cron.schedule('copilot_v2_proactive', '* * * * *', 'SELECT public.invoke_copilot_v2_proactive()');
end $outer$;
```

- [ ] Rodar o teste do agent-engine / lead-webhook vizinho pra garantir que o lead-webhook não regrediu (se existir spec; senão, build/deno-check na Task 7):

```bash
npx vitest run tests/unit/copilot-v2/proactive-scheduler.test.ts tests/unit/copilot-v2/proactive-claim.contract.test.ts
```

Esperado: ambos verdes (esta Task não muda os puros; é o smoke antes do build).

- [ ] **Segurança**: o `organization_id` do first-touch vem de `leadId`→`organizationId` já resolvido pelo `lead-webhook` (webhook key + lead.organization_id), nunca do payload do ad. Guard "Qualificador v2 ativo" evita disparar pra org não-ativada (postura conservadora pré-Slice 12). Idempotência por lead (slot "1") + claim atômico = sem double first-touch. Fire-and-forget não vaza erro pro caller.

- [ ] Commit:

```bash
git add supabase/functions/lead-webhook/index.ts \
        "supabase/migrations/"*_schedule_copilot_v2_proactive.sql
git commit -m "$(cat <<'EOF'
feat(copilot-v2): first-touch no lead-webhook + schedule pg_cron do proativo

Ad lead novo: se a org tem Qualificador v2 ativo, enfileira o first-touch v2
(idempotente por lead, slot "1") via claim atômico + enqueue — aditivo, sem
remover o trigger v1 (decommission é Slice 12). Nova migration agenda
copilot-v2-proactive 1/min (followup + resgate). Não aplicada em prod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Regressão completa + integração `.skip` (corrida/idempotência DB) + build

**Goal**: provar que a suíte copilot-v2 inteira + os ~18 casos novos passam juntos; adicionar a prova DB-level (anti-double-send sob corrida) na suíte `.skip` de integração; e confirmar build/typecheck + `deno check` das edge fns novas (CI não tem gate de `tsc` em edge — root memory `project_ci_no_typecheck_gate` — então verificamos local).

### Files

- **Modify** `tests/integration/copilot-v2/border-regression.test.ts` — adicionar (mantendo `.skip`) o caso de corrida do claim proativo e o caso de rate-limit.

### Steps

- [ ] Adicionar à suíte `.skip` de integração (roda contra dev/prod com service key — convenção do repo; mantém `.skip` até a migration aplicada):

```ts
  it('proactive double-send: 5 concurrent claims of the same slot → exactly 1 enqueued (#7/#8/#9)', async () => {
    const lead = crypto.randomUUID();
    const idem = `proactive:${ORG}:first_touch:${lead}:1`;
    const calls = Array.from({ length: 5 }, () =>
      getAdmin().rpc('copilot_v2_claim_proactive_slot', {
        p_org_id: ORG, p_lead_id: lead, p_kind: 'first_touch',
        p_slot: '1', p_idempotency_key: idem, p_daily_ceiling: 100,
      }),
    );
    const results = await Promise.all(calls);
    const claimed = results.filter((r) => (Array.isArray(r.data) ? r.data[0] : r.data)?.claimed === true).length;
    expect(claimed).toBe(1); // só um tick reivindica o slot — sem double first-touch
    await getAdmin().from('copilot_v2_proactive_log').delete().eq('organization_id', ORG).eq('idempotency_key', idem);
  });

  it('proactive rate-limit: claim blocks at the daily ceiling', async () => {
    const lead = crypto.randomUUID();
    const idem = `proactive:${ORG}:followup:${lead}:d3`;
    const { data } = await getAdmin().rpc('copilot_v2_claim_proactive_slot', {
      p_org_id: ORG, p_lead_id: lead, p_kind: 'followup',
      p_slot: 'd3', p_idempotency_key: idem, p_daily_ceiling: 0, // teto inválido → fail-closed
    });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.claimed).toBe(false);
    expect(row?.reason).toBe('no_rate_ceiling');
  });
```

- [ ] Rodar a suíte copilot-v2 INTEIRA:

```bash
npx vitest run tests/unit/copilot-v2/
```

Esperado: todos os files verdes. Capturar a linha literal (ex.: `Test Files  24 passed (24)` / `Tests  164 passed (164)`) no QA report — NÃO parafrasear "all green" (root memory `feedback_qa_raw_output`).

- [ ] Rodar a suíte de integração (o skip-sentinel mantém verde sem service key):

```bash
npx vitest run tests/integration/copilot-v2/
```

Esperado: 1 passed (sentinel), bloco `.skip` reportado skipped.

- [ ] Typecheck + build (sem gate de `tsc` em edge no CI — verificar local que o frontend ainda typecheck/builda; edge `.ts` fica fora do `tsconfig.app.json`, mas o build não pode regredir):

```bash
npm run typecheck
npm run build
```

Esperado: `typecheck` exit 0 (ou contagem ratchet inalterada); `build` conclui.

- [ ] `deno check` das edge fns novas/tocadas (pega import relativo quebrado que o `tsc` não pega — root memory Fase 9):

```bash
cd supabase/functions && deno check copilot-v2-proactive/index.ts _shared/copilot-v2/proactive-scheduler.ts copilot-v2-worker/index.ts lead-webhook/index.ts
```

Esperado: sem diagnostics.

- [ ] Commit:

```bash
git add tests/integration/copilot-v2/border-regression.test.ts
git commit -m "$(cat <<'EOF'
test(copilot-v2): regressão DB do anti-double-send proativo (corrida + rate-limit)

Suíte .skip de integração: 5 claims concorrentes do mesmo slot -> exatamente
1 reivindicado (mata #7/#8/#9 no proativo); claim com teto 0 -> fail-closed
no_rate_ceiling. Roda contra dev/prod com service key; permanece .skip até
migration aplicada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] Portão final de verificação (colar counts literais no QA report):

```bash
npx vitest run tests/unit/copilot-v2/ tests/integration/copilot-v2/
npm run typecheck && npm run build
```

Tudo verde antes de abrir o PR. **NÃO deployar edge functions nem aplicar as migrations das Tasks 4/6 em prod** — só push da branch; apply em dev via MCP (após validar a fundação), prod só com autorização explícita do CTO (root memory `feedback_never_deploy_prod`, `feedback_push_new_branch`).

---

## 🔒 Segurança

Todos os itens abaixo são invariantes do slice — cada Task que toca a superfície correspondente reafirma:

- 🔒 **org sempre do ctx/border/cron, nunca do payload/LLM**: first-touch usa `organizationId` resolvido pelo `lead-webhook` (webhook key + lead.organization_id); followup/resgate iteram sobre `orgIds` de agentes ativos (query scoped). A fila já carrega `organization_id` na row (fundação). Nenhum caminho lê org do directive proativo nem do payload.
- 🔒 **gates fail-CLOSED**: `decideBusinessHoursGate` (janela ausente/malformada → bloqueia), `decideRateLimitGate` (teto ≤0 → bloqueia), `decideProactiveSend` (1ª razão de bloqueio vence), `interpretClaim` (claim ausente/garbage → não enfileira), `copilot_v2_claim_proactive_slot` (rate-limit + idempotência atômicos). O re-check de human-pause no envio já é fail-CLOSED no `queue-processor` pós-1-H (#49) — o proativo herda isso de graça ao usar a fila/worker existentes.
- 🔒 **anti-double-send (#7/#8/#9)**: chave de idempotência estável SEM timestamp + `UNIQUE (organization_id, idempotency_key)` no ledger E na fila + `ON CONFLICT DO NOTHING` no claim e no enqueue. Dois ticks concorrentes / re-seleção do mesmo candidato → exatamente UM disparo. Provado sob corrida na integração `.skip` (Task 7).
- 🔒 **PII**: telefone canônico nas queries segue o padrão do worker; `copilot_v2_proactive_log` NÃO guarda conteúdo de mensagem (só kind/slot/chave/queue_id) — consistente com o ADR (redaction deferida a v2) e com `trace_steps` que nunca grava conteúdo cru.
- 🔒 **storage/RLS/RPC org-scope**: `copilot_v2_proactive_log` tem `organization_id NOT NULL REFERENCES organizations ON DELETE CASCADE` + RLS deny-all + read org-scoped via `get_my_organization_ids()` (SECURITY DEFINER, sem subquery inline `team_members` — evita recursão RLS sob Realtime). RPC `copilot_v2_claim_proactive_slot` é `SECURITY DEFINER set search_path = public` + `revoke all from public/anon/authenticated` + `grant execute to service_role`.
- 🔒 **boundary com campaigns**: massa fria 1:N continua em `campaigns` (não tocada). O proativo é 1:1 (first-touch/followup/resgate por lead). O claim por (org, lead, kind, slot) garante que um lead numa campanha não recebe ALÉM disso um proativo do MESMO motivo duplicado — mas a *separação de domínio* (o que é "massa fria de campanha" vs "proativo 1:1") tem uma zona cinza sinalizada em Decisões abertas.

---

## ⚠️ Decisões abertas

Estas são decisões de **produto** que o plano NÃO resolve — estão parametrizadas (default proposto + ajustável), não inventadas como premissa silenciosa. Cada uma é um slot de config, não um hard-code:

1. **Janela de horário comercial** (formato + default). O plano propõe `{ days: [1,2,3,4,5], start: "08:00", end: "18:00", tz: "America/Sao_Paulo" }` lido de `copilot_v2_config.slots.businessHours` (o slot que o prompt já consome como string — pode exigir uma forma estruturada paralela). **Aberto:** confirmar o shape do slot (string livre do prompt vs objeto estruturado pro gate) e o default. Fail-CLOSED cobre o "antes de configurar" (não dispara). A UI desse slot é Slice 8 (wizard).
2. **Cadência de followup** (intervalos + nº de tentativas). Default proposto: 1 followup `d3` (lead frio há ≥3 dias). **Aberto:** a sequência completa (`d3`, `d7`, `d14`? máximo de tentativas? critério de parada quando o lead responde — o human-pause/atividade nova já corta, mas a "graduação" da cadência é produto). O `slot` da chave de idempotência já suporta múltiplas etapas (`d3`/`d7`/…) sem mudança de código.
3. **Threshold "dormindo" da Carteira** (resgate). Default proposto: 60 dias sem atividade (`upsell_clients.updated_at` como proxy). **Aberto:** "dormindo" idealmente deriva da **data do último pedido**, não de `updated_at` — `upsell_clients` tem `first_sale_at`/`churned_at`/`reactivated_at` mas não um `last_order_date` direto; a regra real pode exigir join com a tabela de orders/portfolio health (`client_health_snapshots`, `portfolio_rpcs`). Confirmar a fonte canônica de "último pedido" e o threshold. O `selectRescueCandidates` está parametrizado por `dormantDays` — trocar a query é localizado.
4. **Teto de rate-limit proativo por org/dia.** Default proposto: 50/dia, lido de `copilot_v2_config.slots.proactiveDailyCeiling`. **Aberto:** o número e se deve ser por-org-uniforme ou por-arquétipo. Fail-CLOSED se ausente.
5. **Fronteira proativo 1:1 × `campaigns` (massa fria).** ADR #11 fixa "massa fria fica em campaigns, não duplicar". **Aberto/zona cinza:** se um lead está numa campanha ativa, o followup/resgate proativo deve ser SUPRIMIDO (pra não falar por cima da campanha)? O plano NÃO assume — sinaliza pro CTO. Se a regra for "suprimir", o `selectFollowupCandidates`/`selectRescueCandidates` ganham um `NOT EXISTS (campanha_leads ativa)` — mudança localizada de query, sem tocar a arquitetura do scheduler.
