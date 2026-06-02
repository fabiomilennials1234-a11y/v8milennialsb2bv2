---
title: "Slice 1-H — Harness Hardening"
feature: copilot-v2-remodel
slice: "1-H"
phase: "A — Hardening"
status: ready
blocks: "todos os slices (pré-requisito duro)"
depends_on: ["[[slice-0C-cleanup]]"]
branch: feat/copilot-v2/slice-1h-harness-hardening
security: true
tags: [copilot-v2, slice, execution-ready, hardening, security]
---

# Slice 1-H — Harness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-1h-harness-hardening` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev**. Migration via **MCP `apply_migration`** (nunca `db push`). TDD: incidente→regressão. QA com counts literais.
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` · ADR: `docs/adr/0002-copilot-v2-architecture.md`

---

# Slice 1-H — Harness Hardening (Copilot v2 runtime) 🔒

> 🔒 **Security-sensitive**: multi-tenant (org_id always from the trusted border, never the LLM), fail-CLOSED gates, PII in the human-pause path. Every fix preserves or tightens an existing invariant. Tasks 4–7 touch the worker's authority surface (capabilities, context resolution) — review the Segurança note in each.

## Goal

Close 7 audit findings in the copilot-v2 durable-queue runtime that let the reliability harness silently fail open:

1. The loop detector can never fire — outbound replies are never recorded, so `detectIdenticalBurst`/`detectPingpong` see zero outgoing messages.
2. The tested `coalesceFragments` debouncer is dead code — never wired into the border.
3. Gates run only at the border; a human who takes over between enqueue and the (delayed/retried) worker run is talked over.
4. The claim RPC bumps `attempts` at claim time and never re-drives `processing` rows, so a worker crash burns retries and orphans messages forever.
5. Dedup and enqueue are two non-atomic RPCs — a crash between them loses the message (dedup persists, retry suppressed).
6. `ResolvedContext` fans one agent's config across all 3 archetype keys and smuggles `_agentId` via an untyped cast.
7. The capability gate is wired to `capsFor()` returning **all caps true** — every active agent can move stages, schedule, set tier, fill fields, send media, transfer, handoff, regardless of its real config. This is a fail-OPEN authority bug.

## Architecture

Pipeline (read end-to-end before starting):

```
provider → agent-runtime-v2/index.ts (border + ack)
         → _shared/copilot-v2/border.ts processInbound  (validate → phone → gates → dedup → enqueue RPC)
         → copilot_v2_message_queue                       (durable, pg_cron drains 1/min)
         → copilot-v2-worker/index.ts                     (I/O shell: claim → resolveContext → processBatch → sendReply → complete/fail)
         → _shared/copilot-v2/queue-processor.ts          (pure orchestration over one row)
         → _shared/copilot-v2/cognition-worker.ts → cognition-loop.ts (gates: budget → capability → introspect)
         → _shared/copilot-v2/tool-executor.ts
         → sendReply (whatsapp-client)
```

Decision logic lives in **pure** modules (loop-detector, human-pause, message-debounce, capability-gate, dedup-lock, queue-processor, cognition-worker); the worker and border are thin I/O shells. SQL behaviors (claim/fail/dedup/enqueue) live in `SECURITY DEFINER` RPCs. Org identity is set once at the trusted border and carried on the queued row — never derived from the LLM.

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` with explicit `.ts`).
- **Supabase Postgres** RPCs (`SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`).
- **Tests: Vitest** (NOT `deno test`). The 133 copilot-v2 TDD specs live in `tests/unit/copilot-v2/*.test.ts` and import the Deno `.ts` sources directly via relative paths (`../../../supabase/functions/_shared/copilot-v2/x.ts`). Vitest's Vite transform resolves the `.ts` extension.
  - Single file: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Whole copilot-v2 suite: `npx vitest run tests/unit/copilot-v2/`
  - Verified working: `npx vitest run tests/unit/copilot-v2/loop-detector.test.ts` → **10 passed**.
  - Do NOT pass `--reporter=basic` (it fails to load the reporter module in this repo — use the default reporter).

**Branch**: `feat/copilot-v2/slice-1h-harness-hardening` off `develop`.

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-1h-harness-hardening
```

**Migration policy**: Tasks 4, 5, 7 create NEW migrations. Migrations are immutable once applied; never edit `20260531174908`/`20260601015114`. Default target = **dev** (`bcfadphgsibjzivtbjvc`); PROD apply requires explicit CTO authorization in-session. Do NOT apply in this slice unless told to.

---

## Task 1 — #3 Loop-gate records outbound

**Problem**: `border.ts checkLoop` (lines 141–162) reads `copilot_v2_message_queue` rows and maps `source === 'outbound'` → `outgoing`. But the worker's `sendReply` (`copilot-v2-worker/index.ts` 159–166) sends over WhatsApp and **never inserts an outbound row**. So `detectIdenticalBurst` (loop-detector.ts 65–87, needs ≥3 outgoing) and `detectPingpong` (89–124, needs in/out alternation) always see zero outgoing → the loop gate is structurally dead.

**Fix**: after a successful `sendReply`, enqueue the outbound text as a `source:'outbound'` row via `copilot_v2_enqueue_message`, so the next inbound turn's `checkLoop` sees the outgoing side. Use a per-send idempotency key (so the `ON CONFLICT (org, idempotency_key)` doesn't suppress legitimate identical replies — that is exactly the burst we WANT to record). Record from the pure `queue-processor` (where we know the send succeeded) via a new injected dep, keeping the worker the only I/O author.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — add `recordOutbound` dep (lines 29–39) + call it after a successful send (lines 63–66).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — wire `recordOutbound` (insert outbound queue row) into `processBatch` deps (lines 71–87).
- **Modify** `supabase/functions/_shared/copilot-v2/border.ts` — confirm `checkLoop` already consumes outbound rows (no change; document).
- **Create** test `tests/unit/copilot-v2/queue-processor-outbound.test.ts`.

### Steps

- [ ] Read the current send block in `queue-processor.ts` (lines 63–68):

```ts
    if (result.reply && result.reply.trim() !== "") {
      await deps.sendReply(row.canonical_phone, result.reply, row);
      await deps.logStep(row.trace_id, "outbound", null);
    }

    await deps.markComplete(row.id);
```

- [ ] Read the loop mapping it must feed (`border.ts` 152–157):

```ts
    const messages: LoopMessage[] = (data ?? []).map((r: any) => ({
      content_hash: r.content,
      direction: r.source === "outbound" ? "outgoing" : "incoming",
      timestamp: r.created_at,
    }));
```

- [ ] Write the failing test `tests/unit/copilot-v2/queue-processor-outbound.test.ts`:

```ts
/**
 * Slice 1-H #3 — outbound is recorded so the loop gate can fire (Copilot v2)
 *
 * border.ts checkLoop maps queue rows source==='outbound' → outgoing, but the
 * worker never wrote an outbound row, so detectIdenticalBurst/detectPingpong
 * saw zero outgoing and the Bertin loop gate was structurally dead. After a
 * successful send the processor must record the outbound so the NEXT turn sees
 * the outgoing side. Pure: recordOutbound is an injected dep.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx: ResolvedContext = {
  contactStatus: 'NOVO',
  activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const recorded: Array<{ phone: string; text: string }> = [];
  const sent: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async (phone: string, text: string) => { recorded.push({ phone, text }); },
      markComplete: async () => {},
      markFailed: async () => {},
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    recorded, sent,
  };
}

describe('processQueueMessage — records outbound for the loop gate', () => {
  it('records the outbound reply after a successful send', async () => {
    const { base, recorded } = deps();
    await processQueueMessage(row, base);
    expect(recorded).toEqual([{ phone: '11987654321', text: 'olá!' }]);
  });

  it('does NOT record outbound when there is no reply (only tool calls)', async () => {
    const { base, recorded } = deps({ makeLlm: () => ({ async complete() { return { text: null, toolCalls: [] }; } }) });
    await processQueueMessage(row, base);
    expect(recorded).toEqual([]);
  });

  it('does NOT record outbound when the send itself throws (no phantom outgoing)', async () => {
    const { base, recorded } = deps({ sendReply: async () => { throw new Error('uazapi 500'); } });
    await processQueueMessage(row, base);
    expect(recorded).toEqual([]);
  });
});
```

- [ ] Run it — expect FAIL (`recordOutbound` not in `ProcessorDeps`; never called):

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-outbound.test.ts
```

Expected: `Test Files 1 failed` — TypeScript/assertion error on `recordOutbound` / `recorded` empty.

- [ ] Implement in `queue-processor.ts`. Add the dep to `ProcessorDeps` (after `sendReply`, line 35):

```ts
  sendReply: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  /** Records the sent reply as an outbound queue row so the loop gate sees the outgoing side. */
  recordOutbound: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
  markComplete: (id: string) => Promise<void>;
```

  And call it right after the send succeeds (lines 63–66):

```ts
    if (result.reply && result.reply.trim() !== "") {
      await deps.sendReply(row.canonical_phone, result.reply, row);
      await deps.recordOutbound(row.canonical_phone, result.reply, row);
      await deps.logStep(row.trace_id, "outbound", null);
    }
```

  (Ordering matters: `recordOutbound` is AFTER `sendReply`, so a send throw skips the record and is caught by the outer `try/catch` → `markFailed`.)

- [ ] Wire it in `copilot-v2-worker/index.ts` `processBatch` deps. Add after the `sendReply` dep (line 81). The outbound idempotency key must be unique per send so identical replies are not collapsed (we WANT to see 3 identical outgoing → burst):

```ts
      sendReply: (canonicalPhone, text, row) => sendReply(supabase, row.organization_id, canonicalPhone, text),
      recordOutbound: async (canonicalPhone, text, row) => {
        // Unique key per send: identical replies must each be recorded so the
        // identical_outgoing_burst signal can fire (do NOT collapse via dedup).
        const idem = `${row.organization_id}:${canonicalPhone}:outbound:${row.trace_id}:${crypto.randomUUID()}`;
        await supabase.rpc("copilot_v2_enqueue_message", {
          p_org_id: row.organization_id,
          p_lead_id: row.lead_id,
          p_canonical_phone: canonicalPhone,
          p_message_type: "text",
          p_content: text,
          p_source: "outbound",
          p_trace_id: row.trace_id,
          p_idempotency_key: idem,
        }).then(() => {}, () => {});
      },
```

  Note: the inserted row defaults to `status='pending'`; the claim RPC will pick it up and the worker will defer/complete it harmlessly (no archetype turn for an outbound — see Task 6/7 it routes by inbound contact status; an outbound's content is the bot's, not a lead message). It exists purely as a loop-detector signal within the 120s window. *(If a follow-up wants to avoid even claiming these, gate `copilot_v2_claim_messages` on `source = 'inbound'` — out of scope here; recording is the audit fix.)*

- [ ] Re-run — expect PASS:

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-outbound.test.ts
```

Expected: `Test Files 1 passed (1)` / `Tests 3 passed (3)`.

- [ ] Run the regression neighbor + loop suite to prove no break:

```bash
npx vitest run tests/unit/copilot-v2/queue-processor.test.ts tests/unit/copilot-v2/loop-detector.test.ts
```

Expected: both files pass (existing `queue-processor.test.ts` builds `deps()` with `...over as any`, so the new required dep does not break it).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/queue-processor-outbound.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot-v2): registrar outbound pra loop-gate poder disparar

checkLoop mapeava rows source=outbound->outgoing mas sendReply nunca
inseria a saida, entao detectIdenticalBurst/detectPingpong viam zero
outgoing e o gate de loop (incidente Bertin) era estruturalmente morto.
recordOutbound grava a resposta enviada como row outbound (idempotency
key unica por envio pra nao colapsar bursts identicos).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — #19/#69 Wire message-debounce into the border

**Problem**: `message-debounce.ts coalesceFragments` (pure, fully tested in `message-debounce.test.ts`) is **never imported by `border.ts`**. WhatsApp leads send a thought as several quick fragments ("oi", "tudo bem?", "queria orçamento"); each fires its own enqueue → one cognition turn per fragment (noisy + cost + loop hazard — the exact v1 problem the module was built to fix).

**Fix**: coalesce recent un-processed inbound fragments for the same (org, canonical_phone) inside the debounce window into ONE turn before enqueue. Concretely, in `processInbound`, after the gates and before dedup, pull recent inbound queue rows for this contact, append the current fragment, run `coalesceFragments`, and enqueue the **last coalesced group's** content (the burst that includes the just-arrived fragment) instead of the raw single fragment. Keep it pure-testable: the border already takes the `supabase` client; add a `coalesceInbound` helper mirroring `checkLoop`.

> Design note: the durable queue makes true time-window debouncing inherently approximate at the border (we can't hold the request open). The chosen, low-risk semantics: when the new fragment lands, look back over the debounce window (default 8s) at this contact's recent inbound queue rows still `pending`/`retry` (not yet turned into a reply), supersede them (mark their content into one coalesced enqueue), and enqueue the joined content. This is the smallest change that makes the tested debouncer load-bearing. The fragment-superseding (deleting/short-circuiting older pending rows) is left as an explicit follow-up; THIS task wires coalescing of the inbound content the border sees, proven by a border test.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/border.ts` — import `coalesceFragments` (add to imports near line 15–19); add `coalesceInbound` helper + call in `processInbound` before dedup (lines ~90–93).
- **Modify** `tests/unit/copilot-v2/border.test.ts` — extend the mock to return recent inbound rows; add a coalescing assertion. (Keep existing 7 cases green.)

### Steps

- [ ] Read the current border section where content becomes the dedup key + enqueue (border.ts 91–98):

```ts
  // 6. Atomic dedup reservation.
  const source: DedupSource = ctx.source ?? "inbound";
  const dedupKey = buildDedupKey({ orgId: ctx.organizationId, phone: canonicalPhone, content: ctx.content, source });
```

- [ ] Read the debouncer signature it must call (`message-debounce.ts` 22–25):

```ts
export function coalesceFragments(
  fragments: InboundFragment[],
  debounceMs: number,
): CoalescedMessage[] {
```

- [ ] Add the failing test in `tests/unit/copilot-v2/border.test.ts`. First extend `MockOpts`/`makeSupabase` so `from('copilot_v2_message_queue').select(...)` can return recent inbound fragment rows (the mock's `from` currently returns `opts.loopRows` for `.order()`; add a parallel `inboundFragments` and branch by table is overkill — reuse `loopRows` shape since both query the same table). Add this `describe`:

```ts
describe('processInbound — fragment coalescing (#19/#69)', () => {
  it('coalesces the just-arrived fragment with recent pending inbound into one enqueue', async () => {
    const t = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    // Two recent inbound fragments already in the queue for this contact.
    const sb = makeSupabase({
      loopRows: [
        { content: 'oi', source: 'inbound', created_at: t(1500) },
        { content: 'tudo bem?', source: 'inbound', created_at: t(800) },
      ],
    });
    const ack = await processInbound(sb, ctx({ content: 'queria um orçamento' }));
    expect(ack.ack).toBe('queued');
    const enq = sb.rpcCalls.find((c) => c.name === 'copilot_v2_enqueue_message');
    // The enqueued content is the coalesced burst, not the lone fragment.
    expect(enq!.args.p_content).toBe('oi tudo bem? queria um orçamento');
  });

  it('does NOT coalesce a fragment that arrives after the debounce window', async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const sb = makeSupabase({ loopRows: [{ content: 'mensagem antiga', source: 'inbound', created_at: old }] });
    const ack = await processInbound(sb, ctx({ content: 'pergunta nova' }));
    const enq = sb.rpcCalls.find((c) => c.name === 'copilot_v2_enqueue_message');
    expect(enq!.args.p_content).toBe('pergunta nova');
  });
});
```

- [ ] Run — expect FAIL (border enqueues raw `ctx.content`, no coalescing):

```bash
npx vitest run tests/unit/copilot-v2/border.test.ts
```

Expected: the 2 new cases fail (`p_content` is `'queria um orçamento'`, not the joined burst); the 7 existing pass.

- [ ] Implement in `border.ts`. Add import (line ~18, with the others):

```ts
import { coalesceFragments, type InboundFragment } from "./message-debounce.ts";
```

  Add the helper (after `checkLoop`, end of file):

```ts
const DEBOUNCE_MS = 8_000;

/**
 * Coalesces the just-arrived inbound fragment with this contact's recent
 * un-replied inbound fragments (within the debounce window) into one turn.
 * Returns the coalesced content for the burst that contains `current`, or
 * `current` unchanged on any error (fail-OPEN here is safe: worst case is one
 * extra turn, never a lost message and never a double-send).
 */
async function coalesceInbound(
  supabase: any, orgId: string, phone: string, current: string, now: Date,
): Promise<string> {
  try {
    const cutoff = new Date(now.getTime() - DEBOUNCE_MS).toISOString();
    const { data, error } = await supabase
      .from("copilot_v2_message_queue")
      .select("content, source, created_at, status")
      .eq("organization_id", orgId)
      .eq("canonical_phone", phone)
      .eq("source", "inbound")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const prior: InboundFragment[] = (data ?? [])
      .filter((r: any) => r.status === "pending" || r.status === "retry" || r.status == null)
      .map((r: any) => ({ content: r.content, timestamp: r.created_at }));
    const fragments: InboundFragment[] = [...prior, { content: current, timestamp: now.toISOString() }];
    const groups = coalesceFragments(fragments, DEBOUNCE_MS);
    // The burst containing `current` is the last group (chronological).
    const last = groups[groups.length - 1];
    return last?.content ?? current;
  } catch (_err) {
    return current;
  }
}
```

  Wire it in `processInbound` between the loop gate and dedup (replace the `source`/`dedupKey` lines 91–93). The coalesced content becomes the content for both the dedup key and the enqueue:

```ts
  // 6. Coalesce inbound fragments of the same burst into one turn (#19/#69).
  const source: DedupSource = ctx.source ?? "inbound";
  const content = source === "inbound"
    ? await coalesceInbound(supabase, ctx.organizationId, canonicalPhone, ctx.content, new Date())
    : ctx.content;

  // 7. Atomic dedup reservation.
  const dedupKey = buildDedupKey({ orgId: ctx.organizationId, phone: canonicalPhone, content, source });
```

  Then update the enqueue call (line 116) to pass `content` instead of `ctx.content`:

```ts
    p_content: content,
```

- [ ] Re-run — expect PASS (9 cases):

```bash
npx vitest run tests/unit/copilot-v2/border.test.ts tests/unit/copilot-v2/message-debounce.test.ts
```

Expected: `border.test.ts` passes 9, `message-debounce.test.ts` passes 7.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/border.ts tests/unit/copilot-v2/border.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): ligar message-debounce no border (coalescer de fragmentos)

coalesceFragments era puro+testado mas nunca importado. WhatsApp manda
um pensamento em varios fragmentos curtos; v1 disparava 1 turn por
fragmento (ruido/custo/loop). Agora o border junta os fragmentos do
mesmo burst (janela 8s, rows inbound pending/retry) num unico enqueue.
Fail-OPEN seguro: na duvida, 1 turn extra, nunca mensagem perdida.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — #49 Worker re-checks human-pause (and loop) at send time

**Problem**: human-pause + loop gates run only at the border (`border.ts` 68–89). With the durable queue + retry backoff (1/5/15 min — `copilot_v2_fail_message`, migration `20260601015114` line 49), a human can take over the conversation **between** enqueue and the worker actually processing the row. The worker's `processQueueMessage` (`queue-processor.ts` 41–73) never re-checks the pause → it talks over the human. This is the same "40% ai_disabled" incident class, now reachable via the time gap.

**Fix**: in the pure `queue-processor`, before `sendReply`, re-evaluate the human-pause gate (via an injected `checkPause` dep that the worker backs with `copilot_v2_check_human_pause` + `decideHumanPauseGate`). If blocked → skip the send, log the gate reason, mark the message complete (it's correctly suppressed, not failed). Reuse the existing pure `decideHumanPauseGate` so the fail-CLOSED semantics are identical to the border.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — add `checkPause` dep + re-check before send (lines 35–39, 63–66).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — back `checkPause` with the RPC + `decideHumanPauseGate` (deps block 71–87).
- **Create** test `tests/unit/copilot-v2/queue-processor-pause.test.ts`.

### Steps

- [ ] Read the send block again (`queue-processor.ts` 63–68) and the existing fail-CLOSED decision (`human-pause.ts` 33–53) — `checkPause` returns `{ blocked, reason }`.

- [ ] Read the worker's existing pause helper at the border for the exact RPC shape (`border.ts` 128–139):

```ts
async function checkHumanPause(supabase: any, orgId: string, phone: string, now: Date) {
  try {
    const { data, error } = await supabase.rpc("copilot_v2_check_human_pause", {
      p_org_id: orgId, p_canonical_phone: phone,
    });
    if (error) throw error;
    return decideHumanPauseGate({ record: data ? { paused_until: data } : null, checkErrored: false, now });
  } catch (_err) {
    return decideHumanPauseGate({ record: null, checkErrored: true, now });
  }
}
```

- [ ] Write failing test `tests/unit/copilot-v2/queue-processor-pause.test.ts`:

```ts
/**
 * Slice 1-H #49 — worker re-checks human-pause at send time (Copilot v2)
 *
 * Gates ran only at the border. With the durable queue + retry backoff (1/5/15
 * min) a human can take over between enqueue and processing. The processor must
 * re-check the pause right before sending and skip (not send, not fail) if a
 * human is now in control. fail-CLOSED reuse of decideHumanPauseGate.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx: ResolvedContext = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const sent: string[] = []; const completed: string[] = []; const failed: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async () => {},
      markComplete: async (id: string) => { completed.push(id); },
      markFailed: async (id: string) => { failed.push(id); },
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    sent, completed, failed,
  };
}

describe('processQueueMessage — re-checks human-pause before send', () => {
  it('skips the send (and does NOT fail) when a human took over after enqueue', async () => {
    const { base, sent, completed, failed } = deps({
      checkPause: async () => ({ blocked: true, reason: 'human_pause_active' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);          // never talks over the human
    expect(completed).toEqual(['q1']); // correctly suppressed, not a failure
    expect(failed).toEqual([]);
  });

  it('sends normally when no human is in control', async () => {
    const { base, sent } = deps();
    await processQueueMessage(row, base);
    expect(sent).toEqual(['olá!']);
  });

  it('fail-CLOSED: a pause-check error at send time blocks the send', async () => {
    const { base, sent, completed } = deps({
      checkPause: async () => ({ blocked: true, reason: 'pause_check_failed' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
  });
});
```

- [ ] Run — expect FAIL (`checkPause` not in deps / not called):

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-pause.test.ts
```

Expected: `Test Files 1 failed`.

- [ ] Implement in `queue-processor.ts`. Add the dep (after `makeExecutor`, before `sendReply`):

```ts
  /** Re-checks the human-pause gate at SEND time (the durable-queue + retry window). */
  checkPause: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
  sendReply: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
```

  Guard the send block (lines 63–66):

```ts
    if (result.reply && result.reply.trim() !== "") {
      const pause = await deps.checkPause(row);
      if (pause.blocked) {
        // A human took over between enqueue and now — suppress, do not talk over.
        await deps.logStep(row.trace_id, "gate", pause.reason ?? "human_pause_active");
        await deps.markComplete(row.id);
        return;
      }
      await deps.sendReply(row.canonical_phone, result.reply, row);
      await deps.recordOutbound(row.canonical_phone, result.reply, row);
      await deps.logStep(row.trace_id, "outbound", null);
    }

    await deps.markComplete(row.id);
```

- [ ] Wire it in `copilot-v2-worker/index.ts`. Add import (top, with the gate imports):

```ts
import { decideHumanPauseGate } from "../_shared/copilot-v2/human-pause.ts";
```

  Add the dep in the `processBatch` block (after `sendReply`/`recordOutbound`):

```ts
      checkPause: async (row) => {
        try {
          const { data, error } = await supabase.rpc("copilot_v2_check_human_pause", {
            p_org_id: row.organization_id, p_canonical_phone: row.canonical_phone,
          });
          if (error) throw error;
          return decideHumanPauseGate({ record: data ? { paused_until: data } : null, checkErrored: false, now: new Date() });
        } catch (_err) {
          return decideHumanPauseGate({ record: null, checkErrored: true, now: new Date() });
        }
      },
```

- [ ] Re-run — expect PASS (3), then the neighbor suites:

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-pause.test.ts tests/unit/copilot-v2/queue-processor.test.ts tests/unit/copilot-v2/queue-processor-outbound.test.ts
```

Expected: all three files pass. *(Existing `queue-processor.test.ts` uses `...over as any`, so the new required `checkPause` dep does not break it.)*

- [ ] **Segurança**: PII path — the pause carries no message content; re-check sends only org_id + canonical_phone to the `SECURITY DEFINER` RPC. Fail-CLOSED preserved (errored check → blocked). Org_id is the queued row's, never the LLM's.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/queue-processor-pause.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot-v2): re-checar human-pause no envio (janela fila durável)

gates rodavam so no border; com fila durável + retry 1/5/15min um humano
pode assumir entre enqueue e processamento. O processor agora re-avalia
o human-pause logo antes do sendReply e suprime (complete, nao fail) se
houver humano no controle. Reusa decideHumanPauseGate (fail-CLOSED).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — #22 Claim attempts moved to failure + stale-`processing` reaper

**Problem** (`20260601015114_copilot_v2_queue_claim_rpcs.sql`):

```sql
-- claim (lines 11-12): bumps attempts at CLAIM time
update public.copilot_v2_message_queue q
   set status = 'processing', attempts = q.attempts + 1, updated_at = now()
 where q.id in (
   select id ... where status = 'pending'
      or (status = 'retry' and (next_retry_at is null or next_retry_at <= now()))
```

Two bugs:
1. `attempts` is incremented at **claim**, so a transient worker crash (claimed, never completed) burns a retry without a real failure — 3 crashes → DLQ with `last_error` empty.
2. The claim only re-selects `pending`/`retry`. A row left in `processing` by a crashed worker is **never re-driven** — it's orphaned forever (the queue silently drops it).

**Fix** — new migration:
- (a) Move the increment to **failure**: `copilot_v2_claim_messages` no longer bumps `attempts`; `copilot_v2_fail_message` bumps it (`attempts + 1`) before deciding retry-vs-DLQ. This means `attempts` counts real failures.
- (b) Add a **visibility-timeout reaper**: a function that returns stale `processing` rows (`updated_at < now() - interval`) back to `retry`, scheduled on its own cron, so a crashed worker's claims are re-driven instead of orphaned.

> Migrations are immutable — this is a NEW migration superseding the two RPCs and adding the reaper. The worker's `markFailed` already calls `copilot_v2_fail_message` (`copilot-v2-worker/index.ts` line 83), so no worker change is needed for (a).

### Files

- **Create** `supabase/migrations/20260602HHMMSS_copilot_v2_claim_attempts_reaper.sql` (use a real timestamp via the command below).
- **Create** `supabase/migrations/20260602HHMMSS_schedule_copilot_v2_reaper.sql` (cron for the reaper).
- **Create** test `tests/unit/copilot-v2/queue-processor-failmark.test.ts` (unit-level: prove the worker still routes a throw to `markFailed`, unchanged) — and document the DB-level proof goes in the integration regression file (Task 8).

### Steps

- [ ] Read the current `fail_message` increment-vs-decide logic (`20260601015114` lines 33–53). Note `v_attempts` is read BEFORE the decision and compared `>= 3`; with the move, we increment first then compare.

- [ ] Create the migration with a real timestamp:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
touch "supabase/migrations/${TS}_copilot_v2_claim_attempts_reaper.sql"
echo "$TS"   # record this — reuse +1s for the schedule file
```

- [ ] Write the migration SQL (`supabase/migrations/<TS>_copilot_v2_claim_attempts_reaper.sql`):

```sql
-- ============================================================================
-- Copilot v2 — claim hardening (#22): attempts bumped on FAILURE not claim,
-- plus a visibility-timeout reaper that re-drives stale 'processing' rows.
--
-- Supersedes the claim/fail RPCs from 20260601015114 (immutable; re-created
-- here). NOT applied to prod by this slice — apply requires explicit CTO auth.
-- ============================================================================

-- (a) Claim no longer bumps attempts (a claim is not a failure). Same atomic
--     FOR UPDATE SKIP LOCKED selection as before.
create or replace function public.copilot_v2_claim_messages(p_batch_size int default 10)
returns setof public.copilot_v2_message_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.copilot_v2_message_queue q
     set status = 'processing', updated_at = now()
   where q.id in (
     select id from public.copilot_v2_message_queue
      where status = 'pending'
         or (status = 'retry' and (next_retry_at is null or next_retry_at <= now()))
      order by created_at
      for update skip locked
      limit p_batch_size
   )
  returning q.*;
end $$;

-- (a) Failure increments attempts, THEN decides retry vs DLQ. attempts now
--     counts real failures, so a transient crash never burns a retry.
create or replace function public.copilot_v2_fail_message(p_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_org uuid; v_phone text; v_content text; v_trace uuid;
begin
  update public.copilot_v2_message_queue
     set attempts = attempts + 1, updated_at = now()
   where id = p_id
  returning attempts, organization_id, canonical_phone, content, trace_id
    into v_attempts, v_org, v_phone, v_content, v_trace;

  if v_attempts is null then
    return; -- row vanished (cascade delete) — nothing to do
  end if;

  if v_attempts >= 3 then
    update public.copilot_v2_message_queue set status='dead', last_error=p_error, updated_at=now() where id=p_id;
    insert into public.copilot_v2_dlq (organization_id, queue_id, canonical_phone, content, trace_id, reason)
    values (v_org, p_id, v_phone, v_content, v_trace, p_error);
  else
    update public.copilot_v2_message_queue
       set status='retry', last_error=p_error,
           next_retry_at = now() + (case v_attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '15 minutes' end),
           updated_at=now()
     where id=p_id;
  end if;
end $$;

-- (b) Reaper: return rows stuck in 'processing' past the visibility timeout
--     (crashed/timed-out worker) to 'retry' so they are re-driven. Does NOT
--     bump attempts (it was never a real failure). Returns count for logging.
create or replace function public.copilot_v2_reap_stale_processing(p_timeout_minutes int default 5)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with reaped as (
    update public.copilot_v2_message_queue
       set status = 'retry', next_retry_at = now(), updated_at = now(),
           last_error = coalesce(last_error, 'reaped: stale processing (visibility timeout)')
     where status = 'processing'
       and updated_at < now() - make_interval(mins => p_timeout_minutes)
    returning 1
  )
  select count(*) into v_count from reaped;
  return v_count;
end $$;

revoke all on function public.copilot_v2_claim_messages(int) from public, anon, authenticated;
revoke all on function public.copilot_v2_fail_message(uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_v2_reap_stale_processing(int) from public, anon, authenticated;
grant execute on function public.copilot_v2_reap_stale_processing(int) to service_role;
```

- [ ] Create the reaper schedule migration (`supabase/migrations/<TS+1>_schedule_copilot_v2_reaper.sql`), mirroring the worker schedule (`20260601020907`) — runs every minute, calls the reaper directly in SQL (no pg_net needed, it's a pure DB op):

```sql
-- Schedule the copilot v2 stale-processing reaper every minute.
-- Re-drives rows a crashed worker left in 'processing' (visibility timeout 5min).
-- NOT applied to prod by this slice — apply requires explicit CTO auth.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron not installed — skipping copilot_v2_reaper schedule'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_reaper') then
    perform cron.unschedule('copilot_v2_reaper');
  end if;
  perform cron.schedule('copilot_v2_reaper', '* * * * *',
    'SELECT public.copilot_v2_reap_stale_processing(5)');
end $outer$;
```

- [ ] Write a small worker-level unit test confirming a throw still routes to `markFailed` (the contract the moved-increment relies on) — `tests/unit/copilot-v2/queue-processor-failmark.test.ts`:

```ts
/**
 * Slice 1-H #22 — a thrown turn routes to markFailed (Copilot v2)
 *
 * The attempts increment moved into copilot_v2_fail_message (SQL). The pure
 * processor's contract — any throw → markFailed(id, err) — is what makes that
 * correct. This pins the contract; the DB-level attempts/reaper behavior is
 * proven in the integration regression suite (requires Postgres).
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: null, canonical_phone: '11987654321',
  conversation_id: null, content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
} as ResolvedContext;

it('routes a turn exception to markFailed exactly once (attempts++ happens in SQL)', async () => {
  const failed: Array<[string, string]> = [];
  const deps = {
    resolveContext: async () => ctx,
    makeLlm: () => ({ async complete() { throw new Error('llm 503'); } }),
    makeExecutor: () => async () => ({}),
    checkPause: async () => ({ blocked: false, reason: null }),
    sendReply: async () => {},
    recordOutbound: async () => {},
    markComplete: async () => {},
    markFailed: async (id: string, e: string) => { failed.push([id, e]); },
    logStep: async () => {},
  } as ProcessorDeps;
  await processQueueMessage(row, deps);
  expect(failed).toHaveLength(1);
  expect(failed[0][0]).toBe('q1');
  expect(failed[0][1]).toContain('llm 503');
});
```

- [ ] Run — expect PASS (this pins existing behavior; the increment lives in SQL):

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-failmark.test.ts
```

Expected: `Tests 1 passed`. *(There is no failing-first step for the SQL itself — migrations aren't unit-tested in Vitest here; the DB proof is the `.skip` integration suite extended in Task 8. The failing→passing TDD cycle for this task is the contract test above, which would fail if a future refactor stopped routing throws to `markFailed`.)*

- [ ] **Segurança**: reaper is `SECURITY DEFINER` and org-agnostic by design (queue-wide), but only touches `copilot_v2_message_queue` status transitions — no cross-tenant data leak (no SELECT of other orgs' content returned to a caller; returns a count). `revoke all from public/anon/authenticated`, `grant execute to service_role`.

- [ ] Commit:

```bash
git add supabase/migrations/*copilot_v2_claim_attempts_reaper.sql \
        supabase/migrations/*schedule_copilot_v2_reaper.sql \
        tests/unit/copilot-v2/queue-processor-failmark.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot-v2): attempts no fail (nao no claim) + reaper de processing parado

claim_messages incrementava attempts no claim, entao crash transitório
queimava retry; e rows presas em 'processing' (worker morto) nunca eram
re-dirigidas. Nova migration: attempts++ vai pra copilot_v2_fail_message;
copilot_v2_reap_stale_processing devolve rows processing > 5min pra retry
(visibility timeout), agendado em cron proprio. Nao aplicado em prod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — #21 Atomic dedup + enqueue (collapse two RPCs into one)

**Problem** (`border.ts` 94–122): `copilot_v2_acquire_dedup_lock` then `copilot_v2_enqueue_message` are two **separate, non-atomic** RPCs. A crash (or network drop) between them loses the message: the dedup lock persists in `copilot_v2_dedup_locks` (TTL 30–60s), so the provider's retry of the same message is **suppressed as a duplicate** — but it was never enqueued. The message vanishes.

**Fix**: collapse to a single atomic path. The enqueue already has `ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id` (`20260531174908` lines 222–228) — that IS a sufficient dedup primitive (returns `null` when a row with the same idempotency key already exists). Drop the separate pre-lock entirely: enqueue becomes the dedup. `data === null` → duplicate; `data` uuid → reserved+enqueued in one atomic statement. This also removes the `copilot_v2_dedup_locks` round-trip and the lost-message window.

> The `copilot_v2_acquire_dedup_lock` RPC and `copilot_v2_dedup_locks` table are left in place (immutable migration; harmless) but no longer called from the border. A follow-up may drop them.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/border.ts` — remove the `copilot_v2_acquire_dedup_lock` call (lines 94–107); make enqueue the dedup primitive (lines 110–122).
- **Modify** `tests/unit/copilot-v2/border.test.ts` — update the dedup cases (`reserved`/`dedupError`) to assert on enqueue's `null`-return semantics instead.

### Steps

- [ ] Read the current two-step block (`border.ts` 94–122) and the enqueue RPC's `DO NOTHING RETURNING id` (`20260531174908` 222–228). Confirm `enqueue` returns `null` on conflict.

- [ ] Update `border.test.ts`. The mock currently distinguishes `reserved` (dedup lock) from `enqueue`. Rewrite the two dedup cases to drive the enqueue return directly. Replace the `MockOpts` `reserved`/`dedupError` handling so a duplicate is signaled by `enqueue` returning `null`:

```ts
    if (name === 'copilot_v2_enqueue_message') {
      // null return = ON CONFLICT duplicate suppressed (now the dedup primitive)
      return { data: opts.duplicate ? null : 'queue-1', error: opts.enqueueError ? { message: 'x' } : null };
    }
```

  And update the gate cases:

```ts
  it('suppresses a duplicate when the enqueue ON CONFLICT returns null', async () => {
    const ack = await processInbound(makeSupabase({ duplicate: true }), ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'duplicate' });
  });

  it('does NOT call the separate dedup-lock RPC (single atomic enqueue path)', async () => {
    const sb = makeSupabase();
    await processInbound(sb, ctx());
    expect(sb.rpcCalls.some((c) => c.name === 'copilot_v2_acquire_dedup_lock')).toBe(false);
  });
```

  (Remove/replace the old `reserved: false` and `dedupError` cases.)

- [ ] Run — expect FAIL (border still calls `copilot_v2_acquire_dedup_lock`; treats `null` enqueue as success not duplicate):

```bash
npx vitest run tests/unit/copilot-v2/border.test.ts
```

Expected: the new "does NOT call the separate dedup-lock RPC" + "duplicate via null" cases fail.

- [ ] Implement in `border.ts`. Delete the dedup-lock block (current 91–107) and replace the dedup+enqueue section with a single atomic enqueue (keeping the Task 2 `content` coalescing). The dedup key stays as the idempotency key:

```ts
  // 6. Coalesce inbound fragments of the same burst into one turn (#19/#69).
  const source: DedupSource = ctx.source ?? "inbound";
  const content = source === "inbound"
    ? await coalesceInbound(supabase, ctx.organizationId, canonicalPhone, ctx.content, new Date())
    : ctx.content;

  // 7. Atomic dedup + enqueue in ONE statement (#21). The enqueue's
  //    ON CONFLICT(org, idempotency_key) DO NOTHING RETURNING id IS the dedup
  //    primitive — no separate pre-lock, so no crash window can lose a message.
  const idempotencyKey = buildDedupKey({ orgId: ctx.organizationId, phone: canonicalPhone, content, source });
  const { data: queueId, error: enqErr } = await supabase.rpc("copilot_v2_enqueue_message", {
    p_org_id: ctx.organizationId,
    p_lead_id: ctx.leadId ?? null,
    p_canonical_phone: canonicalPhone,
    p_message_type: ctx.messageType ?? "text",
    p_content: content,
    p_source: source,
    p_trace_id: trace.trace_id,
    p_idempotency_key: idempotencyKey,
  });
  if (enqErr) {
    // Enqueue is fail-CLOSED on error: drop rather than risk an un-traced send.
    await logTraceStep(supabase, trace, "gate", "enqueue_failed");
    return { ack: "error", reason: "enqueue_failed", trace_id: trace.trace_id };
  }
  if (queueId == null) {
    // ON CONFLICT suppressed an identical message within the idempotency scope.
    await logTraceStep(supabase, trace, "gate", "duplicate_suppressed");
    return { ack: "skipped", reason: "duplicate", trace_id: trace.trace_id };
  }

  await logTraceStep(supabase, trace, "enqueue", null, { message_type: ctx.messageType ?? "text" });
  return { ack: "queued", trace_id: trace.trace_id, queue_id: queueId };
```

  Remove the now-unused `dedupWindowSeconds` import if nothing else uses it (check: only `buildDedupKey` and `DedupSource` are still needed from `dedup-lock.ts`):

```ts
import { buildDedupKey, type DedupSource } from "./dedup-lock.ts";
```

- [ ] Re-run — expect PASS:

```bash
npx vitest run tests/unit/copilot-v2/border.test.ts tests/unit/copilot-v2/dedup-lock.test.ts
```

Expected: `border.test.ts` passes; `dedup-lock.test.ts` still passes (the pure key/window module is unchanged — `buildDedupKey` still used; `dedupWindowSeconds` keeps its own tests).

- [ ] **Segurança**: idempotency key still scoped by org+phone (multi-tenant isolation preserved — `buildDedupKey` line 44). No double-send risk: `DO NOTHING RETURNING` is atomic, so concurrent identical messages still collapse to exactly one row (proven by the `.skip` "5 concurrent acquires → exactly 1 reserved" integration test, which we retarget at enqueue in Task 8).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/border.ts tests/unit/copilot-v2/border.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot-v2): dedup+enqueue atômico (eliminar janela de perda de msg)

acquire_dedup_lock e enqueue_message eram 2 RPCs não-atômicos: crash
entre elas perdia a mensagem (lock persistia, retry do provider suprimido
como duplicado, mas nunca enfileirado). Agora o ON CONFLICT(org,
idempotency_key) DO NOTHING RETURNING do enqueue É a primitiva de dedup
(null=duplicado). Sem pre-lock, sem janela de perda.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — #50/#51 ResolvedContext correctness (key by resolved archetype + first-class `_agentId`)

**Problem** (`copilot-v2-worker/index.ts resolveContext` 98–148):

```ts
    configByArchetype: { qualificador: config, vendedor: config, carteira: config } as Record<Archetype, AgentConfig>,
    capabilitiesByArchetype: {
      qualificador: capsFor(agentRow), vendedor: capsFor(agentRow), carteira: capsFor(agentRow),
    } as Record<Archetype, Record<string, boolean | undefined>>,
    ...
    _agentId: agentRow?.id ?? null,
  } as ResolvedContext & { _agentId: string | null };
```

Two correctness bugs:
1. ONE archetype's `config`/`caps` (resolved for `agentRow` = the routed archetype's agent) is fanned across **all three** keys. If org has distinct Qualificador + Vendedor agents, the Vendedor config could be served under the `qualificador` key (and vice-versa) depending on which `agentRow` was found. It works today only because cognition reads `[archetype]` and `archetype` is the same one `agentRow` was resolved for — but it's a latent multi-config bug and a lie in the data shape.
2. `_agentId` is smuggled via an untyped `as ResolvedContext & { _agentId... }` cast, then re-cast on read (`processBatch` line 79: `(context as ResolvedContext & { _agentId?: string | null })._agentId`).

**Fix**:
- Key `configByArchetype`/`capabilitiesByArchetype` ONLY by the resolved `archetype` (the other keys are not consumed this turn; populate just the routed one, leaving the rest at safe empties).
- Add `_agentId: string | null` as a **first-class field** on the `ResolvedContext` interface (`cognition-worker.ts` 22–28) and drop both casts.

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/cognition-worker.ts` — add `_agentId` to `ResolvedContext` (lines 22–28).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — key maps by `archetype`, drop casts (98–148 + the read at line 79).
- **Modify** `tests/unit/copilot-v2/cognition-worker.test.ts` — its `ctx()` builder must supply `_agentId` (interface now requires it). Add a case proving config/caps reach the loop keyed by the routed archetype.
- **Modify** `tests/unit/copilot-v2/queue-processor.test.ts` + `queue-processor-*.test.ts` (the `ResolvedContext` literals) — add `_agentId`.

### Steps

- [ ] Read the interface to extend (`cognition-worker.ts` 22–28) and how the routed archetype is selected (`handleQueuedMessage` 56–63: `const config = input.context.configByArchetype[archetype]`).

- [ ] Add the failing test in `cognition-worker.test.ts`. First the interface change will make TS require `_agentId` in the existing `ctx()` builder — that's the red. Add a new assertion case:

```ts
  it('carries _agentId as a first-class field (no untyped cast)', async () => {
    const { makeLlm } = captureLlm(reply);
    const out = await handleQueuedMessage({ ...baseInput, context: ctx({ _agentId: 'agent-42' }), makeLlm });
    expect(out.handled).toBe(true);
    // _agentId lives on the typed context — the executor reads it without a cast.
    // (compile-time proof: ctx() now requires _agentId.)
  });
```

  And update the `ctx()` builder to include it:

```ts
function ctx(overrides: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    contactStatus: 'NOVO',
    activeArchetypes: new Set(['qualificador', 'vendedor', 'carteira']),
    configByArchetype: { qualificador: cfg, vendedor: cfg, carteira: cfg },
    capabilitiesByArchetype: {
      qualificador: { can_move_stage: true }, vendedor: { can_move_stage: true }, carteira: { can_move_stage: true },
    },
    introspection: { stages: ['abordado'], fields: [] },
    _agentId: 'agent-1',
    ...overrides,
  };
}
```

- [ ] Run — expect FAIL (interface lacks `_agentId` → TS error in the worker's literal and/or the new test). Note: TS errors surface as Vitest transform failures:

```bash
npx vitest run tests/unit/copilot-v2/cognition-worker.test.ts
```

Expected: fails on the missing `_agentId` field / new case.

- [ ] Implement. In `cognition-worker.ts`, extend the interface (22–28):

```ts
export interface ResolvedContext {
  contactStatus: ContactStatus;
  activeArchetypes: Set<Archetype>;
  configByArchetype: Record<Archetype, AgentConfig>;
  capabilitiesByArchetype: Record<Archetype, Record<string, boolean | undefined>>;
  introspection: Introspection | null;
  /** The active agent resolved for the routed archetype (null when none). */
  _agentId: string | null;
}
```

  In `copilot-v2-worker/index.ts resolveContext`, key the maps by the resolved `archetype` only and set `_agentId` as a real field (replace the return block 134–147):

```ts
  const emptyConfig: AgentConfig = {};
  const emptyCaps: Record<string, boolean | undefined> = {};
  const baseConfigs: Record<Archetype, AgentConfig> = { qualificador: emptyConfig, vendedor: emptyConfig, carteira: emptyConfig };
  const baseCaps: Record<Archetype, Record<string, boolean | undefined>> = { qualificador: emptyCaps, vendedor: emptyCaps, carteira: emptyCaps };

  return {
    contactStatus: status,
    activeArchetypes,
    // Only the routed archetype's config/caps are resolved this turn — key them
    // there, not fanned across all three (that masked a real multi-agent bug).
    configByArchetype: { ...baseConfigs, [archetype]: config },
    capabilitiesByArchetype: { ...baseCaps, [archetype]: capsFor(agentRow) },
    introspection: {
      stages: (stages ?? []).map((s: any) => s.stage_key),
      fields: (fields ?? []).map((f: any) => f.field_name),
    },
    _agentId: agentRow?.id ?? null,
  };
```

  Drop the cast on read (`processBatch` line 79):

```ts
      makeExecutor: (row, context) => createToolExecutor(supabase, {
        organizationId: row.organization_id,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        canonicalPhone: row.canonical_phone,
        agentId: context._agentId,
      }),
```

  Remove the unused `model-selector` import if `modelForArchetype` is no longer referenced in the worker (it is imported on line 24 but only the types `Archetype`/`ModelId` are used — keep `type` imports, drop the value `modelForArchetype` if flagged by lint).

- [ ] Add `_agentId` to the `ResolvedContext` literals in `queue-processor.test.ts` (line 19–25), `queue-processor-outbound.test.ts`, `queue-processor-pause.test.ts`, `queue-processor-failmark.test.ts` (add `_agentId: null,` / `as ResolvedContext` already covers the cast ones; make explicit where the object is typed `: ResolvedContext`).

- [ ] Re-run the touched suites — expect PASS:

```bash
npx vitest run tests/unit/copilot-v2/cognition-worker.test.ts tests/unit/copilot-v2/queue-processor.test.ts tests/unit/copilot-v2/queue-processor-outbound.test.ts tests/unit/copilot-v2/queue-processor-pause.test.ts tests/unit/copilot-v2/queue-processor-failmark.test.ts
```

Expected: all pass.

- [ ] **Segurança**: tighter — config/caps are no longer cross-served between archetypes; the agent the executor binds to is now the typed `_agentId` of the routed archetype, not whichever `agentRow` happened to match. Org_id still from the row.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/cognition-worker.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/cognition-worker.test.ts \
        tests/unit/copilot-v2/queue-processor.test.ts \
        tests/unit/copilot-v2/queue-processor-outbound.test.ts \
        tests/unit/copilot-v2/queue-processor-pause.test.ts \
        tests/unit/copilot-v2/queue-processor-failmark.test.ts
git commit -m "$(cat <<'EOF'
refactor(copilot-v2): ResolvedContext keyed pelo archetype roteado + _agentId tipado

resolveContext espalhava UM config/caps nas 3 chaves de archetype
(bug latente multi-agente) e contrabandeava _agentId via cast sem tipo.
Agora config/caps ficam só na chave do archetype roteado e _agentId é
campo first-class da interface ResolvedContext (sem cast na leitura).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — #52 Capability gate reads real per-agent config (fail-CLOSED)

**Problem** (`copilot-v2-worker/index.ts capsFor` 150–157):

```ts
// All capabilities on by default for an active agent; per-capability config is Slice 8.
function capsFor(agentRow: any): Record<string, boolean | undefined> {
  if (!agentRow) return {};
  return {
    can_move_stage: true, can_schedule_meeting: true, can_set_tier: true,
    can_fill_field: true, can_send_media: true, can_transfer: true, can_handoff: true,
  };
}
```

Every active agent gets **all 7 write capabilities ON**. The capability-gate (`capability-gate.ts` 30–38) maps exactly these 7 flags (`can_move_stage`, `can_schedule_meeting`, `can_set_tier`, `can_fill_field`, `can_send_media`, `can_transfer`, `can_handoff`) — so the server-side gate that exists to STOP the LLM from doing things it shouldn't is fully open. This is a fail-OPEN authority hole.

**Fix**: `capsFor` reads the real per-agent flags. The flags live naturally in `copilot_v2_config.slots` (jsonb, `20260531174908` lines 52–59) — already loaded as `config` in `resolveContext`. Read a `capabilities` object from `slots.capabilities` (a JSONB slot), default = **none enabled** (fail-CLOSED) when unset. No new column needed — `slots` is the typed-slot bag for exactly this kind of config. (If a future slice wants a dedicated column, note it; for now `slots.capabilities` is the home.)

> Migration: **none required** — `copilot_v2_config.slots` is existing JSONB. The capability flags are read from `slots.capabilities.{flag}`. Document this as the v2 capability storage location.

### Files

- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — `resolveContext` passes the loaded `cfg.slots.capabilities` into a rewritten `capsFor` (110–157).
- **Create** test `tests/unit/copilot-v2/capability-resolution.test.ts` — pure test of the cap-resolution function (extract it to a tiny pure helper so it's unit-testable without the worker's DB).

### Steps

- [ ] Read the cap names the gate enforces (`capability-gate.ts` 30–38) — the 7 flags above. Read where `config` is loaded (`resolveContext` 122–126):

```ts
  let config: AgentConfig = {};
  if (agentRow) {
    const { data: cfg } = await supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", agentRow.id).maybeSingle();
    if (cfg) config = { ...(cfg.slots ?? {}), escapeHatchNotes: cfg.escape_hatch_notes };
  }
```

- [ ] To make cap-resolution unit-testable, extract a pure helper into `capability-gate.ts` (it's the natural home — it owns the flag names). Add at the end of `capability-gate.ts`:

```ts
/** The full set of write-capability flags this gate knows about. */
export const ALL_WRITE_CAPABILITIES = Object.values(WRITE_TOOL_CAPABILITY);

/**
 * Resolves an agent's per-capability flags from its config slot, fail-CLOSED:
 * a flag is enabled ONLY when explicitly `true` in `slots.capabilities`. Unset,
 * null, missing, or a non-object slot → every capability OFF. This is the
 * server-side authority surface — the LLM is never trusted, and neither is an
 * un-configured agent.
 */
export function resolveAgentCapabilities(
  slots: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  const raw = (slots && typeof slots === "object" ? (slots as any).capabilities : null) ?? {};
  const caps: Record<string, boolean> = {};
  for (const flag of ALL_WRITE_CAPABILITIES) {
    caps[flag] = raw[flag] === true;
  }
  return caps;
}
```

- [ ] Write failing test `tests/unit/copilot-v2/capability-resolution.test.ts`:

```ts
/**
 * Slice 1-H #52 — capability gate reads REAL per-agent flags, fail-CLOSED.
 *
 * The worker's capsFor() returned all 7 write caps true for any active agent,
 * fully opening the server-side gate that exists to stop the LLM. Caps now come
 * from copilot_v2_config.slots.capabilities; unset = none enabled (fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAgentCapabilities,
  decideCapabilityGate,
  ALL_WRITE_CAPABILITIES,
} from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('resolveAgentCapabilities — fail-CLOSED', () => {
  it('disables EVERY write capability when slots are unset', () => {
    const caps = resolveAgentCapabilities(null);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(caps[flag]).toBe(false);
    expect(decideCapabilityGate({ tool: 'move_lead_stage', capabilities: caps }))
      .toEqual({ allowed: false, reason: 'capability_off' });
  });

  it('enables only the flags explicitly set true', () => {
    const caps = resolveAgentCapabilities({ capabilities: { can_move_stage: true, can_send_media: false } });
    expect(caps.can_move_stage).toBe(true);
    expect(caps.can_send_media).toBe(false);
    expect(caps.can_handoff).toBe(false); // unset → off
    expect(decideCapabilityGate({ tool: 'move_lead_stage', capabilities: caps }))
      .toEqual({ allowed: true, reason: null });
    expect(decideCapabilityGate({ tool: 'send_media', capabilities: caps }))
      .toEqual({ allowed: false, reason: 'capability_off' });
  });

  it('treats a truthy-but-not-true value as OFF (no coercion, fail-closed)', () => {
    const caps = resolveAgentCapabilities({ capabilities: { can_transfer: 'yes', can_set_tier: 1 } as any });
    expect(caps.can_transfer).toBe(false);
    expect(caps.can_set_tier).toBe(false);
  });

  it('handles a non-object slot without throwing', () => {
    expect(() => resolveAgentCapabilities('garbage' as any)).not.toThrow();
    const caps = resolveAgentCapabilities('garbage' as any);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(caps[flag]).toBe(false);
  });
});
```

- [ ] Run — expect FAIL (`resolveAgentCapabilities`/`ALL_WRITE_CAPABILITIES` don't exist yet):

```bash
npx vitest run tests/unit/copilot-v2/capability-resolution.test.ts
```

Expected: `Test Files 1 failed` — import error.

- [ ] Implement: the helper above is the green for the test. Now wire it into the worker. In `copilot-v2-worker/index.ts`, capture the raw slots in `resolveContext` (so caps come from the same loaded config), and rewrite `capsFor`:

  - At the config load (122–126), keep the raw slots:

```ts
  let config: AgentConfig = {};
  let slots: Record<string, unknown> | null = null;
  if (agentRow) {
    const { data: cfg } = await supabase.from("copilot_v2_config").select("slots, escape_hatch_notes").eq("agent_id", agentRow.id).maybeSingle();
    if (cfg) { slots = cfg.slots ?? null; config = { ...(cfg.slots ?? {}), escapeHatchNotes: cfg.escape_hatch_notes }; }
  }
```

  - In the return (Task 6's block), resolve caps from the slots:

```ts
    capabilitiesByArchetype: { ...baseCaps, [archetype]: agentRow ? resolveAgentCapabilities(slots) : emptyCaps },
```

  - Delete the old `capsFor` function (150–157) and add the import at top:

```ts
import { resolveAgentCapabilities } from "../_shared/copilot-v2/capability-gate.ts";
```

- [ ] Re-run the cap test + the gate test + the cognition-worker test (it asserts a capability-off write is blocked) — expect PASS:

```bash
npx vitest run tests/unit/copilot-v2/capability-resolution.test.ts tests/unit/copilot-v2/capability-gate.test.ts tests/unit/copilot-v2/cognition-worker.test.ts
```

Expected: all pass.

- [ ] **Segurança** (core of this slice's 🔒): the server-side capability gate is now genuinely closed by default. An agent with no `slots.capabilities` configured cannot move stages, schedule, set tier, fill fields, send media, transfer, or hand off — the LLM proposing such a tool is blocked with `capability_off` and fed back as a tool error. **Document** in the agent config UI/wizard backlog that `slots.capabilities.{flag}` is now the authority source (Slice 8 surfaces it in the UI). Until then, existing v2 agents have ALL caps OFF — this is a deliberate fail-closed posture; note for the CTO that enabling a v2 agent's writes now requires setting `slots.capabilities` (regression-safe vs. the prior all-open default).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/capability-gate.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/capability-resolution.test.ts
git commit -m "$(cat <<'EOF'
fix(copilot-v2): capability-gate lê flags reais por agente (fail-CLOSED)

capsFor() devolvia os 7 write caps true pra qualquer agente ativo,
abrindo totalmente o gate server-side que existe pra conter o LLM.
resolveAgentCapabilities lê copilot_v2_config.slots.capabilities;
flag só liga se explicitamente true (unset/garbage = OFF). Sem migration
(slots já é jsonb). Agentes v2 sem config agora têm escrita desabilitada
por padrão — postura fail-closed deliberada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Full regression: copilot-v2 suite + integration retarget + build

**Goal**: prove the 133 existing TDD specs + the ~13 new cases are green together, retarget the `.skip` DB regression for the now-atomic enqueue dedup, and confirm the frontend build/typecheck aren't broken by the edge changes (CI has no `tsc` gate on edge code — root memory `project_ci_no_typecheck_gate` — so we verify locally).

### Files

- **Modify** `tests/integration/copilot-v2/border-regression.test.ts` — retarget the dedup-race `.skip` case from `copilot_v2_acquire_dedup_lock` to the enqueue-as-dedup primitive (Task 5), and add a reaper case (Task 4). Keep `.skip` (these run against prod with a service key, per repo convention).

### Steps

- [ ] Update the `.skip` integration suite. Replace the dedup-race case body (currently calls `copilot_v2_acquire_dedup_lock`) with the atomic enqueue primitive, and add a reaper case:

```ts
  it('dedup race: 5 concurrent enqueues of the same idempotency key → exactly 1 row', async () => {
    const key = `test-idem-${Date.now()}`;
    const trace = crypto.randomUUID();
    const calls = Array.from({ length: 5 }, () =>
      getAdmin().rpc('copilot_v2_enqueue_message', {
        p_org_id: ORG, p_lead_id: null, p_canonical_phone: '11999990000',
        p_message_type: 'text', p_content: 'corrida', p_source: 'inbound',
        p_trace_id: trace, p_idempotency_key: key,
      }),
    );
    const results = await Promise.all(calls);
    const inserted = results.filter((r) => r.data != null).length;
    expect(inserted).toBe(1); // ON CONFLICT DO NOTHING RETURNING → exactly one
    await getAdmin().from('copilot_v2_message_queue').delete().eq('organization_id', ORG).eq('idempotency_key', key);
  });

  it('reaper: a stale processing row is returned to retry (#22)', async () => {
    const key = `test-reap-${Date.now()}`;
    const trace = crypto.randomUUID();
    const { data: id } = await getAdmin().rpc('copilot_v2_enqueue_message', {
      p_org_id: ORG, p_lead_id: null, p_canonical_phone: '11999990001',
      p_message_type: 'text', p_content: 'reap', p_source: 'inbound',
      p_trace_id: trace, p_idempotency_key: key,
    });
    // Force it stale-processing.
    await getAdmin().from('copilot_v2_message_queue')
      .update({ status: 'processing', updated_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq('id', id);
    const { data: reaped } = await getAdmin().rpc('copilot_v2_reap_stale_processing', { p_timeout_minutes: 5 });
    expect((reaped as number) >= 1).toBe(true);
    const { data: row } = await getAdmin().from('copilot_v2_message_queue').select('status').eq('id', id).single();
    expect(row?.status).toBe('retry');
    await getAdmin().from('copilot_v2_message_queue').delete().eq('id', id);
  });
```

  (Leave the suite `.skip` — it requires the new migration applied to prod, which is out of scope.)

- [ ] Run the FULL copilot-v2 unit suite:

```bash
npx vitest run tests/unit/copilot-v2/
```

Expected: all files green. Capture the literal output line (e.g. `Test Files  20 passed (20)` / `Tests  146 passed (146)`) into the QA report — do NOT paraphrase as "all green" (root memory `feedback_qa_raw_output`).

- [ ] Run the integration suite (the skip-sentinel keeps it green without a service key):

```bash
npx vitest run tests/integration/copilot-v2/
```

Expected: 1 passed (sentinel), skipped block reported skipped.

- [ ] Typecheck + build (no edge `tsc` gate in CI — verify locally that the frontend still typechecks and builds; edge `.ts` lives outside `tsconfig.app.json` scope but build must not regress):

```bash
npm run typecheck
npm run build
```

Expected: `typecheck` exits 0 (or unchanged ratchet count via `npm run typecheck:ratchet`); `build` succeeds.

- [ ] Optional Deno-level lint of the edge changes (no test task asserted for copilot-v2 under Deno, but typecheck the touched edge files):

```bash
cd supabase/functions && deno check copilot-v2-worker/index.ts _shared/copilot-v2/border.ts _shared/copilot-v2/queue-processor.ts _shared/copilot-v2/cognition-worker.ts _shared/copilot-v2/capability-gate.ts
```

Expected: no diagnostics (catches a broken relative import — root memory: `tsc` doesn't catch these, `deno check` does).

- [ ] Commit:

```bash
git add tests/integration/copilot-v2/border-regression.test.ts
git commit -m "$(cat <<'EOF'
test(copilot-v2): retarget regressão DB pra enqueue atômico + reaper

Atualiza a suite .skip de integração: corrida de dedup agora prova o
ON CONFLICT do enqueue (5 enqueues concorrentes -> 1 row) e adiciona caso
do reaper (processing parado > timeout -> retry). Roda contra prod com
service key (convenção do repo), permanece .skip até migration aplicada.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] Final verification gate (paste literal counts into the slice QA report):

```bash
npx vitest run tests/unit/copilot-v2/ tests/integration/copilot-v2/
npm run typecheck && npm run build
```

All must pass before opening the PR. **Do not deploy edge functions or apply the Task 4/7-related migrations** — push the branch only; PROD apply + EasyPanel deploy require explicit CTO authorization (root memory: `feedback_never_deploy_prod`, `feedback_push_new_branch`).

---

### Slice summary (for the PR body)

| # | Fix | Surface | Migration |
|---|-----|---------|-----------|
| 1 | #3 record outbound → loop gate can fire | `queue-processor.ts`, worker | no |
| 2 | #19/#69 wire message-debounce | `border.ts` | no |
| 3 | #49 worker re-checks human-pause at send | `queue-processor.ts`, worker | no |
| 4 | #22 attempts on fail + stale-processing reaper | 2 new migrations | **yes** (dev only, CTO for prod) |
| 5 | #21 atomic dedup+enqueue | `border.ts` | no (reuses existing ON CONFLICT) |
| 6 | #50/#51 ResolvedContext keyed by archetype + typed `_agentId` | `cognition-worker.ts`, worker | no |
| 7 | #52 capability gate reads real per-agent flags (fail-closed) | `capability-gate.ts`, worker | no (uses `slots.capabilities` JSONB) |
| 8 | full regression + build | tests | no |

---

