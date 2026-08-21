// @vitest-environment node
/**
 * Send Governor — pure decision core (anti-ban). Mirrors quiet-hours.test.ts:
 * the _shared module is imported directly and exercised with zero IO.
 *
 * Covers P1 per-number cap, P2 warm-up ramp, P3 quarantine state machine, P4
 * cold-contact gate, manual/system exemption, mode 'off', deriveCategory, and
 * the CRUCIAL shadow invariant: shadow NEVER emits a real block/defer.
 */

import { describe, it, expect } from "vitest";

const { evaluateSend, warmupCapForAge, deriveCategory, GOVERNOR_DEFAULT_CAP } =
  await import("../../supabase/functions/_shared/send-governor/core.ts");

type Ctx = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorContext;
type State = import("../../supabase/functions/_shared/send-governor/types.ts").GovernorState;

const NOW = "2026-07-21T12:00:00.000Z";

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    orgId: "org-1",
    instanceId: "inst-1",
    category: "automation",
    recipientPhone: "5511999999999",
    ...overrides,
  };
}

function state(overrides: Partial<State> = {}): State {
  return {
    mode: "enforce",
    warmupEnabled: false,
    coldGateEnabled: false,
    usedToday: 0,
    instanceCap: 80,
    instanceAgeDays: 30,
    reputation: "healthy",
    quarantineUntil: null,
    isColdContact: false,
    nowIso: NOW,
    // ── P5 (janela de 24h) ────────────────────────────────────────────────
    // Estes quatro campos passaram a ser OBRIGATÓRIOS em `GovernorState` e este
    // helper não os tinha. Nada ficou vermelho porque `tests/` não é
    // type-checked (o `include` do tsconfig é `src`), então o objeto incompleto
    // atravessava: `state.instanceProvider` chegava `undefined`,
    // `sessionWindowApplies` devolvia false, e a P5 NUNCA era avaliada em teste
    // nenhum. O arquivo ficava verde POR AUSÊNCIA — a regra mais nova era a
    // única sem cobertura, e era exatamente por isso.
    //
    // O default é 'uazapi' de propósito: é o provider dominante do parque, ele
    // NÃO tem janela de sessão, e assim todo caso pré-existente (P1/P2/P3/P4)
    // segue medindo o que media. Quem quer P5 declara `instanceProvider`.
    instanceProvider: "uazapi",
    lastInboundIso: null,
    windowResolved: false,
    windowSource: null,
    ...overrides,
  };
}

describe("warmupCapForAge — P2 ramp table", () => {
  it("follows the ramp with the default base cap (80)", () => {
    expect(warmupCapForAge(0, 80)).toBe(20);
    expect(warmupCapForAge(1, 80)).toBe(30);
    expect(warmupCapForAge(2, 80)).toBe(30);
    expect(warmupCapForAge(3, 80)).toBe(50);
    expect(warmupCapForAge(6, 80)).toBe(50);
    expect(warmupCapForAge(7, 80)).toBe(80);
    expect(warmupCapForAge(30, 80)).toBe(80);
  });

  it("never widens a tighter configured base cap", () => {
    expect(warmupCapForAge(0, 50)).toBe(20);
    expect(warmupCapForAge(3, 50)).toBe(50);
    expect(warmupCapForAge(6, 40)).toBe(40); // ramp 50 clamped to base 40
    expect(warmupCapForAge(7, 50)).toBe(50); // fully warmed → base cap
  });

  it("degrades to the base cap on unknown age (fail-open, never tightens)", () => {
    expect(warmupCapForAge(null, 80)).toBe(80);
    expect(warmupCapForAge(undefined, 80)).toBe(80);
    expect(warmupCapForAge(Number.NaN, 80)).toBe(80);
  });

  it("exposes the recommended default cap", () => {
    expect(GOVERNOR_DEFAULT_CAP).toBe(80);
  });
});

describe("deriveCategory", () => {
  it("defaults to automation (dispatch primitives never carry manual traffic)", () => {
    expect(deriveCategory(undefined)).toBe("automation");
    expect(deriveCategory(null)).toBe("automation");
    expect(deriveCategory("")).toBe("automation");
  });
  it("maps copilot sources to automation", () => {
    expect(deriveCategory("copilot")).toBe("automation");
    expect(deriveCategory("copilot_v2")).toBe("automation");
    expect(deriveCategory("followup")).toBe("automation");
  });
  it("maps blast/sender sources to mass", () => {
    expect(deriveCategory("mass")).toBe("mass");
    expect(deriveCategory("blast")).toBe("mass");
    expect(deriveCategory("sender")).toBe("mass");
    expect(deriveCategory("sender_advanced")).toBe("mass");
  });
  it("maps human + system sources", () => {
    expect(deriveCategory("manual")).toBe("manual");
    expect(deriveCategory("composer")).toBe("manual");
    expect(deriveCategory("system")).toBe("system");
    expect(deriveCategory("cron")).toBe("system");
  });
});

describe("mode 'off' — governor inert", () => {
  it("allows everything, even a quarantined over-cap send", () => {
    const d = evaluateSend(
      ctx(),
      state({ mode: "off", reputation: "quarantined", usedToday: 999 }),
    );
    expect(d.action).toBe("allow");
    expect(d.wouldBe).toBe("allow");
    expect(d.reason).toBe("governor_off");
    expect(d.shadowed).toBe(false);
  });
});

describe("manual exemption — always allowed", () => {
  for (const mode of ["off", "shadow", "enforce"] as const) {
    it(`allows a manual send in mode '${mode}' even quarantined + over cap`, () => {
      const d = evaluateSend(
        ctx({ category: "manual" }),
        state({ mode, reputation: "quarantined", usedToday: 999 }),
      );
      expect(d.action).toBe("allow");
      expect(d.reason).toBe(mode === "off" ? "governor_off" : "manual_exempt");
    });
  }
});

describe("system exemption (PR-0)", () => {
  it("allows system sends under enforce", () => {
    const d = evaluateSend(ctx({ category: "system" }), state({ usedToday: 999 }));
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });
});

describe("P3 quarantine state machine", () => {
  it("healthy → allow", () => {
    const d = evaluateSend(ctx(), state({ reputation: "healthy" }));
    expect(d.action).toBe("allow");
  });

  it("quarantined + unexpired → block (automation)", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    expect(d.action).toBe("block");
    expect(d.wouldBe).toBe("block");
    expect(d.reason).toBe("quarantined");
  });

  it("quarantined + unexpired → block (mass too)", () => {
    const d = evaluateSend(
      ctx({ category: "mass" }),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("quarantined");
  });

  it("quarantined + EXPIRED → recovers (allow)", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: "2026-07-21T10:00:00.000Z" }),
    );
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });

  it("quarantined indefinitely (null until) → block", () => {
    const d = evaluateSend(
      ctx(),
      state({ reputation: "quarantined", quarantineUntil: null }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("quarantined");
  });
});

describe("P1 per-number cap + P2 warm-up", () => {
  it("allows under the cap", () => {
    const d = evaluateSend(ctx(), state({ usedToday: 79, instanceCap: 80 }));
    expect(d.action).toBe("allow");
  });

  it("defers at the cap", () => {
    const d = evaluateSend(ctx(), state({ usedToday: 80, instanceCap: 80 }));
    expect(d.action).toBe("defer");
    expect(d.reason).toBe("per_number_cap");
    expect(d.retryAt).toBeTruthy();
    expect(Date.parse(d.retryAt as string)).toBeGreaterThan(Date.parse(NOW));
  });

  it("warm-up tightens the cap on a young number", () => {
    // age 0 → warm-up cap 20; 20 used → defer even though base cap is 80.
    const d = evaluateSend(
      ctx(),
      state({ warmupEnabled: true, instanceAgeDays: 0, usedToday: 20, instanceCap: 80 }),
    );
    expect(d.action).toBe("defer");
    expect(d.reason).toBe("per_number_cap");
  });

  it("warm-up disabled uses the full base cap", () => {
    const d = evaluateSend(
      ctx(),
      state({ warmupEnabled: false, instanceAgeDays: 0, usedToday: 20, instanceCap: 80 }),
    );
    expect(d.action).toBe("allow");
  });

  it("mass ignores the per-number cap (only P3 applies to mass)", () => {
    const d = evaluateSend(ctx({ category: "mass" }), state({ usedToday: 999 }));
    expect(d.action).toBe("allow");
  });
});

describe("P4 cold-contact gate", () => {
  it("blocks a cold contact when the gate is enabled", () => {
    const d = evaluateSend(
      ctx(),
      state({ coldGateEnabled: true, isColdContact: true }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("cold_contact");
  });

  it("allows a cold contact when the gate is disabled", () => {
    const d = evaluateSend(
      ctx(),
      state({ coldGateEnabled: false, isColdContact: true }),
    );
    expect(d.action).toBe("allow");
  });

  it("does not gate mass on coldness (mass = P3 only)", () => {
    const d = evaluateSend(
      ctx({ category: "mass" }),
      state({ coldGateEnabled: true, isColdContact: true }),
    );
    expect(d.action).toBe("allow");
  });
});

describe("SHADOW invariant — never a real block/defer", () => {
  const scenarios: Array<{ name: string; s: Partial<State>; c?: Partial<Ctx>; wouldBe: string; reason: string }> = [
    {
      name: "quarantine",
      s: { reputation: "quarantined", quarantineUntil: "2026-07-21T14:00:00.000Z" },
      wouldBe: "block",
      reason: "quarantined",
    },
    { name: "per-number cap", s: { usedToday: 80, instanceCap: 80 }, wouldBe: "defer", reason: "per_number_cap" },
    { name: "cold contact", s: { coldGateEnabled: true, isColdContact: true }, wouldBe: "block", reason: "cold_contact" },
  ];

  for (const sc of scenarios) {
    it(`shadow flips would-be ${sc.wouldBe} (${sc.name}) to allow, preserving wouldBe`, () => {
      const d = evaluateSend(ctx(sc.c), state({ mode: "shadow", ...sc.s }));
      expect(d.action).toBe("allow"); // NEVER blocks in shadow
      expect(d.wouldBe).toBe(sc.wouldBe);
      expect(d.reason).toBe(sc.reason);
      expect(d.shadowed).toBe(true);
    });

    it(`enforce actually applies ${sc.wouldBe} (${sc.name})`, () => {
      const d = evaluateSend(ctx(sc.c), state({ mode: "enforce", ...sc.s }));
      expect(d.action).toBe(sc.wouldBe);
      expect(d.shadowed).toBe(false);
    });
  }

  it("shadow allow stays a plain allow (nothing flipped)", () => {
    const d = evaluateSend(ctx(), state({ mode: "shadow" }));
    expect(d.action).toBe("allow");
    expect(d.wouldBe).toBe("allow");
    expect(d.shadowed).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// P5 — janela de 24h (canal oficial)
// ═════════════════════════════════════════════════════════════════════════════
//
// A regra nasceu nesta rodada junto com o provider do NotificaMe e chegou aqui
// SEM UM ÚNICO CASO. Ela é a única do core que depende de um fato EXTERNO ao
// número (a última incoming daquele contato), e é a única com contrato de
// incerteza próprio — por isso o que segue insiste em três eixos que as outras
// regras não têm: allowlist de provider, precedência contra `mass`, e a
// distinção erro-vs-ausência.

const { isSessionWindowOpen, sessionWindowApplies, providerHasSessionWindow, SESSION_WINDOW_MS } =
  await import("../../supabase/functions/_shared/send-governor/core.ts");

describe("isSessionWindowOpen — o predicado puro", () => {
  it("aberta enquanto a última incoming tem MENOS de 24h", () => {
    const last = new Date(Date.parse(NOW) - 23 * 60 * 60 * 1000).toISOString();
    expect(isSessionWindowOpen(last, NOW)).toBe(true);
  });

  it("fechada assim que completa 24h — a borda é fechada, não aberta", () => {
    // Exatamente 24h NÃO é "menos de 24h". A fronteira é onde a Meta recusa, e
    // um `<=` aqui mandaria o envio no exato instante em que ele passa a ser
    // recusado — o pior lugar possível para um off-by-one.
    const exact = new Date(Date.parse(NOW) - SESSION_WINDOW_MS).toISOString();
    expect(isSessionWindowOpen(exact, NOW)).toBe(false);

    const justInside = new Date(Date.parse(NOW) - SESSION_WINDOW_MS + 1000).toISOString();
    expect(isSessionWindowOpen(justInside, NOW)).toBe(true);
  });

  it("sem inbound nenhum → FECHADA (é fato, não erro: o contato nunca falou)", () => {
    expect(isSessionWindowOpen(null, NOW)).toBe(false);
    expect(isSessionWindowOpen(undefined, NOW)).toBe(false);
  });

  it("timestamp corrompido → FECHADA (não se inventa consentimento sobre lixo)", () => {
    expect(isSessionWindowOpen("nao-e-uma-data", NOW)).toBe(false);
  });
});

describe("sessionWindowApplies — allowlist de provider e de categoria", () => {
  it("só provider oficial da allowlist tem janela governada aqui", () => {
    expect(providerHasSessionWindow("notificame")).toBe(true);
    expect(providerHasSessionWindow("uazapi")).toBe(false);
    expect(providerHasSessionWindow("evolution")).toBe(false);
    // meta_cloud está FORA de propósito: o caminho de envio dele já aplica a
    // janela com coerção para template. Incluí-lo criaria dupla governança.
    expect(providerHasSessionWindow("meta_cloud")).toBe(false);
    // Allowlist, não denylist: o provider que ninguém declarou nasce SEM a
    // regra e com sintoma óbvio, em vez de nascer sem ela e em silêncio.
    expect(providerHasSessionWindow("provider_futuro")).toBe(false);
    expect(providerHasSessionWindow(null)).toBe(false);
  });

  it("humano NUNCA é barrado pela janela — nem manual, nem system", () => {
    expect(sessionWindowApplies("notificame", "manual")).toBe(false);
    expect(sessionWindowApplies("notificame", "system")).toBe(false);
    expect(sessionWindowApplies("notificame", "automation")).toBe(true);
    expect(sessionWindowApplies("notificame", "mass")).toBe(true);
  });
});

describe("evaluateSend — P5 no núcleo", () => {
  const OFICIAL = { instanceProvider: "notificame", windowResolved: true } as const;

  it("bloqueia automação de canal oficial com a janela fechada", () => {
    const d = evaluateSend(ctx(), state({ ...OFICIAL, lastInboundIso: null }));
    expect(d.action).toBe("block");
    expect(d.reason).toBe("outside_24h_window");
  });

  it("deixa passar quando a janela está ABERTA", () => {
    const last = new Date(Date.parse(NOW) - 60 * 60 * 1000).toISOString();
    const d = evaluateSend(ctx(), state({ ...OFICIAL, lastInboundIso: last }));
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });

  it("NÃO bloqueia provider sem janela, mesmo sem inbound nenhum", () => {
    // CONTROLE NEGATIVO da allowlist: o mesmo estado que bloqueia no oficial
    // tem que passar batido na Uazapi. Sem este caso, uma P5 que ignorasse o
    // provider bloquearia a frota inteira e o teste acima seguiria verde.
    const d = evaluateSend(
      ctx(),
      state({ instanceProvider: "uazapi", windowResolved: true, lastInboundIso: null }),
    );
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });

  it("windowResolved:false é DESCONHECIDO e faz fail-OPEN — não bloqueia", () => {
    // A diferença entre "não sei" e "sei que está fechada" é a razão de
    // `windowResolved` existir. Colapsar os dois em `open:false` transformaria
    // um soluço de banco em bloqueio da frota.
    const d = evaluateSend(
      ctx(),
      state({ instanceProvider: "notificame", windowResolved: false, lastInboundIso: null }),
    );
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("allowed");
  });

  it("mass em canal oficial TAMBÉM é barrado — a P5 vem ANTES do atalho de mass", () => {
    // O caso mais caro e o que a ordem de precedência protege: `mass` retorna
    // allow na regra 5, então uma P5 colocada abaixo dela nunca veria disparo em
    // massa — justamente o caminho que produz recusa EM LOTE num canal oficial.
    const d = evaluateSend(ctx({ category: "mass" }), state({ ...OFICIAL, lastInboundIso: null }));
    expect(d.action).toBe("block");
    expect(d.reason).toBe("outside_24h_window");
  });

  it("manual em canal oficial com janela fechada PASSA — humano no chat é isento", () => {
    const d = evaluateSend(ctx({ category: "manual" }), state({ ...OFICIAL, lastInboundIso: null }));
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("manual_exempt");
  });

  it("quarentena (P3) vence a janela — o sinal mais forte nomeia o motivo", () => {
    const d = evaluateSend(
      ctx(),
      state({ ...OFICIAL, lastInboundIso: null, reputation: "quarantined", quarantineUntil: null }),
    );
    expect(d.action).toBe("block");
    expect(d.reason).toBe("quarantined");
  });

  it("mode 'off' desliga a P5 como desliga todo o resto", () => {
    const d = evaluateSend(ctx(), state({ ...OFICIAL, lastInboundIso: null, mode: "off" }));
    expect(d.action).toBe("allow");
    expect(d.reason).toBe("governor_off");
  });

  it("shadow NUNCA bloqueia de verdade, mas registra o wouldBe da janela", () => {
    const d = evaluateSend(ctx(), state({ ...OFICIAL, lastInboundIso: null, mode: "shadow" }));
    expect(d.action).toBe("allow");
    expect(d.wouldBe).toBe("block");
    expect(d.reason).toBe("outside_24h_window");
    expect(d.shadowed).toBe(true);
  });
});
