/**
 * send-governor/core — PURE decision logic for the Send Governor (anti-ban).
 *
 * Zero IO, clock-free (the evaluation instant is state.nowIso). Mirrors the
 * quick-blast/quiet-hours.ts pattern: all the security-critical branching lives
 * here so it is exhaustively unit-testable without a live DB or provider.
 *
 * Precedence (first match wins):
 *   0. mode 'off'                       → allow  (governor_off)
 *   1. category 'manual'                → allow  (manual_exempt)  [any mode]
 *   2. category 'system'               → allow  (allowed)        [exempt PR-0]
 *   3. P3 quarantine (automation|mass)  → block  (quarantined)
 *   4. P5 janela 24h (automation|mass)  → block  (outside_24h_window)
 *   5. category 'mass'                  → allow  (allowed)  [caps: blast_*]
 *   6. P1/P2 per-number cap (automation)→ defer  (per_number_cap)
 *   7. P4 cold gate (automation)        → block  (cold_contact)
 *   8. otherwise                        → allow  (allowed)
 *
 * SHADOW OVERRIDE: when mode === 'shadow', the EFFECTIVE action is ALWAYS
 * 'allow'; the would-be block/defer is preserved in `wouldBe` (+ shadowed=true).
 * Shadow can NEVER emit a real block/defer — that invariant is tested directly.
 */

import type {
  GovernorContext,
  GovernorDecision,
  GovernorDecisionReason,
  GovernorMode,
  GovernorState,
  SendCategory,
} from "./types.ts";

/** Torque-recommended safe per-number ceiling (matches instance-budget.ts). */
export const GOVERNOR_DEFAULT_CAP = 80;

/**
 * Warm-up ramp: the per-number automation cap while a number is warming up,
 * derived from its age in days. Converges to the number's own base cap.
 *
 *   age 0        → 20
 *   age 1–2      → 30
 *   age 3–6      → 50
 *   age 7+       → baseCap (fully warmed)
 *
 * The ramp is always clamped to baseCap (never widens a tighter configured
 * cap). Unknown age (null/NaN) → baseCap: warm-up must never TIGHTEN on missing
 * data (fail-open — the governor is not a single point of failure).
 */
export function warmupCapForAge(
  ageDays: number | null | undefined,
  baseCap: number,
): number {
  if (ageDays === null || ageDays === undefined || !Number.isFinite(ageDays)) {
    return baseCap;
  }
  let ramp: number;
  if (ageDays <= 0) ramp = 20;
  else if (ageDays <= 2) ramp = 30;
  else if (ageDays <= 6) ramp = 50;
  else return baseCap; // 7+ days → fully warmed, use the configured cap
  return Math.min(ramp, baseCap);
}

// ─── P5 — janela de 24h (customer service window) ────────────────────────────
//
// A Meta recusa TEXTO LIVRE fora da janela de 24h aberta pela última mensagem do
// contato; só template aprovado reabre. Isso vale para qualquer canal OFICIAL —
// hoje, no nosso parque, o do NotificaMe (BSP).
//
// POR QUE A REGRA EXISTE, SE A META JÁ RECUSA: ela não impede a infração — a Meta
// é o enforcer final e nada aqui muda isso. Ela troca uma FALHA SILENCIOSA (o
// copiloto "respondeu", o fornecedor devolveu erro, o lead nunca recebeu, e
// ninguém soube) por um RESULTADO BOM: o envio não sai, o motivo fica em
// `runtime_logs` com `reason='outside_24h_window'`, e quem opera descobre no
// mesmo dia — não pela reclamação do cliente.
//
// POR QUE `block` E NÃO `defer`: `defer` promete "tenta de novo mais tarde", e
// mais tarde NÃO resolve — a janela não reabre com o tempo, reabre com uma
// mensagem do contato (ou com um template). Um `defer` aqui viraria fila de
// retry que só envelhece e volta a bater na mesma parede.
//
// ONDE ENTRA NA PRECEDÊNCIA: DEPOIS da quarentena (P3 é o sinal mais forte) e
// ANTES do atalho de `mass`. A ordem não é estética: `mass` retorna `allow` na
// regra 5, então uma P5 colocada abaixo dela NUNCA veria disparo em massa — que
// é justamente o caminho que produz recusa em lote num canal oficial.
//
// RELAÇÃO COM `meta-cloud-window.ts`: mesma pergunta ("última incoming < 24h?"),
// dois consumidores com contratos OPOSTOS na incerteza. Lá é o caminho de envio
// da Meta, certificado, e ele falha FECHADO (na dúvida, coage para template).
// Aqui é o choke de TODA a automação, e a diretriz é fail-OPEN: erro de leitura
// → deixa passar (a Meta recusa, e voltamos ao status quo), porque um governor
// que bloqueia a frota por soluço de banco é pior do que o problema que resolve.
// A distinção erro-vs-ausência mora em `state.windowResolved`, e é por isso que
// esta regra NÃO reusa `isSessionOpen` (que colapsa os dois em `open:false`).

/** Duração da janela de sessão. 24h é contrato da Meta, não parâmetro nosso. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Providers cujo envio de texto livre É governado pela janela de 24h.
 *
 * ALLOWLIST, e não denylist de 'uazapi': o parque tem 4 providers e vai ganhar
 * outros. Denylist faria o PRÓXIMO provider oficial nascer SEM janela e sem
 * ninguém perceber; allowlist faz ele nascer sem a regra e com o sintoma óbvio.
 *
 * 'meta_cloud' está FORA de propósito — não porque não tenha janela (tem, e é a
 * mesma), mas porque o caminho de envio dele JÁ a aplica em
 * `whatsapp-providers/meta-cloud-window.ts`, com coerção para template. Incluí-lo
 * aqui criaria DUPLA GOVERNANÇA sobre o mesmo envio, com dois contratos
 * diferentes na incerteza. Se um dia a coerção sair de lá, entra aqui.
 */
export const SESSION_WINDOW_PROVIDERS: ReadonlySet<string> = new Set([
  "notificame",
]);

/** O provider deste número tem janela de sessão governada AQUI? */
export function providerHasSessionWindow(
  provider: string | null | undefined,
): boolean {
  return typeof provider === "string" &&
    SESSION_WINDOW_PROVIDERS.has(provider);
}

/**
 * A P5 se aplica a este envio? Predicado ÚNICO, exportado, porque duas camadas
 * precisam da mesma resposta: o core (para decidir) e o io (para decidir se
 * PAGA a leitura da janela). Duas cópias divergiriam, e a divergência seria
 * silenciosa — o io deixaria de ler e o core leria `windowResolved:false` como
 * "desconhecido", desligando a regra sem que nada ficasse vermelho.
 *
 * `manual` e `system` nunca chegam aqui (a precedência os libera antes), mas o
 * predicado os recusa explicitamente: ele também é chamado do io, onde a
 * precedência não existe. Humano no chat NUNCA é barrado por esta regra.
 */
export function sessionWindowApplies(
  provider: string | null | undefined,
  category: SendCategory,
): boolean {
  if (category !== "automation" && category !== "mass") return false;
  return providerHasSessionWindow(provider);
}

/**
 * A janela está ABERTA? Aberta ⇔ existe uma `incoming` daquele contato naquele
 * canal há MENOS de 24h.
 *
 * Sem inbound (`null`) → FECHADA. Isso é fato, não erro: o contato nunca falou
 * com este número. Timestamp impossível de parsear → FECHADA (o dado existe e
 * está corrompido; abrir a janela na base de lixo seria inventar consentimento).
 * O caminho de fail-open para ERRO de leitura NÃO é aqui — é `windowResolved`,
 * avaliado por quem chama.
 */
export function isSessionWindowOpen(
  lastInboundIso: string | null | undefined,
  nowIso: string,
): boolean {
  if (!lastInboundIso) return false;
  const last = Date.parse(lastInboundIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(last) || Number.isNaN(now)) return false;
  return now - last < SESSION_WINDOW_MS;
}

/**
 * Best-effort classification of a send from its provider trackSource. The
 * wiring layer usually passes an EXPLICIT category at each seam; this is the
 * fallback when only a trackSource string is known.
 *
 * Default (no trackSource) → 'automation': every path that flows through
 * whatsapp-dispatch primitives is automation (the manual human composer bypasses
 * that layer entirely — whatsapp-api-proxy calls provider.sendText directly —
 * so a primitive never carries human traffic).
 */
export function deriveCategory(trackSource?: string | null): SendCategory {
  if (!trackSource) return "automation";
  const s = trackSource.toLowerCase();
  if (
    s === "manual" || s === "composer" || s === "human" || s === "chat" ||
    s === "inbox"
  ) {
    return "manual";
  }
  if (
    s === "mass" || s === "blast" || s === "mass_send" || s === "quick_blast" ||
    s === "sender" || s.startsWith("sender") || s.includes("blast")
  ) {
    return "mass";
  }
  if (s === "system" || s === "cron" || s === "internal") return "system";
  // copilot, copilot_v2, followup, workflow, campaign, pipe, outbound, … .
  return "automation";
}

/** Quarantine is ACTIVE only while quarantined AND now < quarantine_until
 *  (or indefinitely when quarantine_until is null). An expired quarantine
 *  recovers implicitly at read time — no block. */
function quarantineActive(state: GovernorState): boolean {
  if (state.reputation !== "quarantined") return false;
  if (!state.quarantineUntil) return true; // indefinite
  const now = Date.parse(state.nowIso);
  const until = Date.parse(state.quarantineUntil);
  if (Number.isNaN(now) || Number.isNaN(until)) return true; // fail-safe: block
  return now < until;
}

/** Approximate "retry tomorrow": next day at 12:00Z (~09:00 BRT, safely inside
 *  a normal send window). Pure/deterministic — exact window scheduling is the
 *  quiet-hours module's job when wiring adds deferral. */
function nextDayIso(nowIso: string): string {
  const d = new Date(nowIso);
  if (Number.isNaN(d.getTime())) return nowIso;
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12, 0, 0),
  );
  return next.toISOString();
}

/**
 * Apply the SHADOW override and build the final decision. In shadow, a would-be
 * block/defer is flipped to an effective allow (shadowed=true) while `wouldBe`
 * records the real verdict. In off/enforce, action === wouldBe.
 */
function finalize(
  mode: GovernorMode,
  wouldBe: GovernorDecision["action"],
  reason: GovernorDecisionReason,
  ctx: GovernorContext,
  retryAt?: string,
): GovernorDecision {
  const shadowFlipped = mode === "shadow" && wouldBe !== "allow";
  return {
    action: shadowFlipped ? "allow" : wouldBe,
    wouldBe,
    reason,
    category: ctx.category,
    mode,
    retryAt,
    shadowed: shadowFlipped,
  };
}

/**
 * The pure verdict. Reads ctx (caller facts) + state (DB-resolved, fail-open)
 * and returns the decision. Never throws for well-formed inputs; never does IO.
 */
export function evaluateSend(
  ctx: GovernorContext,
  state: GovernorState,
): GovernorDecision {
  const decide = (
    wouldBe: GovernorDecision["action"],
    reason: GovernorDecisionReason,
    retryAt?: string,
  ) => finalize(state.mode, wouldBe, reason, ctx, retryAt);

  // 0. Governor inert.
  if (state.mode === "off") return decide("allow", "governor_off");

  // 1. Manual is always exempt, in every mode.
  if (ctx.category === "manual") return decide("allow", "manual_exempt");

  // 2. System messages are exempt in PR-0.
  if (ctx.category === "system") return decide("allow", "allowed");

  // — automation | mass from here —

  // 3. P3 disjuntor: a quarantined number blocks automation AND mass.
  if (quarantineActive(state)) return decide("block", "quarantined");

  // 4. P5 janela de 24h — só para provider oficial (allowlist), automation E
  //    mass. ANTES do atalho de `mass` da regra 5: se ficasse depois, disparo em
  //    massa por canal oficial passaria batido, que é o caso mais caro.
  //
  //    `windowResolved:false` = DESCONHECIDO (erro de leitura, sem telefone, sem
  //    instância) → NÃO bloqueia. Fail-open é a diretriz do governor inteira, e
  //    aqui ela tem custo baixo: a Meta recusa o envio de qualquer jeito, então
  //    o pior caso do fail-open é o comportamento que já existe hoje.
  if (sessionWindowApplies(state.instanceProvider, ctx.category)) {
    if (
      state.windowResolved &&
      !isSessionWindowOpen(state.lastInboundIso, state.nowIso)
    ) {
      return decide("block", "outside_24h_window");
    }
  }

  // 5. Mass: only the quarantine gate applies here. Volume caps for mass are
  //    enforced by the existing blast_* ledgers — do NOT re-implement them.
  if (ctx.category === "mass") return decide("allow", "allowed");

  // — automation only —

  // 6. P1/P2: per-number daily cap, tightened by the warm-up ramp when enabled.
  const warmupCap = state.warmupEnabled
    ? warmupCapForAge(state.instanceAgeDays, state.instanceCap)
    : state.instanceCap;
  const effectiveCap = Math.min(state.instanceCap, warmupCap);
  if (state.usedToday >= effectiveCap) {
    return decide("defer", "per_number_cap", nextDayIso(state.nowIso));
  }

  // 7. P4: cold-contact gate (only when the org enabled it). Num canal oficial a
  //    P5 já cobre o caso "nunca respondeu" (janela fechada), com motivo mais
  //    preciso; a P4 segue existindo para os providers SEM janela.
  if (state.coldGateEnabled && ctx.category === "automation" && state.isColdContact) {
    return decide("block", "cold_contact");
  }

  // 8. Nothing tripped.
  return decide("allow", "allowed");
}
