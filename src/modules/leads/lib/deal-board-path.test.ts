import { describe, expect, it } from "vitest";
import { dealBoardPath } from "./deal-board-path";

describe("dealBoardPath — SCRUM-632 (custom vira /funil/:slug)", () => {
  it("system continua nas rotas antigas até a paridade fechar (637)", () => {
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "whatsapp" })).toBe("/pipe-whatsapp");
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "confirmacao" })).toBe("/pipe-confirmacao");
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "propostas" })).toBe("/pipe-propostas");
  });

  it("system sem board navegável devolve null (Carteira)", () => {
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "upsell" })).toBeNull();
  });

  it("custom navega pela rota única", () => {
    expect(dealBoardPath({ isSystem: false, pipelineSlug: "pos-venda" })).toBe("/funil/pos-venda");
  });

  it("custom sem slug devolve null — não há rota morta", () => {
    expect(dealBoardPath({ isSystem: false, pipelineSlug: "" })).toBeNull();
  });
});
