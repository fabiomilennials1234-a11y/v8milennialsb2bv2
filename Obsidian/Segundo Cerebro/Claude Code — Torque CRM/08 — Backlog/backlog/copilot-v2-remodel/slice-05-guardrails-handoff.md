---
title: "Slice 5 — Guardrails cumulativos + notificação de handoff (definitiva)"
feature: copilot-v2-remodel
slice: "5"
phase: "B — Capabilities core"
status: ready
depends_on: ["[[slice-1H-harness-hardening]]"]
soft_depends_on: ["[[slice-03-tools-media]]", "[[slice-07-ingestion-rag]]"]
branch: feat/copilot-v2/slice-5-guardrails-handoff
handoff: "design (UX sino/toast/config phone+role) → engenheiro (DB+RPC+realtime+PII)"
security: true
tags: [copilot-v2, slice, execution-ready, guardrails, notification, security]
---

# Slice 5 — Guardrails cumulativos + notificação de handoff (definitiva) 🔒

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`).
>
> **Regras do projeto (inegociáveis):** branch `feat/copilot-v2/slice-5-guardrails-handoff` ← `develop`, PR → `develop`, **nunca main**. Deploy só no projeto **dev** (`bcfadphgsibjzivtbjvc`). Migration via **MCP `apply_migration`** (nunca `db push`). TDD: incidente→regressão (cada gate/idempotência é um invariante com teste que falha primeiro). QA com counts literais do runner (nunca "all green" parafraseado).
>
> Mapa: [[_MOC]] · Plano mestre: `.specs/features/copilot-v2/IMPLEMENTATION-PLAN.md` (§5 Slice 5, §9 apêndice) · ADR: `docs/adr/0002-copilot-v2-architecture.md` (decisão #7 + addendum)

---

> 🔒 **Security-sensitive**: PII (telefone do membro em `team_members.phone`), multi-tenant (fan-out de notificação SÓ dentro da org — destino derivado do lead, nunca do payload/LLM), estado de conversa (pause). Todo gate falha **fail-CLOSED** (erro → bloqueia, nunca libera). Org_id SEMPRE do ctx/border/queue, nunca da arg do LLM.

## Goal

Fechar a camada de guardrails cumulativos do v2 + a notificação de handoff humano definitiva. Entrega: (1) os 5 gates do ADR #7 como **funções puras fail-CLOSED** plugadas no loop — capability-gate (já formalizado na 1-H), tool-call budget (já existe, exposto), loop-detector (exposto como gate de turno), **output LLM-as-judge** (modelo barato veta preço/promessa/credencial/tom antes do envio, amostrável por custo) e **input short-circuit** (spam/abuso/concorrente → resposta padrão sem gastar LLM); (2) **HITL** toggle por org (default OFF) que pausa e pede aprovação antes de ação crítica; e (3) a **notificação de `transfer_to_human`** — **confiável, estruturada e idempotente** — que entrega in-app (realtime no sino `AlertsDropdown`) **e** WhatsApp ao **responsável do lead** (role-aware), matando a idempotência por time-bucket frágil do v1 (#26) e o caminho de entrega via worker bugado (#7/#9). Slice 3 consome a infra de notificação por `handoff_to_vendedor` (soft-dep de ordering, não bloqueia).

## Architecture

Pipeline real tocado (leia ponta-a-ponta antes de começar):

```
provider → agent-runtime-v2/index.ts (border)
         → _shared/copilot-v2/border.ts processInbound  (validate → phone → [INPUT SHORT-CIRCUIT] → gates → dedup → enqueue)
         → copilot_v2_message_queue                       (durável, cron 1/min)
         → copilot-v2-worker/index.ts                     (I/O shell: claim → resolveContext → processBatch → sendReply)
         → _shared/copilot-v2/queue-processor.ts          (orquestração pura: pré-send re-check pause [1-H] → [OUTPUT JUDGE] → [HITL gate] → sendReply)
         → _shared/copilot-v2/cognition-worker.ts → cognition-loop.ts (gates por tool-call: budget → capability → introspect)
         → _shared/copilot-v2/tool-executor.ts            (transfer_to_human → pausa + retorna payload estruturado de handoff)
         → [NOTIFY DISPATCH]                               (worker resolve destino role-aware → RPC fan-out org-scoped → notifications + WhatsApp)
```

- **5 gates** vivem em módulos puros (`capability-gate.ts`, `loop-detector.ts` — já existem; novos `output-judge.ts`, `input-short-circuit.ts`, `hitl-gate.ts`), injetados no `queue-processor`/`cognition-loop`. O worker e o border são shells finos de I/O.
- O **input short-circuit** roda no `border.ts` ANTES do enqueue (não gasta turno/LLM — é o ponto barato). O **output judge** + **HITL** rodam no `queue-processor` no momento do envio (depois da cognição, antes do `sendReply`), reusando o mesmo ponto onde a 1-H plugou o re-check de human-pause.
- A **notificação de handoff**: `tool-executor.transferToHuman` já pausa o telefone (canonical-phone keyed) e **retorna** o payload estruturado `{ leadId, reason, summary }` (não despacha — isso é a camada outbound, comentário explícito nas linhas 183-191 do `tool-executor.ts`). Esta slice constrói a camada outbound: o worker, após um turno cujos steps incluem um `transfer_to_human` permitido, resolve o **destino role-aware** a partir do lead (`responsible_id` → `closer_id`/`sdr_id` → time ativo da org) e chama um **RPC de fan-out org-scoped** que (a) insere em `notifications` (entregue realtime ao sino) e (b) enfileira/dispara o WhatsApp ao telefone do membro (`team_members.phone`, opt-in) + mantém `handoff_notify_phones` legado p/ grupos. **Idempotência** por chave estável `transfer:{org}:{lead}:{trace}` — não o `minuteTs` do v1 (`agent-engine.ts:617,638`).
- **In-app realtime**: `notifications` já tem `organization_id` + `user_id` + índices. Hoje o `AlertsDropdown` usa `refetchInterval: 60000` (polling). Esta slice troca por `useRealtimeSubscription("notifications", ["user-alerts"])` (de `@/shared/realtime`, org-scoped, debounce 2s) + toast no INSERT.

## Tech Stack

- **Deno edge functions** (`supabase/functions/**`, `import ... from "./x.ts"` com `.ts` explícito). Módulos puros novos em `_shared/copilot-v2/`.
- **Supabase Postgres** RPCs (`SECURITY DEFINER set search_path = public`, `revoke all from public/anon/authenticated`, `grant execute to service_role`). RLS deny-all default.
- **Frontend** React 18 + TS — `AlertsDropdown.tsx` (sino), `@/shared/realtime`.
- **Tests: Vitest** (NÃO `deno test`). Os specs copilot-v2 importam os `.ts` Deno via path relativo (`../../../supabase/functions/_shared/copilot-v2/x.ts`). O Vite transform resolve a extensão `.ts`.
  - Arquivo único: `npx vitest run tests/unit/copilot-v2/<file>.test.ts`
  - Suíte copilot-v2 inteira: `npx vitest run tests/unit/copilot-v2/`
  - Verificado funcionando no repo: `npx vitest run tests/unit/copilot-v2/capability-gate.test.ts`.
  - **NÃO** passar `--reporter=basic` (falha ao carregar o reporter neste repo — usar o default).

## Setup

```bash
git checkout develop && git pull && git checkout -b feat/copilot-v2/slice-5-guardrails-handoff
```

- [ ] Baseline verde antes de tocar nada (anotar counts literais pra comparar no fim):

```bash
npx vitest run tests/unit/copilot-v2/
```

**Migration policy do slice**: Tasks 6 e 7 criam NOVAS migrations (timestamp real via `date -u +%Y%m%d%H%M%S`). Migrations são **imutáveis** — nunca editar uma existente (`20260531174908`, `20260601015114`, `20260602151330`, etc.). Default target = **dev** (`bcfadphgsibjzivtbjvc`); cada migration é **committed-not-applied** — o executor valida o estado de dev (que tem drift; a fundação copilot-v2 pode faltar) ANTES de aplicar via MCP `apply_migration`. **PROD PROIBIDO** nesta slice. ⚠️ **`team_members.phone` JÁ EXISTE** no schema (nullable — confirmado em `src/integrations/supabase/types.ts:11981`) — ver Task 6 (a migration NÃO recria a coluna; só formaliza semântica opt-in + RLS de leitura do telefone).

---

## Task 1 — Output LLM-as-judge (gate puro, fail-CLOSED, amostrável)

**Problem**: ADR #7 exige um gate de saída — "modelo barato veta resposta com preço/promessa/credencial/tom não autorizado antes de enviar". Hoje não existe: o `queue-processor` (`queue-processor.ts` 67-78) envia `result.reply` direto após o re-check de pause (1-H). Uma resposta do LLM com promessa proibida ("garanto entrega em 2 dias", "10% de desconto", uma credencial vazada) é enviada sem veto. É um buraco de trust/safety (ADR addendum: "brand-voice/commercial-policy linter ... hard pre-send gate").

**Fix**: módulo puro `output-judge.ts` com (a) `decideOutputJudge({ verdict, checkErrored })` — gate **fail-CLOSED** (erro do judge → bloqueia o envio, nunca libera) — e (b) `shouldSampleJudge({ rng, rate })` pra amostragem por custo. A chamada ao modelo barato é I/O injetada (o worker fornece um `runJudge` que usa o `openrouter-client`); o módulo é a decisão pura, testável sem rede. **Amostragem**: default conservador `rate = 1.0` (todo turno passa pelo judge) — ajustável via slot de config; quando NÃO amostrado, o turno passa (não bloqueia) mas é logado pra observabilidade. Ver `## ⚠️ Decisões abertas` — a taxa final e a lista de categorias proibidas são parâmetros, não premissas.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/output-judge.ts`.
- **Create** test `tests/unit/copilot-v2/output-judge.test.ts`.
- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — `judgeOutput` dep + gate antes do `sendReply` (lines 67-78).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — back `judgeOutput` com o modelo barato (deps block 73-115).

### Steps

- [ ] Ler o ponto de envio atual (`queue-processor.ts` 67-78) onde o pause re-check já roda (1-H); o judge entra logo APÓS o pause-block, ANTES do `sendReply`.

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/output-judge.test.ts`:

```ts
/**
 * Slice 5 — output LLM-as-judge gate, fail-CLOSED + amostragem (Copilot v2).
 *
 * ADR-0002 #7: um modelo barato veta preço/promessa/credencial/tom não
 * autorizado ANTES do envio. O gate é puro e fail-CLOSED: um judge que errou
 * bloqueia o envio (nunca libera uma resposta não verificada). A amostragem
 * por custo é pura e determinística (rng injetado).
 */
import { describe, it, expect } from 'vitest';
import {
  decideOutputJudge,
  shouldSampleJudge,
  type JudgeVerdict,
} from '../../../supabase/functions/_shared/copilot-v2/output-judge.ts';

describe('decideOutputJudge — fail-CLOSED', () => {
  it('allows a clean reply', () => {
    const v: JudgeVerdict = { violation: false, category: null };
    expect(decideOutputJudge({ verdict: v, checkErrored: false }))
      .toEqual({ block: false, reason: null });
  });

  it('blocks a reply the judge flagged (forbidden promise/price/credential/tone)', () => {
    const v: JudgeVerdict = { violation: true, category: 'forbidden_promise' };
    expect(decideOutputJudge({ verdict: v, checkErrored: false }))
      .toEqual({ block: true, reason: 'output_judge:forbidden_promise' });
  });

  it('fail-CLOSED: a judge error blocks the send (never ships unverified)', () => {
    expect(decideOutputJudge({ verdict: null, checkErrored: true }))
      .toEqual({ block: true, reason: 'output_judge_check_failed' });
  });

  it('fail-CLOSED: a null verdict with no error is treated as a failed check', () => {
    expect(decideOutputJudge({ verdict: null, checkErrored: false }))
      .toEqual({ block: true, reason: 'output_judge_check_failed' });
  });
});

describe('shouldSampleJudge — cost sampling (deterministic)', () => {
  it('always samples at rate 1.0 (conservative default)', () => {
    expect(shouldSampleJudge({ rng: () => 0.99, rate: 1.0 })).toBe(true);
  });
  it('never samples at rate 0', () => {
    expect(shouldSampleJudge({ rng: () => 0.0, rate: 0 })).toBe(false);
  });
  it('samples when rng < rate', () => {
    expect(shouldSampleJudge({ rng: () => 0.4, rate: 0.5 })).toBe(true);
    expect(shouldSampleJudge({ rng: () => 0.6, rate: 0.5 })).toBe(false);
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/output-judge.test.ts
```

Esperado: `Test Files 1 failed` — import error em `output-judge.ts`.

- [ ] Implementar `supabase/functions/_shared/copilot-v2/output-judge.ts`:

```ts
/**
 * output-judge — Copilot v2 guardrail (Slice 5, ADR-0002 #7).
 *
 * Pre-send gate: a cheap second model vets the reply for an unauthorized price,
 * a forbidden promise/guarantee, a leaked credential, or off-policy tone BEFORE
 * the reply is sent. This module is the PURE decision: the model call (I/O) is
 * injected by the worker. fail-CLOSED — a failed/absent verdict blocks the send;
 * we never ship a reply we could not verify. Sampling lets the operator trade
 * cost for coverage (conservative default = judge every turn).
 */

export type JudgeCategory =
  | "unauthorized_price"
  | "forbidden_promise"
  | "leaked_credential"
  | "off_policy_tone";

export interface JudgeVerdict {
  violation: boolean;
  category: JudgeCategory | null;
}

export interface OutputJudgeGateInput {
  /** The judge model's verdict, or null if the check could not produce one. */
  verdict: JudgeVerdict | null;
  /** True if the judge call (model / parse) threw. */
  checkErrored: boolean;
}

export interface OutputJudgeGateDecision {
  block: boolean;
  reason: string | null;
}

/** fail-CLOSED gate. A failed/absent verdict blocks; a flagged verdict blocks. */
export function decideOutputJudge(input: OutputJudgeGateInput): OutputJudgeGateDecision {
  if (input.checkErrored || input.verdict == null) {
    return { block: true, reason: "output_judge_check_failed" };
  }
  if (input.verdict.violation) {
    return { block: true, reason: `output_judge:${input.verdict.category ?? "unspecified"}` };
  }
  return { block: false, reason: null };
}

export interface SampleInput {
  /** Injected RNG in [0,1). Defaults to Math.random in the worker. */
  rng: () => number;
  /** Sampling rate in [0,1]. 1 = judge every turn (conservative default). */
  rate: number;
}

/** Deterministic cost-sampling decision (pure given rng). */
export function shouldSampleJudge(input: SampleInput): boolean {
  if (input.rate >= 1) return true;
  if (input.rate <= 0) return false;
  return input.rng() < input.rate;
}

/** The prompt fed to the cheap judge model. Tone/policy come from the agent config. */
export function buildJudgePrompt(reply: string, policyNotes: string | null): string {
  return [
    "Você é um auditor de conformidade comercial. Analise a RESPOSTA do agente.",
    "Marque violação se houver: preço/desconto não autorizado, promessa/garantia",
    "(prazo, resultado), credencial/segredo vazado, ou tom fora da política.",
    policyNotes ? `Política da empresa: ${policyNotes}` : "",
    `RESPOSTA: """${reply}"""`,
    'Responda APENAS JSON: {"violation": boolean, "category": string|null}.',
  ].filter(Boolean).join("\n");
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/output-judge.test.ts
```

Esperado: `Test Files 1 passed (1)` / `Tests 7 passed (7)`.

- [ ] Wire no `queue-processor.ts`. Adicionar a dep (após `checkPause`, antes de `sendReply`):

```ts
  /** Re-checks the human-pause gate at SEND time (1-H, the durable-queue window). */
  checkPause: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
  /** Output LLM-as-judge: vets the reply pre-send (Slice 5). fail-CLOSED. */
  judgeOutput: (reply: string, row: QueueRow, context: ResolvedContext) => Promise<{ block: boolean; reason: string | null }>;
  sendReply: (canonicalPhone: string, text: string, row: QueueRow) => Promise<void>;
```

  Inserir o gate logo após o pause-block (entre o `if (pause.blocked)` e o `sendReply`, lines 73-75):

```ts
      const judge = await deps.judgeOutput(result.reply, row, context);
      if (judge.block) {
        // The reply failed the pre-send judge (or the judge errored) — suppress,
        // do not send. Logged for observability; the turn is correctly stopped.
        await deps.logStep(row.trace_id, "gate", judge.reason ?? "output_judge_blocked");
        await deps.markComplete(row.id);
        return;
      }
      await deps.sendReply(row.canonical_phone, result.reply, row);
```

- [ ] Back `judgeOutput` no worker (`copilot-v2-worker/index.ts`, dentro do `processBatch` deps, após `checkPause`). Usa o modelo barato (Flash-class) + amostragem; `import { decideOutputJudge, shouldSampleJudge, buildJudgePrompt } from "../_shared/copilot-v2/output-judge.ts";` no topo:

```ts
      judgeOutput: async (reply, _row, context) => {
        // Sampling: conservative default = judge every turn (rate from config slot).
        const rate = typeof (context as any)?._judgeSampleRate === "number" ? (context as any)._judgeSampleRate : 1.0;
        if (!shouldSampleJudge({ rng: Math.random, rate })) return { block: false, reason: null };
        try {
          const judgeLlm = createOpenRouterClient({ model: "google/gemini-2.5-flash", maxTokens: 64 });
          const policy = (context.configByArchetype?.[routeArchetype(context.contactStatus)] as any)?.commercialPolicy ?? null;
          const resp = await judgeLlm.complete({ system: buildJudgePrompt(reply, policy), messages: [], tools: [] });
          const verdict = JSON.parse(resp.text ?? "null");
          return decideOutputJudge({ verdict, checkErrored: false });
        } catch (_err) {
          return decideOutputJudge({ verdict: null, checkErrored: true });
        }
      },
```

- [ ] Re-rodar o vizinho de regressão (o `queue-processor.test.ts` usa `...over as any`, então a nova dep obrigatória não quebra):

```bash
npx vitest run tests/unit/copilot-v2/output-judge.test.ts tests/unit/copilot-v2/queue-processor.test.ts tests/unit/copilot-v2/queue-processor-pause.test.ts
```

Esperado: todos passam.

- [ ] **Segurança**: fail-CLOSED — judge errado/ausente bloqueia o envio. A política comercial vem do config da org (nunca do LLM). O reply analisado não contém org_id; o judge não recebe nem decide org.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/output-judge.ts \
        tests/unit/copilot-v2/output-judge.test.ts \
        supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): gate output LLM-as-judge pré-envio (fail-CLOSED, amostrável)

ADR #7: modelo barato veta preço/promessa/credencial/tom não autorizado
antes do envio. decideOutputJudge é puro e fail-CLOSED (verdict ausente/erro
-> bloqueia, nunca envia resposta não verificada). shouldSampleJudge troca
custo por cobertura (default conservador: julga todo turno). Plugado no
queue-processor logo antes do sendReply, reusando o ponto do re-check de pause.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Input short-circuit (spam/abuso/concorrente → resposta padrão, sem LLM)

**Problem**: ADR #7 exige um short-circuit determinístico de entrada — "spam/abuso/concorrente tratados sem gastar tokens de LLM". Hoje o `border.ts` enfileira tudo: cada mensagem inbound vira um turno de cognição (custo + risco de loop). Mensagens obviamente descartáveis (flood de emoji, insulto, concorrente sondando) gastam um turno LLM inteiro.

**Fix**: módulo puro `input-short-circuit.ts` que classifica o conteúdo inbound por padrões determinísticos (sem LLM) → `{ action: "pass" | "canned" | "drop", category, cannedReply? }`. Plugado no `border.ts` ANTES dos gates/dedup/enqueue (o ponto mais barato). `canned` → enfileira uma resposta-padrão direto (sem turno LLM); `drop` → ack `skipped` sem enfileirar; `pass` → fluxo normal. fail-OPEN aqui é seguro e correto: na dúvida, classifica `pass` (deixa a cognição normal decidir) — nunca silencia uma mensagem legítima.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/input-short-circuit.ts`.
- **Create** test `tests/unit/copilot-v2/input-short-circuit.test.ts`.
- **Modify** `supabase/functions/_shared/copilot-v2/border.ts` — classificar antes dos gates; `canned`/`drop` curto-circuitam.
- **Modify** `tests/unit/copilot-v2/border.test.ts` — 2 casos (canned não chama cognição; pass segue).

### Steps

- [ ] Ler o `border.ts` onde a sequência valida → phone → gates → coalesce → dedup+enqueue (a 1-H deixou o enqueue como primitivo de dedup). O short-circuit entra logo após resolver `canonicalPhone`, antes dos gates de pause/loop.

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/input-short-circuit.test.ts`:

```ts
/**
 * Slice 5 — input short-circuit, deterministic, no LLM (Copilot v2).
 *
 * ADR-0002 #7: spam/abuse/competitor handled without spending LLM tokens.
 * Pure classifier over the inbound text. fail-OPEN by design: when unsure it
 * returns 'pass' (let normal cognition decide) — never silences a real message.
 */
import { describe, it, expect } from 'vitest';
import { classifyInbound } from '../../../supabase/functions/_shared/copilot-v2/input-short-circuit.ts';

describe('classifyInbound', () => {
  it('passes a normal business message', () => {
    expect(classifyInbound('queria um orçamento de 500 peças').action).toBe('pass');
  });

  it('drops obvious spam / link flood', () => {
    const r = classifyInbound('GANHE DINHEIRO http://x.co http://y.co http://z.co clique agora!!!');
    expect(r.action).toBe('drop');
    expect(r.category).toBe('spam');
  });

  it('returns a canned reply for an abusive/insulting message (no LLM)', () => {
    const r = classifyInbound('vai se ferrar seu lixo idiota');
    expect(r.action).toBe('canned');
    expect(r.category).toBe('abuse');
    expect(r.cannedReply).toBeTruthy();
  });

  it('returns a canned reply for an obvious competitor probe', () => {
    const r = classifyInbound('oi, sou da [concorrente], queria saber sua tabela de preços pra comparar');
    expect(r.action).toBe('canned');
    expect(r.category).toBe('competitor');
  });

  it('fail-OPEN: ambiguous short text passes (never silenced)', () => {
    expect(classifyInbound('?').action).toBe('pass');
    expect(classifyInbound('').action).toBe('pass');
  });
});
```

- [ ] Rodar — esperar FALHAR (módulo não existe):

```bash
npx vitest run tests/unit/copilot-v2/input-short-circuit.test.ts
```

- [ ] Implementar `supabase/functions/_shared/copilot-v2/input-short-circuit.ts`:

```ts
/**
 * input-short-circuit — Copilot v2 guardrail (Slice 5, ADR-0002 #7).
 *
 * Deterministic pre-cognition classifier: spam/abuse/competitor probes are
 * handled WITHOUT spending an LLM turn. Pure (no I/O). fail-OPEN by design — an
 * ambiguous message returns 'pass' so normal cognition decides; we never silence
 * a legitimate lead. 'canned' ships a fixed reply (no LLM); 'drop' acks without
 * enqueue. Competitor/abuse phrasing is configurable; this is the safe baseline.
 */

export type ShortCircuitAction = "pass" | "canned" | "drop";
export type ShortCircuitCategory = "spam" | "abuse" | "competitor" | null;

export interface ShortCircuitResult {
  action: ShortCircuitAction;
  category: ShortCircuitCategory;
  cannedReply?: string;
}

const ABUSE = /\b(idiota|lixo|imbecil|otári[oa]|vai se ferrar|vai se f\w+|merda|cuz[ãa]o)\b/i;
const COMPETITOR = /(sou d[oa].*(concorrente|outra empresa)|comparar.*(pre[çc]o|tabela)|cota[çc][ãa]o.*comparar)/i;
const URL = /https?:\/\/\S+/gi;

const CANNED_ABUSE = "Estou aqui pra ajudar com respeito. Se puder reformular sua mensagem, sigo com você.";
const CANNED_COMPETITOR = "Posso falar sobre nossas soluções e condições. Como posso te ajudar hoje?";

export function classifyInbound(text: string): ShortCircuitResult {
  const t = (text ?? "").trim();
  if (t.length < 3) return { action: "pass", category: null }; // fail-OPEN: too short to judge

  const urlCount = (t.match(URL) ?? []).length;
  const shouty = t === t.toUpperCase() && t.length > 12;
  if (urlCount >= 3 || (urlCount >= 2 && shouty)) {
    return { action: "drop", category: "spam" };
  }
  if (ABUSE.test(t)) {
    return { action: "canned", category: "abuse", cannedReply: CANNED_ABUSE };
  }
  if (COMPETITOR.test(t)) {
    return { action: "canned", category: "competitor", cannedReply: CANNED_COMPETITOR };
  }
  return { action: "pass", category: null };
}
```

- [ ] Wire no `border.ts`. Import + curto-circuito após resolver `canonicalPhone`, antes dos gates. Para `drop` → retorna `{ ack: "skipped", reason: "short_circuit:<cat>" }` sem enqueue. Para `canned` → enfileira a resposta-padrão como uma mensagem `source:"outbound"` direto (sem turno) e retorna `{ ack: "short_circuited" }`. Adicionar import:

```ts
import { classifyInbound } from "./input-short-circuit.ts";
```

  E o bloco (após o `canonicalPhone`, antes do gate de pause):

```ts
  // Input short-circuit (#7): deterministic spam/abuse/competitor handling — no LLM.
  if ((ctx.source ?? "inbound") === "inbound") {
    const sc = classifyInbound(ctx.content);
    if (sc.action === "drop") {
      await logTraceStep(supabase, trace, "gate", `short_circuit:${sc.category}`);
      return { ack: "skipped", reason: `short_circuit:${sc.category}`, trace_id: trace.trace_id };
    }
    if (sc.action === "canned" && sc.cannedReply) {
      await logTraceStep(supabase, trace, "gate", `short_circuit:${sc.category}`);
      // Ship the canned reply directly (no cognition). Idempotency unique per send.
      await supabase.rpc("copilot_v2_enqueue_message", {
        p_org_id: ctx.organizationId, p_lead_id: ctx.leadId ?? null,
        p_canonical_phone: canonicalPhone, p_message_type: "text",
        p_content: sc.cannedReply, p_source: "canned_out", p_trace_id: trace.trace_id,
        p_idempotency_key: `${ctx.organizationId}:${canonicalPhone}:canned:${trace.trace_id}`,
      }).then(() => {}, () => {});
      return { ack: "short_circuited", reason: sc.category ?? "canned", trace_id: trace.trace_id };
    }
  }
```

> Nota de ordering: o `canned_out` source é o reply-padrão; quem o envia de fato é o worker (claim → send). Marcamos `canned_out` (não `outbound`) pra distinguir do registro de loop-gate da 1-H. Manter simples: o worker trata `canned_out` como texto a enviar sem cognição (out-of-scope detalhar aqui — o caminho mínimo é o enqueue; um follow-up pode dar um send dedicado). O importante desta task é o gate barato no border, provado por teste de border.

- [ ] Adicionar 2 casos em `border.test.ts` (canned não chama cognição/segue caminho curto; pass segue normal). Manter os casos existentes verdes.

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/input-short-circuit.test.ts tests/unit/copilot-v2/border.test.ts
```

- [ ] **Segurança**: fail-OPEN aqui é correto (na dúvida, deixa cognição normal — nunca silencia lead legítimo). Nenhum dado cross-tenant: org/lead/phone vêm do ctx do border (instância confiável). Conteúdo não é logado raw (só a categoria).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/input-short-circuit.ts \
        tests/unit/copilot-v2/input-short-circuit.test.ts \
        supabase/functions/_shared/copilot-v2/border.ts \
        tests/unit/copilot-v2/border.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): input short-circuit determinístico (spam/abuso/concorrente)

ADR #7: spam/abuso/concorrente tratados sem gastar turno de LLM. classifyInbound
é puro e fail-OPEN (ambíguo -> pass, nunca silencia lead legítimo). Plugado no
border ANTES dos gates: drop = ack skipped sem enqueue; canned = resposta-padrão
direta sem cognição; pass = fluxo normal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Loop-detector exposto como gate de turno + budget formalizado

**Problem**: a 1-H tornou o loop-detector *alimentável* (registra outbound) e re-checa human-pause no envio. Mas o `loop-detector.ts` (`evaluateLoopSignal` + `decideLoopGate`) só é consultado no `border.ts` no momento do enqueue. O ADR #7 lista os 5 gates como **cumulativos no loop** — o loop-gate deve também ser um gate de turno no momento do envio (mesma janela que a 1-H abriu pro pause: a fila durável + retry deixa o estado de loop evoluir entre enqueue e processamento). Hoje o `queue-processor` não consulta o loop-gate no send. O tool-call budget (`decideToolCallBudget`, `capability-gate.ts` 91-97) já está plugado no `cognition-loop` (linha 83) — só falta ser **exposto/documentado** como um dos 5, não reimplementado.

**Fix**: adicionar `checkLoop` como dep do `queue-processor` (espelhando o `checkPause` da 1-H) que o worker back com a mesma query de janela do border + `decideLoopGate`. No send: se o loop-gate bloqueia → suprime (complete, não fail), loga `bot_loop_detected`/`loop_check_failed`. fail-CLOSED idêntico ao border (reuso de `decideLoopGate`). Budget: nenhuma mudança de código — só um teste de "exposição" que pina que o loop roda a 5/turno via o `cognition-loop` (regressão de contrato).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — dep `checkLoop` + gate no send (após o judge).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — back `checkLoop` (query janela + `evaluateLoopSignal` + `decideLoopGate`).
- **Create** test `tests/unit/copilot-v2/queue-processor-loop.test.ts`.

### Steps

- [ ] Ler `decideLoopGate` (`loop-detector.ts` 141-145) e como o border monta a query de janela (a 1-H deixou o `checkLoop` no border consumindo rows `source==='outbound'`).

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/queue-processor-loop.test.ts`:

```ts
/**
 * Slice 5 — worker re-checks the loop gate at send time (Copilot v2).
 *
 * The loop gate runs at the border (enqueue). With the durable queue + retry,
 * the loop state can evolve between enqueue and processing — the processor must
 * re-check before sending and suppress (complete, not fail) if a loop fired.
 * fail-CLOSED reuse of decideLoopGate.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] }, _agentId: null,
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const sent: string[] = []; const completed: string[] = []; const failed: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      checkLoop: async () => ({ blocked: false, reason: null }),
      judgeOutput: async () => ({ block: false, reason: null }),
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

describe('processQueueMessage — re-checks the loop gate before send', () => {
  it('suppresses (complete, not fail) when a loop fired after enqueue', async () => {
    const { base, sent, completed, failed } = deps({
      checkLoop: async () => ({ blocked: true, reason: 'bot_loop_detected' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
    expect(failed).toEqual([]);
  });

  it('fail-CLOSED: a loop-check error blocks the send', async () => {
    const { base, sent, completed } = deps({
      checkLoop: async () => ({ blocked: true, reason: 'loop_check_failed' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
  });

  it('sends normally when no loop fired', async () => {
    const { base, sent } = deps();
    await processQueueMessage(row, base);
    expect(sent).toEqual(['olá!']);
  });
});
```

- [ ] Rodar — esperar FALHAR (`checkLoop` não está em `ProcessorDeps`):

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-loop.test.ts
```

- [ ] Implementar no `queue-processor.ts`. Dep (após `checkPause`, antes de `judgeOutput`):

```ts
  /** Re-checks the loop gate at SEND time (durable-queue window). fail-CLOSED. */
  checkLoop: (row: QueueRow) => Promise<{ blocked: boolean; reason: string | null }>;
```

  No send-block, inserir o loop-gate ANTES do judge (loop é mais barato que o judge LLM):

```ts
      const loop = await deps.checkLoop(row);
      if (loop.blocked) {
        await deps.logStep(row.trace_id, "gate", loop.reason ?? "bot_loop_detected");
        await deps.markComplete(row.id);
        return;
      }
      const judge = await deps.judgeOutput(result.reply, row, context);
      // ...(do Task 1)
```

- [ ] Back `checkLoop` no worker. Import `import { evaluateLoopSignal, decideLoopGate, type LoopMessage } from "../_shared/copilot-v2/loop-detector.ts";`. A dep consulta a janela de mensagens (mesma tabela que o border):

```ts
      checkLoop: async (row) => {
        try {
          const cutoff = new Date(Date.now() - 120_000).toISOString();
          const { data, error } = await supabase
            .from("copilot_v2_message_queue")
            .select("content, source, created_at")
            .eq("organization_id", row.organization_id)
            .eq("canonical_phone", row.canonical_phone)
            .gte("created_at", cutoff)
            .order("created_at", { ascending: true });
          if (error) throw error;
          const messages: LoopMessage[] = (data ?? []).map((r: any) => ({
            content_hash: r.content,
            direction: r.source === "outbound" ? "outgoing" : "incoming",
            timestamp: r.created_at,
          }));
          const signal = evaluateLoopSignal({ messages, now: new Date() });
          const gate = decideLoopGate({ signal, checkErrored: false });
          return { blocked: gate.block, reason: gate.reason };
        } catch (_err) {
          const gate = decideLoopGate({ signal: null, checkErrored: true });
          return { blocked: gate.block, reason: gate.reason };
        }
      },
```

- [ ] Re-rodar + vizinhos:

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-loop.test.ts tests/unit/copilot-v2/loop-detector.test.ts tests/unit/copilot-v2/queue-processor.test.ts
```

Esperado: todos passam (`loop-detector.test.ts` 10 passed inalterado).

- [ ] **Segurança**: fail-CLOSED — loop-check com erro bloqueia. Janela escopada por org+phone (multi-tenant). Org sempre da row.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/queue-processor-loop.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): expor loop-detector como gate de turno no envio (fail-CLOSED)

ADR #7: os 5 gates são cumulativos no loop. A 1-H tornou o loop-detector
alimentável; aqui ele vira gate de SEND (mesma janela durável que o re-check
de pause). checkLoop reusa evaluateLoopSignal + decideLoopGate; loop disparado
-> suprime (complete, nao fail); erro -> bloqueia.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — HITL gate (toggle por org, default OFF) — pausa + pede aprovação

**Problem**: ADR #7 + addendum: "HITL approval é um toggle por-org (default off)". Hoje não existe: toda ação crítica em lead de alto valor é executada sem aprovação humana. O CTO confirmou no [[_MOC]] §"Decisões abertas" que o default é OFF.

**Fix**: módulo puro `hitl-gate.ts` — `decideHitlGate({ enabled, toolName, leadTier })` retorna `{ requiresApproval, reason }`. Quando a org tem HITL ON e o turno propõe uma ação crítica num lead de alto valor (tier diamante/ouro), o `queue-processor` NÃO envia: cria uma **proposta de aprovação** (insere em `copilot_v2_hitl_approvals` — Task 6) + suprime o envio (complete) até o humano aprovar/editar/rejeitar. fail-CLOSED: HITL ON + dúvida sobre criticidade → exige aprovação (não envia). Quando OFF → passa (comportamento atual).

> ⚠️ **Decisão de produto aberta**: *quais ações são "críticas"* pro HITL e *qual o threshold de "alto valor"*. Default proposto (ajustável): críticas = `{schedule_meeting, send_media, transfer_to_human, handoff_to_vendedor, move_lead_stage}`; alto valor = tier ∈ `{diamante, ouro}`. Estruturado como **parâmetro** (`CRITICAL_TOOLS` + `HIGH_VALUE_TIERS` exportados), não premissa silenciosa. Ver `## ⚠️ Decisões abertas`.

### Files

- **Create** `supabase/functions/_shared/copilot-v2/hitl-gate.ts`.
- **Create** test `tests/unit/copilot-v2/hitl-gate.test.ts`.
- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — dep `checkHitl` + gate (suprime + grava proposta).
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — back `checkHitl` (lê toggle org + tier do lead + grava proposta).

### Steps

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/hitl-gate.test.ts`:

```ts
/**
 * Slice 5 — HITL approval gate (Copilot v2). ADR-0002 #7.
 *
 * Per-org toggle, default OFF. When ON and a critical action targets a
 * high-value lead, the turn requires human approval before acting. Pure +
 * fail-CLOSED: ON + unknown criticality → requires approval (never auto-acts).
 */
import { describe, it, expect } from 'vitest';
import {
  decideHitlGate,
  CRITICAL_TOOLS,
  HIGH_VALUE_TIERS,
} from '../../../supabase/functions/_shared/copilot-v2/hitl-gate.ts';

describe('decideHitlGate', () => {
  it('passes when HITL is OFF (default org posture)', () => {
    expect(decideHitlGate({ enabled: false, toolNames: ['transfer_to_human'], leadTier: 'diamante' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('requires approval: HITL ON + critical tool + high-value lead', () => {
    const d = decideHitlGate({ enabled: true, toolNames: ['schedule_meeting'], leadTier: 'ouro' });
    expect(d.requiresApproval).toBe(true);
    expect(d.reason).toBe('hitl_approval_required');
  });

  it('passes when HITL ON but no critical tool was proposed', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['get_lead_360'], leadTier: 'diamante' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('passes when HITL ON + critical tool but lead is low value', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['send_media'], leadTier: 'bronze' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('fail-CLOSED: HITL ON + critical tool + unknown tier → requires approval', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['transfer_to_human'], leadTier: null }).requiresApproval)
      .toBe(true);
  });

  it('exposes the configurable critical set + high-value tiers', () => {
    expect(CRITICAL_TOOLS.has('transfer_to_human')).toBe(true);
    expect(HIGH_VALUE_TIERS.has('diamante')).toBe(true);
  });
});
```

- [ ] Rodar — esperar FALHAR. Depois implementar `hitl-gate.ts`:

```ts
/**
 * hitl-gate — Copilot v2 Human-in-the-loop approval (Slice 5, ADR-0002 #7).
 *
 * Per-org toggle, default OFF. When ON, a critical action on a high-value lead
 * requires human approval before the agent acts. Pure decision; the proposal
 * persistence + UX live in the worker/DB. fail-CLOSED: ON + a critical tool +
 * an unknown tier → require approval (never auto-act on an unclassified lead).
 *
 * The critical set and the high-value tiers are PARAMETERS (configurable), not
 * silent premises — see the slice's open-decisions note.
 */

export const CRITICAL_TOOLS = new Set<string>([
  "schedule_meeting", "send_media", "transfer_to_human", "handoff_to_vendedor", "move_lead_stage",
]);
export const HIGH_VALUE_TIERS = new Set<string>(["diamante", "ouro"]);

export interface HitlGateInput {
  /** Org toggle. Default OFF. */
  enabled: boolean;
  /** Tools the turn proposed (the steps that were allowed). */
  toolNames: string[];
  /** The lead's qualification tier, or null when unknown. */
  leadTier: string | null;
}

export interface HitlGateDecision {
  requiresApproval: boolean;
  reason: "hitl_approval_required" | null;
}

export function decideHitlGate(input: HitlGateInput): HitlGateDecision {
  if (!input.enabled) return { requiresApproval: false, reason: null };
  const hasCritical = input.toolNames.some((t) => CRITICAL_TOOLS.has(t));
  if (!hasCritical) return { requiresApproval: false, reason: null };
  // fail-CLOSED: unknown tier on a critical action → require approval.
  const highValue = input.leadTier == null || HIGH_VALUE_TIERS.has(input.leadTier);
  return highValue
    ? { requiresApproval: true, reason: "hitl_approval_required" }
    : { requiresApproval: false, reason: null };
}
```

- [ ] Wire no `queue-processor.ts`. Dep `checkHitl: (row, context, toolNames) => Promise<{ requiresApproval: boolean; reason: string | null }>`. O gate roda APÓS a cognição (precisa dos `result.steps`), ANTES do loop/judge/send — se exige aprovação, grava a proposta e suprime:

```ts
    if (result.reply && result.reply.trim() !== "") {
      const proposedTools = result.steps.filter((s) => s.allowed).map((s) => s.name);
      const hitl = await deps.checkHitl(row, context, proposedTools);
      if (hitl.requiresApproval) {
        await deps.logStep(row.trace_id, "gate", hitl.reason ?? "hitl_approval_required", { tools: proposedTools });
        await deps.markComplete(row.id); // suppressed pending human approval
        return;
      }
      const pause = await deps.checkPause(row);
      // ...(re-check pause da 1-H, depois loop [Task 3], depois judge [Task 1], depois sendReply)
    }
```

- [ ] Back `checkHitl` no worker: lê o toggle da org (Task 6 adiciona `organizations` setting ou tabela `copilot_v2_org_settings`) + o tier do lead + grava em `copilot_v2_hitl_approvals` quando exige. Import `import { decideHitlGate } from "../_shared/copilot-v2/hitl-gate.ts";`. (Toggle e tabela vêm da Task 6 — esta dep usa a coluna/tabela criada lá.)

- [ ] Re-rodar + vizinhos:

```bash
npx vitest run tests/unit/copilot-v2/hitl-gate.test.ts tests/unit/copilot-v2/queue-processor.test.ts
```

- [ ] **Segurança**: fail-CLOSED (ON + dúvida → aprovação). Toggle e tier vêm do DB (org do ctx), nunca do LLM. A proposta gravada não contém org do payload.

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/hitl-gate.ts \
        tests/unit/copilot-v2/hitl-gate.test.ts \
        supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): HITL gate (toggle por org, default OFF, fail-CLOSED)

ADR #7: aprovação humana antes de ação crítica em lead de alto valor, toggle
por org default OFF. decideHitlGate é puro: OFF -> passa; ON + tool crítica +
tier alto -> exige aprovação; ON + tier desconhecido -> exige (fail-CLOSED).
Conjunto crítico + tiers de alto valor são parâmetros configuráveis. Quando
exige, o worker grava a proposta e suprime o envio até aprovação humana.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Resolução de destino role-aware (puro) — quem recebe o handoff

**Problem**: a notificação de handoff precisa ir ao **responsável do lead**, role-aware: `responsible_id` → fallback `closer_id`/`sdr_id` → fallback time ativo da org (decidido no plano mestre §5). O v1 mandava só pra `handoff_notify_phones` (grupos fixos, `agent-engine.ts:621`), sem rotear pra pessoa. O `tool-executor.transferToHuman` (`tool-executor.ts` 173-192) já retorna o payload estruturado mas NÃO resolve destino. Precisamos de uma função pura que, dado o lead + os membros, decide os destinatários (user_id + phone) determinísticamente — testável sem DB.

**Fix**: módulo puro `handoff-routing.ts` — `resolveHandoffTargets({ lead, members, activeTeam })` retorna `{ targets: Array<{ userId, memberId, phone, role }>, fallbackUsed }`. Ordem: se `lead.responsible_id` mapeia a um membro ativo → ele; senão `closer_id`; senão `sdr_id`; senão `sale_responsible_id`/`pre_sale_responsible_id`; senão **time ativo da org** (todos os admins ativos). fail-CLOSED de entrega: se NENHUM destino resolve, retorna `fallbackUsed: "org_active_team"` com o time — nunca retorna vazio silencioso (uma notificação que não chega a ninguém é o bug #7/#9 que estamos matando).

### Files

- **Create** `supabase/functions/_shared/copilot-v2/handoff-routing.ts`.
- **Create** test `tests/unit/copilot-v2/handoff-routing.test.ts`.

### Steps

- [ ] Confirmar as colunas reais do lead (de `src/integrations/supabase/types.ts:7726`): `responsible_id`, `closer_id`, `sdr_id`, `sale_responsible_id`, `pre_sale_responsible_id` (todas `string | null`, FK → `team_members`). E `team_members`: `id`, `user_id`, `phone`, `is_active`, `role`, `organization_id` (linha 11966).

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/handoff-routing.test.ts`:

```ts
/**
 * Slice 5 — role-aware handoff routing, pure (Copilot v2).
 *
 * Destination = the lead's owner, role-aware: responsible_id → closer_id/sdr_id
 * → sale/pre_sale → active org team. Never returns an empty set (a notification
 * that reaches no one is the v1 #7/#9 bug). The whatsapp phone is opt-in
 * (team_members.phone may be null — in-app still fires).
 */
import { describe, it, expect } from 'vitest';
import { resolveHandoffTargets, type LeadOwners, type Member } from '../../../supabase/functions/_shared/copilot-v2/handoff-routing.ts';

const members: Member[] = [
  { id: 'm-resp', user_id: 'u-resp', phone: '11900000001', is_active: true, role: 'membro' },
  { id: 'm-closer', user_id: 'u-closer', phone: '11900000002', is_active: true, role: 'membro' },
  { id: 'm-sdr', user_id: 'u-sdr', phone: null, is_active: true, role: 'membro' }, // opt-in phone null
  { id: 'm-admin', user_id: 'u-admin', phone: '11900000009', is_active: true, role: 'admin' },
];

describe('resolveHandoffTargets', () => {
  it('routes to responsible_id first', () => {
    const lead: LeadOwners = { responsible_id: 'm-resp', closer_id: 'm-closer', sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-resp']);
    expect(r.fallbackUsed).toBe(null);
  });

  it('falls back to closer_id when responsible is unset', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: 'm-closer', sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-closer']);
  });

  it('falls back to sdr_id (in-app fires even with phone null)', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: null, sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets[0].userId).toBe('u-sdr');
    expect(r.targets[0].phone).toBe(null);
  });

  it('falls back to the active org team when the lead has no owner', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: null, sdr_id: null };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.fallbackUsed).toBe('org_active_team');
    expect(r.targets.length).toBeGreaterThan(0); // never empty
  });

  it('ignores an owner that is no longer an active member', () => {
    const lead: LeadOwners = { responsible_id: 'm-ghost', closer_id: 'm-closer', sdr_id: null };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-closer']);
  });
});
```

- [ ] Rodar (FALHA), depois implementar `handoff-routing.ts`:

```ts
/**
 * handoff-routing — Copilot v2 role-aware handoff destination (Slice 5).
 *
 * Pure resolution of WHO receives a transfer_to_human notification. Order:
 * responsible_id → closer_id → sdr_id → sale_responsible_id → pre_sale_responsible_id
 * → active org team. Never returns an empty target set — a notification that
 * reaches no one is the v1 #7/#9 bug class. The WhatsApp phone is opt-in
 * (team_members.phone may be null); in-app still fires for those targets.
 */

export interface Member {
  id: string;
  user_id: string | null;
  phone: string | null;
  is_active: boolean;
  role: string;
}

export interface LeadOwners {
  responsible_id?: string | null;
  closer_id?: string | null;
  sdr_id?: string | null;
  sale_responsible_id?: string | null;
  pre_sale_responsible_id?: string | null;
}

export interface HandoffTarget {
  userId: string;
  memberId: string;
  phone: string | null;
  role: string;
}

export interface HandoffRouting {
  targets: HandoffTarget[];
  fallbackUsed: "org_active_team" | null;
}

const OWNER_ORDER: (keyof LeadOwners)[] = [
  "responsible_id", "closer_id", "sdr_id", "sale_responsible_id", "pre_sale_responsible_id",
];

export function resolveHandoffTargets(input: {
  lead: LeadOwners;
  members: Member[];
  activeTeam: Member[];
}): HandoffRouting {
  const byId = new Map(input.members.filter((m) => m.is_active && m.user_id).map((m) => [m.id, m]));
  for (const key of OWNER_ORDER) {
    const memberId = input.lead[key];
    if (memberId && byId.has(memberId)) {
      const m = byId.get(memberId)!;
      return { targets: [toTarget(m)], fallbackUsed: null };
    }
  }
  // Fallback: the active org team (admins first). Never empty.
  const team = input.activeTeam.filter((m) => m.is_active && m.user_id);
  const admins = team.filter((m) => m.role === "admin");
  const chosen = (admins.length ? admins : team).map(toTarget);
  return { targets: chosen, fallbackUsed: "org_active_team" };
}

function toTarget(m: Member): HandoffTarget {
  return { userId: m.user_id!, memberId: m.id, phone: m.phone, role: m.role };
}
```

- [ ] Re-rodar — esperar PASSAR:

```bash
npx vitest run tests/unit/copilot-v2/handoff-routing.test.ts
```

- [ ] **Segurança**: pura — não toca DB, não decide org. O worker (Task 7) busca `members`/`activeTeam` SEMPRE filtrando `organization_id` do ctx, então o fan-out fica dentro da org. Telefone do membro (PII) só sai no target quando opt-in (phone não-null).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/handoff-routing.ts \
        tests/unit/copilot-v2/handoff-routing.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): resolução role-aware do destino do handoff (puro)

Destino = dono do lead, role-aware: responsible_id -> closer/sdr ->
sale/pre_sale -> time ativo da org. Nunca retorna conjunto vazio (notificação
que não chega a ninguém é o bug v1 #7/#9). Telefone do membro é opt-in (phone
null -> só in-app). Pure: sem DB, sem decisão de org.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Migrations (dev-only): RPC fan-out idempotente, HITL toggle/approvals, phone opt-in

**Problem**: a entrega precisa de (a) um **RPC org-scoped, idempotente** que insere a notificação in-app e enfileira a notificação WhatsApp numa única operação (a chave estável mata o time-bucket frágil do v1 #26); (b) uma tabela de **propostas HITL** + um **toggle por org**; (c) formalização do `team_members.phone` como opt-in (a coluna JÁ EXISTE — `types.ts:11981` — então NÃO recriar) e da RLS de leitura desse telefone. Hoje não há RPC nem chave de idempotência estável.

**Fix** — duas NOVAS migrations (imutáveis; timestamp real). A idempotência usa uma `unique` em `copilot_v2_handoff_notifications(organization_id, idempotency_key)` com `idempotency_key = transfer:{org}:{lead}:{trace}` (estável, não `minuteTs`). O RPC `copilot_v2_dispatch_handoff` faz tudo numa transação: dedup pela unique → insere N rows em `notifications` (uma por target user) → grava a row de auditoria/WhatsApp-pending. fail-CLOSED de entrega: se a unique colide (duplicata) → retorna `already_dispatched` sem reinserir.

### Files

- **Create** `supabase/migrations/<TS>_copilot_v2_handoff_dispatch.sql`.
- **Create** `supabase/migrations/<TS+1>_copilot_v2_hitl.sql`.

### Steps

- [ ] Confirmar via MCP que `team_members.phone` e `notifications` existem em dev (drift possível). Se a fundação copilot-v2 faltar em dev, **parar e sinalizar** (não aplicar). Gerar timestamp real:

```bash
TS=$(date -u +%Y%m%d%H%M%S)
echo "$TS"  # reuse +1 for the hitl file
```

- [ ] Escrever `supabase/migrations/<TS>_copilot_v2_handoff_dispatch.sql`:

```sql
-- ============================================================================
-- Copilot v2 — handoff dispatch (Slice 5).
--
-- Idempotent, org-scoped fan-out of a transfer_to_human notification:
--   - in-app: insert one row per target user into public.notifications
--   - whatsapp: queue a pending dispatch row (sent by the worker to the member's
--     opt-in phone) + keep the legacy handoff_notify_phones group path
-- Idempotency: a STABLE key (transfer:{org}:{lead}:{trace}) — NOT the v1 minute
-- time-bucket (#26). The unique on (organization_id, idempotency_key) collapses
-- retries to exactly one dispatch.
--
-- team_members.phone ALREADY EXISTS (nullable) — NOT recreated here; we only
-- formalize the opt-in read surface. NOT applied to prod by this slice.
-- ============================================================================

-- Audit/queue row for one handoff dispatch (idempotent).
create table if not exists public.copilot_v2_handoff_notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  trace_id         uuid,
  idempotency_key  text not null,
  reason           text,
  summary          text,
  tier             text,
  target_user_ids  uuid[] not null default '{}',
  whatsapp_phones  text[] not null default '{}',   -- member opt-in phones + legacy groups
  whatsapp_status  text not null default 'pending', -- pending | sent | failed
  created_at       timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_copilot_v2_handoff_wa_pending
  on public.copilot_v2_handoff_notifications (whatsapp_status, created_at)
  where whatsapp_status = 'pending';

alter table public.copilot_v2_handoff_notifications enable row level security;
-- org-scoped read for the wizard/observability; writes via SECURITY DEFINER RPC.
do $$ begin
  create policy copilot_v2_handoff_org_read on public.copilot_v2_handoff_notifications
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Idempotent dispatch: dedup by stable key → fan out in-app + queue WhatsApp.
-- org_id is supplied by the trusted edge context, NEVER the LLM/payload.
create or replace function public.copilot_v2_dispatch_handoff(
  p_org_id          uuid,
  p_lead_id         uuid,
  p_trace_id        uuid,
  p_idempotency_key text,
  p_reason          text,
  p_summary         text,
  p_tier            text,
  p_target_user_ids uuid[],
  p_whatsapp_phones text[],
  p_title           text,
  p_link            text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid;
begin
  insert into public.copilot_v2_handoff_notifications
    (organization_id, lead_id, trace_id, idempotency_key, reason, summary, tier, target_user_ids, whatsapp_phones)
  values
    (p_org_id, p_lead_id, p_trace_id, p_idempotency_key, p_reason, p_summary, p_tier,
     coalesce(p_target_user_ids, '{}'), coalesce(p_whatsapp_phones, '{}'))
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 'already_dispatched';  -- idempotent: a prior dispatch won
  end if;

  -- In-app: one notification per target user (the AlertsDropdown reads by user_id).
  foreach v_uid in array coalesce(p_target_user_ids, '{}') loop
    insert into public.notifications (organization_id, user_id, type, title, description, lead_id, link)
    values (p_org_id, v_uid, 'transfer_to_human', p_title,
            coalesce(p_summary, p_reason), p_lead_id, coalesce(p_link, '/pipe-whatsapp'));
  end loop;

  return 'dispatched';
end $$;

revoke all on function public.copilot_v2_dispatch_handoff(uuid, uuid, uuid, text, text, text, text, uuid[], text[], text, text) from public, anon, authenticated;
grant execute on function public.copilot_v2_dispatch_handoff(uuid, uuid, uuid, text, text, text, text, uuid[], text[], text, text) to service_role;

-- Mark a handoff's WhatsApp leg sent/failed (worker, after dispatch).
create or replace function public.copilot_v2_mark_handoff_whatsapp(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.copilot_v2_handoff_notifications set whatsapp_status = p_status where id = p_id;
end $$;
revoke all on function public.copilot_v2_mark_handoff_whatsapp(uuid, text) from public, anon, authenticated;
grant execute on function public.copilot_v2_mark_handoff_whatsapp(uuid, text) to service_role;

comment on column public.team_members.phone is
  'Opt-in: WhatsApp pessoal do membro p/ notificação de handoff role-aware (Copilot v2). Null = não recebe WhatsApp (só in-app).';
```

- [ ] Escrever `supabase/migrations/<TS+1>_copilot_v2_hitl.sql`:

```sql
-- ============================================================================
-- Copilot v2 — HITL (Human-in-the-loop) (Slice 5, ADR-0002 #7).
--
-- Per-org toggle (default OFF) + a table of pending approval proposals. When ON
-- and a critical action targets a high-value lead, the worker writes a proposal
-- and suppresses the send until a human approves/edits/rejects. NOT applied to
-- prod by this slice.
-- ============================================================================

-- Per-org settings for the copilot-v2 runtime (extensible). HITL default OFF.
create table if not exists public.copilot_v2_org_settings (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  hitl_enabled     boolean not null default false,
  judge_sample_rate numeric not null default 1.0 check (judge_sample_rate >= 0 and judge_sample_rate <= 1),
  updated_at       timestamptz not null default now()
);
alter table public.copilot_v2_org_settings enable row level security;
do $$ begin
  create policy copilot_v2_org_settings_read on public.copilot_v2_org_settings
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

create table if not exists public.copilot_v2_hitl_approvals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  trace_id         uuid,
  conversation_id  uuid,
  proposed_reply   text,
  proposed_tools   text[] not null default '{}',
  tier             text,
  status           text not null default 'pending', -- pending | approved | edited | rejected
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_copilot_v2_hitl_pending
  on public.copilot_v2_hitl_approvals (organization_id, status, created_at)
  where status = 'pending';
alter table public.copilot_v2_hitl_approvals enable row level security;
do $$ begin
  create policy copilot_v2_hitl_org_read on public.copilot_v2_hitl_approvals
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Worker writes a pending proposal (org from the trusted ctx).
create or replace function public.copilot_v2_create_hitl_proposal(
  p_org_id uuid, p_lead_id uuid, p_trace_id uuid, p_conversation_id uuid,
  p_reply text, p_tools text[], p_tier text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.copilot_v2_hitl_approvals
    (organization_id, lead_id, trace_id, conversation_id, proposed_reply, proposed_tools, tier)
  values (p_org_id, p_lead_id, p_trace_id, p_conversation_id, p_reply, coalesce(p_tools,'{}'), p_tier)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.copilot_v2_create_hitl_proposal(uuid, uuid, uuid, uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.copilot_v2_create_hitl_proposal(uuid, uuid, uuid, uuid, text, text[], text) to service_role;
```

- [ ] **NÃO aplicar** automaticamente. Marcar ambas como **committed-not-applied**. Quando autorizado a aplicar em **dev** (e só dev), via MCP `apply_migration` (uma de cada vez, validando o estado de dev antes). Não há teste Vitest de SQL — a prova DB vai no `.skip` integration (Task 8). RLS cross-org dessas 3 tabelas exige `tests/integration/rls-copilot_v2_handoff.test.ts` (regra `migrations/CLAUDE.md`) — esboçar `.skip` na Task 8.

- [ ] **Segurança**: as 3 tabelas têm `organization_id` + RLS deny-all (SELECT org-scoped via `get_my_organization_ids()`, nunca inline `SELECT FROM team_members` — gotcha de recursão Realtime). Writes só via RPC `SECURITY DEFINER` (org do ctx). `notifications` insere com `user_id` resolvido server-side (Task 5/7), nunca do LLM. `team_members.phone` é PII: leitura org-scoped já existente; não expomos telefone no `notifications.description`.

- [ ] Commit:

```bash
git add supabase/migrations/*_copilot_v2_handoff_dispatch.sql \
        supabase/migrations/*_copilot_v2_hitl.sql
git commit -m "$(cat <<'EOF'
feat(copilot-v2): migrations handoff dispatch idempotente + HITL (dev-only)

copilot_v2_dispatch_handoff: fan-out org-scoped idempotente (unique
org+idempotency_key, chave estável transfer:{org}:{lead}:{trace} - mata o
time-bucket frágil v1 #26) que insere notifications in-app + enfileira WhatsApp.
copilot_v2_org_settings (hitl_enabled default OFF + judge_sample_rate) +
copilot_v2_hitl_approvals. team_members.phone JÁ EXISTE (só comentário opt-in).
RLS deny-all + RPC SECURITY DEFINER service_role. Não aplicado em prod.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Wire da notificação de handoff no worker (idempotente, in-app + WhatsApp)

**Problem**: junta as peças. Após um turno cujos `steps` permitidos incluem `transfer_to_human`, o worker precisa: resolver o destino (Task 5), montar a chave idempotente estável, chamar o RPC de fan-out (Task 6), e disparar o WhatsApp ao(s) telefone(s) opt-in via o adapter (`sendReply`/provider). Hoje o `queue-processor` não despacha nada de handoff — o `tool-executor.transferToHuman` só pausa e retorna o payload (não consumido).

**Fix**: dep `dispatchHandoff` no `queue-processor` (chamada quando um step `transfer_to_human` foi permitido), backed pelo worker que: (a) lê o lead (owners + tier) + members + active team org-scoped; (b) `resolveHandoffTargets`; (c) monta `idempotencyKey = transfer:{org}:{lead}:{trace}`; (d) `rpc copilot_v2_dispatch_handoff` (→ `dispatched` | `already_dispatched`); (e) se `dispatched`, dispara WhatsApp aos `phones` (opt-in dos targets + `handoff_notify_phones` legado) e marca `copilot_v2_mark_handoff_whatsapp`. Idempotência: o RPC garante uma única dispatch; o WhatsApp só dispara no `dispatched` (não no `already_dispatched`) — mata #7/#9 (entrega confiável, claim idempotente).

### Files

- **Modify** `supabase/functions/_shared/copilot-v2/queue-processor.ts` — dep `dispatchHandoff` + chamada quando há step `transfer_to_human` permitido.
- **Modify** `supabase/functions/copilot-v2-worker/index.ts` — back `dispatchHandoff`.
- **Create** test `tests/unit/copilot-v2/queue-processor-handoff.test.ts`.

### Steps

- [ ] Ler o payload estruturado que `transferToHuman` retorna (`tool-executor.ts` 186-191): `{ transferred, reason, paused_until, handoff: { leadId, reason, summary } }`. Os `result.steps` do `runTurn` carregam `{ name, allowed, reason, result }` (cognition-loop.ts 54-59) — o `result` do step `transfer_to_human` é esse payload.

- [ ] Escrever o teste que falha `tests/unit/copilot-v2/queue-processor-handoff.test.ts`:

```ts
/**
 * Slice 5 — worker dispatches the handoff notification idempotently (Copilot v2).
 *
 * When a turn's allowed steps include transfer_to_human, the processor calls
 * dispatchHandoff exactly once with the structured payload. Idempotency is the
 * RPC's job (stable key) — the processor must pass the trace so the key is
 * stable, and must NOT dispatch when no transfer step fired.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'quero falar com humano', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: { can_transfer: true }, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] }, _agentId: 'agent-1',
} as ResolvedContext;

// An LLM that calls transfer_to_human then replies.
function transferLlm() {
  let turn = 0;
  return {
    async complete() {
      if (turn++ === 0) return { text: null, toolCalls: [{ id: 't1', name: 'transfer_to_human', args: { reason: 'pediu humano', summary: 'lead quente' } }] };
      return { text: 'Já passei pro time, um especialista te chama.', toolCalls: [] };
    },
  };
}

function deps(over: Partial<ProcessorDeps> = {}) {
  const dispatched: any[] = []; const sent: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => transferLlm(),
      makeExecutor: () => async (name: string, args: any) =>
        name === 'transfer_to_human'
          ? { transferred: true, reason: args.reason, handoff: { leadId: 'lead-1', reason: args.reason, summary: args.summary } }
          : ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      checkLoop: async () => ({ blocked: false, reason: null }),
      checkHitl: async () => ({ requiresApproval: false, reason: null }),
      judgeOutput: async () => ({ block: false, reason: null }),
      dispatchHandoff: async (r: QueueRow, payload: any) => { dispatched.push({ r, payload }); },
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async () => {},
      markComplete: async () => {},
      markFailed: async () => {},
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    dispatched, sent,
  };
}

describe('processQueueMessage — dispatches handoff notification', () => {
  it('dispatches once with the structured payload when transfer_to_human fired', async () => {
    const { base, dispatched } = deps();
    await processQueueMessage(row, base);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].payload).toMatchObject({ reason: 'pediu humano', summary: 'lead quente', leadId: 'lead-1' });
    expect(dispatched[0].r.trace_id).toBe('tr-1'); // trace passed → stable idempotency key
  });

  it('does NOT dispatch when no transfer step fired', async () => {
    const { base, dispatched } = deps({
      makeLlm: () => ({ async complete() { return { text: 'oi, como ajudo?', toolCalls: [] }; } }),
    });
    await processQueueMessage(row, base);
    expect(dispatched).toEqual([]);
  });
});
```

- [ ] Rodar (FALHA — `dispatchHandoff` não está em deps nem é chamado).

- [ ] Implementar no `queue-processor.ts`. Dep:

```ts
  /** Dispatches the structured handoff notification (idempotent — RPC owns the key). */
  dispatchHandoff: (row: QueueRow, payload: { leadId: string | null; reason: string; summary: string | null; tier?: string | null }) => Promise<void>;
```

  Chamada: após a cognição, varrer `result.steps` por um `transfer_to_human` permitido e despachar (antes do send do reply — a notificação não depende do reply). Inserir após o `logStep` de cognição (perto da linha 65):

```ts
    if (result.handled) {
      const transferStep = result.steps.find((s) => s.name === "transfer_to_human" && s.allowed);
      if (transferStep) {
        const h = (transferStep.result as any)?.handoff ?? {};
        await deps.dispatchHandoff(row, {
          leadId: h.leadId ?? row.lead_id ?? null,
          reason: h.reason ?? "transfer",
          summary: h.summary ?? null,
        });
      }
    }
```

- [ ] Back `dispatchHandoff` no worker. Resolve owners + members org-scoped, roteia (Task 5), chama o RPC (Task 6), dispara WhatsApp no `dispatched`. Imports: `resolveHandoffTargets` de `handoff-routing.ts`. Esboço da dep no `processBatch`:

```ts
      dispatchHandoff: async (row, payload) => {
        // Lead owners + tier (org-scoped).
        const { data: lead } = await supabase.from("leads")
          .select("responsible_id, closer_id, sdr_id, sale_responsible_id, pre_sale_responsible_id, qualification_tier")
          .eq("organization_id", row.organization_id).eq("id", payload.leadId ?? "__none__").maybeSingle();
        // Active members of the org (PII phone opt-in).
        const { data: members } = await supabase.from("team_members")
          .select("id, user_id, phone, is_active, role")
          .eq("organization_id", row.organization_id).eq("is_active", true);
        const routing = resolveHandoffTargets({ lead: lead ?? {}, members: members ?? [], activeTeam: members ?? [] });
        // Legacy group phones (copilot_v2 has no agent-level config yet → none for now).
        const optInPhones = routing.targets.map((t) => t.phone).filter((p): p is string => !!p);
        const idem = `transfer:${row.organization_id}:${payload.leadId ?? "noLead"}:${row.trace_id}`;
        const { data: status } = await supabase.rpc("copilot_v2_dispatch_handoff", {
          p_org_id: row.organization_id, p_lead_id: payload.leadId, p_trace_id: row.trace_id,
          p_idempotency_key: idem, p_reason: payload.reason, p_summary: payload.summary,
          p_tier: lead?.qualification_tier ?? null,
          p_target_user_ids: routing.targets.map((t) => t.userId),
          p_whatsapp_phones: optInPhones,
          p_title: "Lead precisa de atendimento humano",
          p_link: "/pipe-whatsapp",
        });
        // Only fire WhatsApp on a FRESH dispatch (idempotent — never on already_dispatched).
        if (status === "dispatched" && optInPhones.length) {
          const text = `🤝 Handoff: lead ${payload.leadId ?? ""} (${lead?.qualification_tier ?? "s/ tier"}) — ${payload.reason}. ${payload.summary ?? ""}`.trim();
          for (const phone of optInPhones) {
            try { await sendReply(supabase, row.organization_id, phone, text); } catch (_e) { /* per-phone best-effort */ }
          }
        }
      },
```

> Nota: o WhatsApp ao responsável reusa `sendReply` (mesma instância da org). O envio é best-effort por telefone (uma falha num número não derruba os outros nem a notificação in-app, que já foi gravada idempotentemente). A entrega in-app é a fonte confiável; o WhatsApp é o reforço — ambos no caminho idempotente, sem o worker bugado do v1.

- [ ] Re-rodar + suíte:

```bash
npx vitest run tests/unit/copilot-v2/queue-processor-handoff.test.ts tests/unit/copilot-v2/handoff-routing.test.ts tests/unit/copilot-v2/queue-processor.test.ts
```

- [ ] **Segurança** (núcleo 🔒 deste slice): org_id SEMPRE da `row` (border/instância), nunca do payload do LLM. `members`/`lead` buscados com `.eq("organization_id", row.organization_id)` → fan-out SÓ dentro da org. Telefone do membro (PII) só sai pro WhatsApp se opt-in (phone não-null); `notifications.description` carrega resumo/motivo, não telefone. Idempotência pela chave estável + WhatsApp só no `dispatched` → zero notificação duplicada (mata #26 + #7/#9).

- [ ] Commit:

```bash
git add supabase/functions/_shared/copilot-v2/queue-processor.ts \
        supabase/functions/copilot-v2-worker/index.ts \
        tests/unit/copilot-v2/queue-processor-handoff.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): entrega de handoff in-app + WhatsApp role-aware idempotente

Quando o turno dispara transfer_to_human permitido, o worker resolve o destino
role-aware (Task 5), monta a chave estável transfer:{org}:{lead}:{trace} e chama
copilot_v2_dispatch_handoff (fan-out org-scoped idempotente -> notifications +
WhatsApp pending). WhatsApp só dispara em 'dispatched' (nunca 'already'), aos
telefones opt-in dos membros. Org sempre da row, fan-out dentro da org. Mata
#26 (idempotência) + #7/#9 (entrega confiável).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — In-app realtime no sino (AlertsDropdown) + regressão integração + build

**Problem**: o `AlertsDropdown.tsx` (`src/modules/platform/components/notifications/AlertsDropdown.tsx`) entrega notificações por **polling** (`refetchInterval: 60000`, linha 211) — o brief exige **realtime** (canal + toast + sino), não polling. E precisamos provar a suíte verde + a idempotência/RLS no DB.

**Fix**: assinar `notifications` via `useRealtimeSubscription("notifications", ["user-alerts"])` (de `@/shared/realtime`, org-scoped, debounce 2s) e disparar um `toast` no INSERT de uma `transfer_to_human`. Manter o `refetchInterval` como rede de segurança (reduzir, não remover — fallback se o canal cair). + regressão integração `.skip` (dispatch idempotente + RLS cross-org) + build/typecheck.

### Files

- **Modify** `src/modules/platform/components/notifications/AlertsDropdown.tsx` — realtime subscription + toast.
- **Create** `tests/integration/copilot-v2/handoff-dispatch.test.ts` (`.skip` — roda com service key contra dev, convenção do repo).

### Steps

- [ ] Ler o `AlertsDropdown.tsx` (já tem `useQuery(["user-alerts", organizationId, user?.id])` + lê `notifications` por `user_id`, lines 78-212). Adicionar realtime. Import:

```ts
import { useRealtimeSubscription } from "@/shared/realtime";
import { useToast } from "@/hooks/use-toast";
```

  E dentro do componente (após o `useQuery`):

```ts
  const { toast } = useToast();
  // Realtime: a new handoff notification invalidates the bell query immediately
  // (org-scoped channel, 2s debounce) — replaces minute polling with push.
  useRealtimeSubscription("notifications", ["user-alerts"], {
    onUpdate: (rec, old) => old, // updates (read_at) handled by the mutation
  });
```

  E trocar `refetchInterval: 60000` por um fallback maior (rede de segurança se o canal cair), ex. `refetchInterval: 120000`. (Realtime é o caminho primário; o poll só cobre desconexão.)

> Nota de handoff design: o design define o visual do toast/sino/badge e a config de phone+role+opt-in no wizard (Slice 8 surfacea o `team_members.phone` e o toggle HITL). Esta task entrega o transporte realtime + um toast funcional mínimo; o polimento visual é do design.

- [ ] Escrever a integração `.skip` `tests/integration/copilot-v2/handoff-dispatch.test.ts`:

```ts
/**
 * Slice 5 — handoff dispatch idempotency + RLS (integration, .skip).
 * Runs against dev with a service key (repo convention). Skipped without one.
 */
import { describe, it, expect } from 'vitest';
const ORG = '6030520a-2ca7-477d-be89-55758e2cd808'; // Milennials (dev)
describe.skip('copilot_v2_dispatch_handoff — idempotent', () => {
  it('two dispatches with the same stable key → exactly one row + one notification fan-out', async () => {
    const trace = crypto.randomUUID();
    const key = `transfer:${ORG}:lead-x:${trace}`;
    const args = {
      p_org_id: ORG, p_lead_id: null, p_trace_id: trace, p_idempotency_key: key,
      p_reason: 'teste', p_summary: 'idem', p_tier: 'ouro',
      p_target_user_ids: [], p_whatsapp_phones: [], p_title: 't', p_link: '/pipe-whatsapp',
    };
    const a = await getAdmin().rpc('copilot_v2_dispatch_handoff', args);
    const b = await getAdmin().rpc('copilot_v2_dispatch_handoff', args);
    expect(a.data).toBe('dispatched');
    expect(b.data).toBe('already_dispatched'); // stable key collapses retries
    await getAdmin().from('copilot_v2_handoff_notifications').delete().eq('organization_id', ORG).eq('idempotency_key', key);
  });
});
```

- [ ] Rodar a suíte copilot-v2 inteira + integração (anotar counts literais no QA report — root memory `feedback_qa_raw_output`):

```bash
npx vitest run tests/unit/copilot-v2/
npx vitest run tests/integration/copilot-v2/
```

Esperado: todos os arquivos verdes; anotar a linha literal (`Test Files N passed (N)` / `Tests M passed (M)`).

- [ ] Typecheck + build (CI não tem gate de `tsc` em edge — root memory `project_ci_no_typecheck_gate` — verificar local):

```bash
npm run typecheck
npm run build
```

- [ ] Deno check dos edge tocados (pega import relativo quebrado que o tsc não pega — root memory):

```bash
cd supabase/functions && deno check copilot-v2-worker/index.ts _shared/copilot-v2/border.ts _shared/copilot-v2/queue-processor.ts _shared/copilot-v2/output-judge.ts _shared/copilot-v2/input-short-circuit.ts _shared/copilot-v2/hitl-gate.ts _shared/copilot-v2/handoff-routing.ts
```

- [ ] **Segurança**: realtime de `notifications` é org-scoped pelo `useRealtimeSubscription` (a tabela tem `organization_id`); o usuário só vê suas próprias rows (RLS `notifications_select_own` por `auth.uid()`). Sem inline `SELECT FROM team_members` em policy nova.

- [ ] Commit:

```bash
git add src/modules/platform/components/notifications/AlertsDropdown.tsx \
        tests/integration/copilot-v2/handoff-dispatch.test.ts
git commit -m "$(cat <<'EOF'
feat(copilot-v2): notificação de handoff in-app via realtime (sino) + regressão

AlertsDropdown deixa de pollar (refetchInterval) como caminho primário e assina
notifications via useRealtimeSubscription (org-scoped, debounce 2s) + toast no
handoff; poll vira fallback de desconexão. Integração .skip prova idempotência
do dispatch (chave estável -> dispatched/already_dispatched) contra dev.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] Gate final de verificação (colar counts literais no QA report do slice):

```bash
npx vitest run tests/unit/copilot-v2/ tests/integration/copilot-v2/
npm run typecheck && npm run build
```

Tudo deve passar antes de abrir o PR. **Não fazer deploy de edge functions nem aplicar as migrations da Task 6 em prod** — push da branch só; apply em **dev** via MCP só quando autorizado; PROD exige CTO explícito (root memory `feedback_never_deploy_prod`, `feedback_push_new_branch`).

---

## 🔒 Segurança

- 🔒 **Org sempre do ctx**: `dispatchHandoff`, `checkHitl`, `checkLoop`, `judgeOutput` recebem `row.organization_id` (border/instância). Nenhum gate ou fan-out deriva org do payload/LLM. As queries de `leads`/`team_members` no fan-out filtram `.eq("organization_id", row.organization_id)` → notificação só dentro da org.
- 🔒 **Gates fail-CLOSED**: output-judge (verdict ausente/erro → bloqueia), input short-circuit (fail-OPEN é a postura *correta* aqui — na dúvida deixa cognição normal, nunca silencia lead; documentado), loop-gate (erro → bloqueia), HITL (ON + dúvida de criticidade/tier → exige aprovação), capability/budget (já fail-CLOSED na 1-H/Slice 2). Idempotência do dispatch falha fechado (duplicata → `already_dispatched`, WhatsApp não redispara).
- 🔒 **PII**: `team_members.phone` é opt-in (null → só in-app). O telefone do membro só sai pro WhatsApp quando o membro optou; nunca aparece em `notifications.description` (que carrega motivo/resumo). Trace steps logam só categoria/reason, nunca conteúdo raw (preserva o invariante da fundação).
- 🔒 **Storage/RLS/RPC org-scope**: `copilot_v2_handoff_notifications`, `copilot_v2_org_settings`, `copilot_v2_hitl_approvals` — todas com `organization_id` + RLS deny-all + SELECT org-scoped via `get_my_organization_ids()` (nunca inline `SELECT FROM team_members` — gotcha recursão Realtime). Writes só via RPC `SECURITY DEFINER set search_path = public` + `revoke all from public/anon/authenticated` + `grant execute to service_role`. `notifications` insere `user_id` resolvido server-side. Migrations exigem `tests/integration/rls-copilot_v2_handoff.test.ts` (regra `migrations/CLAUDE.md`).

## ⚠️ Decisões abertas

Decisões de produto que o plano **não** resolve (sinalizadas, não inventadas) — estruturadas como parâmetros pra o CTO fixar:

1. **Quais ações são "críticas" pro HITL + threshold de "alto valor"** (Task 4). Default proposto e ajustável: críticas = `{schedule_meeting, send_media, transfer_to_human, handoff_to_vendedor, move_lead_stage}` (`CRITICAL_TOOLS`); alto valor = tier ∈ `{diamante, ouro}` (`HIGH_VALUE_TIERS`). Ambos exportados como constantes — trocar a regra é mexer no conjunto, não na lógica do gate. **Não inventei a regra de negócio** — o slot está explícito.
2. **Taxa de amostragem do output-judge** (Task 1). Decisão técnica, não de produto: default conservador `judge_sample_rate = 1.0` (julga todo turno), persistido em `copilot_v2_org_settings`, ajustável por org. Proposto, marcado como ajustável.
3. **Lista de categorias proibidas + frases de short-circuit** (Tasks 1/2): a baseline (`forbidden_promise`/`unauthorized_price`/`leaked_credential`/`off_policy_tone`; regex de abuso/concorrente) é segura como ponto de partida, mas a **política comercial real por org** (o que é "promessa proibida" pra cada cliente B2B) virá do config do Slice 8 — esta slice lê `commercialPolicy` do config quando existir. Sinalizado: o conteúdo da política é decisão de produto por org, não fixada aqui.
4. **Cap da biblioteca send-media com áudio** (≤5/tipo vs ≤N total) — **NÃO é deste slice** (é Slice 6, registrado no [[_MOC]]); listado aqui só pra não se perder na matriz de decisões abertas da feature.
