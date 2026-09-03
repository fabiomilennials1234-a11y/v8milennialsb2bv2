import { describe, expect, it } from "vitest";
import { dealBoardPath } from "./deal-board-path";

describe("dealBoardPath — rota única /funil/:slug (SCRUM-632 → flip na 637)", () => {
  it("system também navega pela rota única (flip da 637)", () => {
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "whatsapp" })).toBe("/funil/whatsapp");
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "confirmacao" })).toBe("/funil/confirmacao");
    expect(dealBoardPath({ isSystem: true, pipelineSlug: "propostas" })).toBe("/funil/propostas");
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
