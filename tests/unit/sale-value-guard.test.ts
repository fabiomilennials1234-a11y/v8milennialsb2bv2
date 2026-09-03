import { describe, it, expect } from "vitest";
import {
  parseSaleValue,
  hasUsableSaleValue,
  isWonStageKey,
  shouldPromptForSaleValue,
  stageRequiresSaleValue,
  type WonStageResolvable,
} from "@/modules/pipelines/lib/sale-value-guard";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Governed board: default 'vendido' carries stage_role='won' (#990).
const governed: WonStageResolvable[] = [
  { stage_key: "proposta_enviada", stage_role: "open", is_final_positive: false },
  { stage_key: "vendido", stage_role: "won", is_final_positive: true },
  { stage_key: "perdido", stage_role: "lost", is_final_positive: false },
];

// Renamed/custom won stage — R2: must resolve via role, not the string.
const renamedWon: WonStageResolvable[] = [
  { stage_key: "fechado_ganho", stage_role: "won", is_final_positive: true },
  { stage_key: "negociando", stage_role: "open", is_final_positive: false },
];

// Pre-governance: default vendido not yet classified (role 'open') but flagged.
const ungoverned: WonStageResolvable[] = [
  { stage_key: "vendido", stage_role: "open", is_final_positive: true },
];

describe("parseSaleValue", () => {
  it("returns null for empty / missing", () => {
    expect(parseSaleValue(null)).toBeNull();
    expect(parseSaleValue(undefined)).toBeNull();
    expect(parseSaleValue("")).toBeNull();
  });
  it("returns null for zero / negative", () => {
    expect(parseSaleValue(0)).toBeNull();
    expect(parseSaleValue(-10)).toBeNull();
    expect(parseSaleValue("0")).toBeNull();
  });
  it("parses positive numbers and numeric strings", () => {
    expect(parseSaleValue(2000)).toBe(2000);
    expect(parseSaleValue("1500.5")).toBe(1500.5);
  });
});

describe("hasUsableSaleValue", () => {
  it("mirrors parseSaleValue positivity", () => {
    expect(hasUsableSaleValue(2500)).toBe(true);
    expect(hasUsableSaleValue(null)).toBe(false);
    expect(hasUsableSaleValue(0)).toBe(false);
  });
});

describe("isWonStageKey", () => {
  it("resolves the governed won role", () => {
    expect(isWonStageKey("vendido", governed)).toBe(true);
    expect(isWonStageKey("proposta_enviada", governed)).toBe(false);
    expect(isWonStageKey("perdido", governed)).toBe(false);
  });
  it("resolves a renamed won stage by role, not by string (R2)", () => {
    expect(isWonStageKey("fechado_ganho", renamedWon)).toBe(true);
    expect(isWonStageKey("negociando", renamedWon)).toBe(false);
    // The literal 'vendido' is NOT won on a board that renamed it.
    expect(isWonStageKey("vendido", renamedWon)).toBe(false);
  });
  // ── B2d: os dois atalhos legados morreram, e é isto que se afirma agora ──
  //
  // Eram pontes enquanto a governança por `stage_role` não cobria todo mundo.
  // Depois do B2d elas MENTEM: as 375 etapas de desfecho perdem o papel mas
  // seguem com `is_final_positive` (126 delas) e seguem se chamando `vendido`.
  // Com as pontes de pé, a tela pediria o valor da venda numa coluna que o
  // banco não registra mais como venda.
  it("etapa não-governada com is_final_positive NÃO é mais etapa de ganho", () => {
    expect(isWonStageKey("vendido", ungoverned)).toBe(false);
  });
  it("sem configuração carregada, NÃO adivinha pela chave legada", () => {
    expect(isWonStageKey("vendido", [])).toBe(false);
    expect(isWonStageKey("vendido", undefined)).toBe(false);
    expect(isWonStageKey("proposta_enviada", [])).toBe(false);
  });
});

describe("shouldPromptForSaleValue", () => {
  it("prompts on a won move without a usable value", () => {
    expect(shouldPromptForSaleValue("vendido", null, governed)).toBe(true);
    expect(shouldPromptForSaleValue("vendido", 0, governed)).toBe(true);
    expect(shouldPromptForSaleValue("fechado_ganho", undefined, renamedWon)).toBe(true);
  });
  it("does NOT prompt when the won move already carries a value", () => {
    expect(shouldPromptForSaleValue("vendido", 5000, governed)).toBe(false);
    expect(shouldPromptForSaleValue("vendido", "1200", governed)).toBe(false);
  });
  it("never prompts on non-won moves", () => {
    expect(shouldPromptForSaleValue("proposta_enviada", null, governed)).toBe(false);
    expect(shouldPromptForSaleValue("perdido", null, governed)).toBe(false);
    expect(shouldPromptForSaleValue("negociando", null, renamedWon)).toBe(false);
  });
});

// ── SCRUM-545 fatia 3 — a exigência vira configuração da etapa ──────────────
//
// Antes, "exige valor" era sinônimo de "é etapa de ganho". A coluna
// `requires_sale_value` (migration 20270903000020) separa as duas coisas: a
// etapa passa a dizer por si se exige valor, e o ganho vira só o default do
// backfill.
//
// O ponto frágil, e o motivo destes testes existirem: a diferença entre
// `false` (o admin desligou) e `undefined` (a coluna não chegou neste cliente).
// Tratar as duas igual apagaria o guard num board com tipos velhos — e o
// caderno de vendas é append-only, então uma venda capturada com NULL fica NULL
// para sempre (ADR-0017 §4).
const exigeSemSerGanho: WonStageResolvable[] = [
  { stage_key: "proposta_enviada", stage_role: "open", is_final_positive: false, requires_sale_value: true },
  { stage_key: "novo", stage_role: "open", is_final_positive: false, requires_sale_value: false },
  { stage_key: "vendido", stage_role: "won", is_final_positive: true, requires_sale_value: true },
];

describe("stageRequiresSaleValue — a flag manda, a ausência dela não", () => {
  it("exige valor em etapa que NÃO é de ganho, quando a flag pede", () => {
    expect(stageRequiresSaleValue("proposta_enviada", exigeSemSerGanho)).toBe(true);
    expect(shouldPromptForSaleValue("proposta_enviada", null, exigeSemSerGanho)).toBe(true);
  });

  it("respeita o desligamento explícito, inclusive em etapa de ganho", () => {
    const ganhoDesligado: WonStageResolvable[] = [
      { stage_key: "vendido", stage_role: "won", is_final_positive: true, requires_sale_value: false },
    ];
    // `false` é resposta do admin, não ausência de dado — e vence o legado.
    expect(stageRequiresSaleValue("vendido", ganhoDesligado)).toBe(false);
    expect(shouldPromptForSaleValue("vendido", null, ganhoDesligado)).toBe(false);
  });

  it("🔴 flag AUSENTE não desliga o guard: cai no legado e segue exigindo no ganho", () => {
    // É o board hidratado antes da migration, ou um select() mais estreito.
    // Se este teste virar `false`, uma venda fecha sem valor e o caderno grava
    // NULL para sempre.
    expect(stageRequiresSaleValue("vendido", governed)).toBe(true);
    expect(shouldPromptForSaleValue("vendido", null, governed)).toBe(true);
  });

  it("flag ausente também não INVENTA exigência fora do ganho", () => {
    expect(stageRequiresSaleValue("proposta_enviada", governed)).toBe(false);
  });

  it("não exige quando o valor já veio junto", () => {
    expect(shouldPromptForSaleValue("proposta_enviada", 1500, exigeSemSerGanho)).toBe(false);
  });

  it("etapa marcada como não-exigente não pede valor", () => {
    expect(shouldPromptForSaleValue("novo", null, exigeSemSerGanho)).toBe(false);
  });

  // B2d: sem board carregado não há o que exigir. Antes daqui, `vendido`
  // devolvia true por adivinhação de nome — ver isWonStageKey acima.
  it("sem board carregado, nada é exigido por adivinhação de nome", () => {
    expect(stageRequiresSaleValue("vendido", null)).toBe(false);
    expect(stageRequiresSaleValue("qualquer_outra", null)).toBe(false);
  });
});
